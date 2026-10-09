import {
  Application,
  Container,
  CullerPlugin,
  Graphics,
  Rectangle,
  Texture,
  TextureStyle,
  extensions,
} from 'pixi.js';
import {
  Tile,
  objectContains,
  tickToClock,
  tileAt,
  type ActiveCondition,
  type AgentView,
  type Season,
  type Point,
  type WorldMap,
} from '@aw/shared';
import {
  centerOn,
  clampCamera,
  fitCamera,
  nextZoomStep,
  screenToTile,
  screenToWorld,
  zoomAt,
  type Camera,
} from './camera.ts';
import { GroundLayer } from './ground.ts';
import { hash } from './hash.ts';
import { ObjectLayer } from './objectLayer.ts';
import { PeopleLayer } from './people.ts';
import { TILE_PX, buildAtlas, type SpriteName } from './pixelArt.ts';

TextureStyle.defaultOptions.scaleMode = 'nearest';
extensions.add(CullerPlugin);

const DRAG_THRESHOLD = 4;

export type MapSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'object'; id: string; tile: Point }
  | { kind: 'tile'; tile: Point; tileType: Tile };

/** Night darkness (0–1) and tint for an in-game time. */
export function nightLevel(tick: number): number {
  const { hour, minute } = tickToClock(tick);
  const h = hour + minute / 60;
  if (h >= 22 || h < 4) return 1;
  if (h >= 4 && h < 7) return 1 - (h - 4) / 3;
  if (h >= 19) return (h - 19) / 3;
  return 0;
}

/** What the layers need once the Pixi app and the sprite atlas exist. */
interface Layers {
  ground: GroundLayer;
  objects: ObjectLayer;
  people: PeopleLayer;
}

/**
 * Draws a world with PixiJS and handles camera input (drag to pan, wheel/pinch to zoom, click to
 * select). Renders on demand; animates only while something is moving or being followed.
 * The ground, the map's objects and the people are drawn by their own layers (ground.ts,
 * objectLayer.ts, people.ts); this class owns the scene, the camera, input and effects.
 */
export class WorldRenderer {
  onSelect: ((sel: MapSelection | null) => void) | null = null;
  /** Called when the user drags the map while following someone. */
  onFollowBroken: (() => void) | null = null;

  private readonly app = new Application();
  private readonly scene = new Container();
  /** Map objects and people, depth-sorted together. */
  private readonly world = new Container({ sortableChildren: true });
  private readonly night = new Graphics();
  /** Flames on burning buildings (world space, above objects). */
  private readonly fires = new Graphics();
  /** Falling rain in a storm (screen space). */
  private readonly rain = new Graphics();
  private conditions: ActiveCondition[] = [];
  private season: Season = 'spring';
  private readonly hoverBox = new Graphics();
  private readonly selectBox = new Graphics();
  /** Screen-space labels and speech bubbles. */
  private readonly overlay = new Container();
  private layers: Layers | null = null;
  private map: WorldMap | null = null;
  /** Resource amounts by object id, kept until the layers exist. */
  private resources: Record<string, number> = {};
  private tick = 0;
  private cam: Camera = { x: 0, y: 0, zoom: 2 };
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderQueued = false;
  private animating = false;
  private ready = false;
  private destroyed = false;
  private selected: MapSelection | null = null;
  private hovered: Point | null = null;
  private followId: string | null = null;
  private drag: { id: number; sx: number; sy: number; cam: Camera; moved: boolean } | null = null;
  private readonly cleanup: (() => void)[] = [];

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      background: '#16202b',
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      autoStart: false,
      preference: 'webgl',
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.app.ticker.stop();
    this.host = host;
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.touchAction = 'none';

    const atlas = buildAtlas();
    const base = Texture.from(atlas.canvas);
    const textures = Object.fromEntries(
      Object.entries(atlas.frames).map(([name, f]) => [
        name,
        new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
      ]),
    ) as Record<SpriteName, Texture>;
    const ground = new GroundLayer(atlas, textures);
    const objects = new ObjectLayer(this.world, textures);
    objects.setResources(this.resources);
    this.layers = { ground, objects, people: new PeopleLayer(this.world, this.overlay, textures) };

    this.scene.addChild(
      ground.container,
      this.world,
      this.fires,
      this.night,
      this.hoverBox,
      this.selectBox,
    );
    this.app.stage.addChild(this.scene, this.rain, this.overlay);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(host);
    this.bindInput(this.app.canvas);
    this.ready = true;
    if (this.map) this.buildScene(false);
  }

  /** Show a map. `keepCamera` for live updates (e.g. a house going up) so the view doesn't jump. */
  setMap(map: WorldMap, keepCamera = false): void {
    this.map = map;
    if (!keepCamera) {
      this.selected = null;
      this.hovered = null;
    }
    if (this.ready) this.buildScene(keepCamera);
  }

  setClock(tick: number): void {
    this.tick = tick;
    this.drawNight();
    this.requestRender();
  }

  /** The season tints the land (frosty winters, golden autumns). */
  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    this.drawNight();
    this.requestRender();
  }

  /** World events in progress: weather tints, rain, flames. */
  setConditions(conditions: ActiveCondition[]): void {
    this.conditions = conditions;
    this.drawNight();
    if (this.hasMotion()) this.startAnimating();
    else {
      this.fires.clear();
      this.rain.clear();
    }
    this.requestRender();
  }

  private level(kind: ActiveCondition['kind']): number {
    return this.conditions.reduce((m, c) => (c.kind === kind ? Math.max(m, c.intensity) : m), 0);
  }

  /** Storms and fires animate even when nobody moves. */
  private hasMotion(): boolean {
    return this.conditions.some((c) => c.kind === 'storm' || c.kind === 'fire');
  }

  setResources(changes: Record<string, number>): void {
    Object.assign(this.resources, changes);
    if (!this.layers) return;
    this.layers.objects.setResources(changes);
    this.requestRender();
  }

  setAgents(views: AgentView[]): void {
    const layers = this.layers;
    if (!this.ready || !layers) return;
    layers.people.setAgents(views, layers.objects.placeIndoors(views));
    this.startAnimating();
  }

  setFollow(id: string | null): void {
    this.followId = id;
    if (id) this.startAnimating();
  }

  /** Programmatic selection (e.g. from the people list). */
  select(sel: MapSelection | null, focus = false): void {
    this.selected = sel;
    this.drawSelection();
    if (focus && sel) {
      if (sel.kind === 'agent') {
        const a = this.layers?.people.agents.get(sel.id);
        if (a)
          this.setCamera(
            centerOn(a.to.x, a.to.y - 8, Math.max(this.cam.zoom, 3), this.screenSize()),
          );
      } else {
        this.focusTile(sel.tile);
      }
    }
    this.requestRender();
  }

  zoomBy(direction: 1 | -1): void {
    const { width, height } = this.screenSize();
    this.setCamera(zoomAt(this.cam, width / 2, height / 2, nextZoomStep(this.cam.zoom, direction)));
  }

  fit(): void {
    if (!this.map) return;
    this.breakFollow();
    this.setCamera(fitCamera(this.worldSize(), this.screenSize()));
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.breakFollow();
    this.setCamera({
      ...this.cam,
      x: this.cam.x + dxScreen / this.cam.zoom,
      y: this.cam.y + dyScreen / this.cam.zoom,
    });
  }

  focusTile(tile: Point): void {
    const center = { x: (tile.x + 0.5) * TILE_PX, y: (tile.y + 0.5) * TILE_PX };
    this.setCamera(centerOn(center.x, center.y, Math.max(this.cam.zoom, 3), this.screenSize()));
  }

  clearSelection(): void {
    this.selected = null;
    this.drawSelection();
    this.requestRender();
    this.onSelect?.(null);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.ready) return; // init() finishes the teardown
    this.resizeObserver?.disconnect();
    for (const fn of this.cleanup) fn();
    this.layers?.people.destroy();
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  // ------------------------------------------------------------------ scene

  /** Builds the scene, timed as 'aw:setMap' in the browser's performance timeline. */
  private buildScene(keepCamera: boolean): void {
    const map = this.map;
    const layers = this.layers;
    if (!map || !layers) return;
    const start = performance.now();
    layers.ground.setMap(map);
    layers.objects.setMap(map);
    layers.people.reattach();

    if (!keepCamera) this.cam = fitCamera(this.worldSize(), this.screenSize());
    this.drawNight();
    this.drawSelection();
    this.drawHover();
    this.applyCamera();
    performance.measure('aw:setMap', { start });
  }

  private startAnimating(): void {
    if (this.animating || !this.ready) return;
    this.animating = true;
    const loop = () => {
      if (this.destroyed) return;
      const busy = this.animate(performance.now());
      this.app.render();
      if (busy || this.followId || this.hasMotion()) requestAnimationFrame(loop);
      else this.animating = false;
    };
    requestAnimationFrame(loop);
  }

  /** Move sprites toward their targets; returns true while anything is still moving. */
  private animate(now: number): boolean {
    const layers = this.layers;
    if (!layers) return false;
    const selectedId = this.selected?.kind === 'agent' ? this.selected.id : null;
    const busy = layers.people.animate(now, this.cam, selectedId);
    layers.objects.updateOccluders(layers.people.standing());
    if (this.followId) {
      const a = layers.people.agents.get(this.followId);
      if (a) {
        const { width, height } = this.screenSize();
        const target = centerOn(a.shown.x, a.shown.y - 8, this.cam.zoom, { width, height });
        this.cam = clampCamera(target, this.worldSize(), this.screenSize());
        this.applyTransform();
      }
    }
    this.drawSelection();
    this.drawEffects(now);
    return busy;
  }

  /** Flickering flames on burning buildings and rain streaks in a storm. */
  private drawEffects(now: number): void {
    const f = this.fires.clear();
    const r = this.rain.clear();
    if (!this.map || !this.layers || this.conditions.length === 0) return;
    for (const c of this.conditions) {
      if (c.kind !== 'fire' || !c.targetId) continue;
      const o = this.layers.objects.object(c.targetId);
      if (!o) continue;
      const left = o.x * TILE_PX;
      const width = o.w * TILE_PX;
      const base = (o.y + o.h) * TILE_PX - 4;
      const top = (o.y - 1) * TILE_PX;
      for (let i = 0; i < 7; i++) {
        const phase = now / 110 + i * 1.7;
        const x = left + ((i + 0.5) / 7) * width + Math.sin(phase) * 1.5;
        const h = (base - top) * (0.45 + 0.35 * Math.abs(Math.sin(phase * 0.7 + i)));
        const w = 3 + (i % 3);
        f.moveTo(x - w, base)
          .lineTo(x, base - h)
          .lineTo(x + w, base)
          .fill({ color: i % 2 ? 0xff7a1a : 0xffb52e, alpha: 0.85 });
        f.moveTo(x - w / 2, base)
          .lineTo(x, base - h * 0.55)
          .lineTo(x + w / 2, base)
          .fill({ color: 0xfff1a0, alpha: 0.9 });
      }
      // Smoke
      for (let i = 0; i < 4; i++) {
        const t = ((now / 1400 + i / 4) % 1) * 1;
        f.circle(left + width / 2 + Math.sin(now / 600 + i) * 6, top - t * 30, 4 + t * 8).fill({
          color: 0x3a3a3a,
          alpha: 0.35 * (1 - t),
        });
      }
    }
    const storm = this.level('storm');
    if (storm > 0) {
      const { width, height } = this.screenSize();
      const drops = Math.round(80 + 220 * storm);
      const speed = now / 2.2;
      for (let i = 0; i < drops; i++) {
        const x = (hash(i, 7) % 10007) / 10007;
        const y0 = (hash(i, 13) % 10007) / 10007;
        const px = (x * (width + 60) - speed * 0.25 + 10000) % (width + 60);
        const py = (y0 * (height + 40) + speed) % (height + 40);
        r.moveTo(px, py - 20).lineTo(px - 4, py - 8);
      }
      r.stroke({ width: 1, color: 0xb8cce0, alpha: 0.35 + 0.25 * storm });
    }
  }

  private breakFollow(): void {
    if (this.followId) {
      this.followId = null;
      this.onFollowBroken?.();
    }
  }

  // ------------------------------------------------------------------ camera & drawing

  private screenSize() {
    const r = this.app.renderer;
    if (!r) return { width: 1, height: 1 };
    return { width: r.width / r.resolution, height: r.height / r.resolution };
  }

  private worldSize() {
    return { width: (this.map?.width ?? 1) * TILE_PX, height: (this.map?.height ?? 1) * TILE_PX };
  }

  private setCamera(cam: Camera): void {
    this.cam = clampCamera(cam, this.worldSize(), this.screenSize());
    this.applyCamera();
  }

  private applyTransform(): void {
    this.scene.scale.set(this.cam.zoom);
    this.scene.position.set(
      Math.round(-this.cam.x * this.cam.zoom),
      Math.round(-this.cam.y * this.cam.zoom),
    );
  }

  private applyCamera(): void {
    this.applyTransform();
    this.drawSelection();
    this.drawHover();
    this.animate(performance.now());
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderQueued || !this.ready || this.animating) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.destroyed) {
        this.animate(performance.now());
        this.app.render();
      }
    });
  }

  private handleResize(): void {
    if (!this.host || this.destroyed) return;
    this.app.renderer.resize(
      Math.max(1, this.host.clientWidth),
      Math.max(1, this.host.clientHeight),
    );
    this.setCamera(this.cam);
  }

  private drawNight(): void {
    const g = this.night.clear();
    if (!this.map) return;
    const { width, height } = this.worldSize();
    const level = nightLevel(this.tick);
    if (level > 0) g.rect(0, 0, width, height).fill({ color: 0x0b1640, alpha: 0.5 * level });
    if (this.season === 'winter')
      g.rect(0, 0, width, height).fill({ color: 0xdfe8f5, alpha: 0.28 });
    else if (this.season === 'autumn')
      g.rect(0, 0, width, height).fill({ color: 0xc87830, alpha: 0.12 });
    // Weather: storms darken the sky; droughts bleach the land.
    const storm = this.level('storm');
    if (storm > 0) g.rect(0, 0, width, height).fill({ color: 0x1e2a3a, alpha: 0.2 + 0.3 * storm });
    const drought = this.level('drought');
    if (drought > 0)
      g.rect(0, 0, width, height).fill({ color: 0xe0a848, alpha: 0.14 + 0.2 * drought });
  }

  private drawSelection(): void {
    const g = this.selectBox.clear();
    const sel = this.selected;
    if (!sel || !this.map || !this.layers) return;
    const width = 2 / this.cam.zoom;
    if (sel.kind === 'agent') {
      const a = this.layers.people.agents.get(sel.id);
      if (!a) return;
      const p = a.view.alive ? a.shown : a.to;
      g.ellipse(p.x, p.y, 7, 3).stroke({ width, color: 0xffd84a });
      return;
    }
    const obj = sel.kind === 'object' ? this.layers.objects.object(sel.id) : undefined;
    const r = obj ?? { x: sel.tile.x, y: sel.tile.y, w: 1, h: 1 };
    g.rect(r.x * TILE_PX, r.y * TILE_PX, r.w * TILE_PX, r.h * TILE_PX).stroke({
      width,
      color: 0xffd84a,
      alignment: 1,
    });
  }

  private drawHover(): void {
    const g = this.hoverBox.clear();
    const t = this.hovered;
    if (!t || !this.map || tileAt(this.map, t.x, t.y) === undefined) return;
    g.rect(t.x * TILE_PX, t.y * TILE_PX, TILE_PX, TILE_PX).stroke({
      width: 1 / this.cam.zoom,
      color: 0xffffff,
      alpha: 0.6,
      alignment: 1,
    });
  }

  private pick(sx: number, sy: number): MapSelection | null {
    const map = this.map;
    if (!map || !this.layers) return null;
    // People first: hit-test their drawn sprite.
    const person = this.layers.people.pick(screenToWorld(this.cam, sx, sy));
    if (person) return { kind: 'agent', id: person };
    const tile = screenToTile(this.cam, sx, sy, TILE_PX);
    const tileType = tileAt(map, tile.x, tile.y);
    if (tileType === undefined) return null;
    const hits = map.objects.filter((o) => objectContains(o, tile.x, tile.y));
    hits.sort((a, b) => b.y + b.h - (a.y + a.h));
    const obj = hits[0];
    return obj ? { kind: 'object', id: obj.id, tile } : { kind: 'tile', tile, tileType };
  }

  // ------------------------------------------------------------------ input

  private bindInput(canvas: HTMLCanvasElement): void {
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };

    on('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      this.drag = { id: e.pointerId, sx: p.x, sy: p.y, cam: this.cam, moved: false };
    });
    on('pointermove', (e) => {
      const p = local(e);
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        const dx = p.x - d.sx;
        const dy = p.y - d.sy;
        if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          d.moved = true;
          canvas.style.cursor = 'grabbing';
          this.breakFollow();
        }
        if (d.moved) {
          this.setCamera({ ...d.cam, x: d.cam.x - dx / d.cam.zoom, y: d.cam.y - dy / d.cam.zoom });
          return;
        }
      }
      const t = screenToTile(this.cam, p.x, p.y, TILE_PX);
      if (!this.hovered || t.x !== this.hovered.x || t.y !== this.hovered.y) {
        this.hovered = t;
        this.drawHover();
        this.requestRender();
      }
    });
    const endDrag = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      canvas.style.cursor = '';
      if (!d.moved && e.type === 'pointerup') {
        const p = local(e);
        this.selected = this.pick(p.x, p.y);
        this.drawSelection();
        this.requestRender();
        this.onSelect?.(this.selected);
      }
    };
    on('pointerup', endDrag);
    on('pointercancel', endDrag);
    on('pointerleave', () => {
      this.hovered = null;
      this.drawHover();
      this.requestRender();
    });
    // Mac-friendly: two-finger scroll pans; pinch (reported as ctrl+wheel) or ⌘/ctrl+scroll zooms.
    let zoomAccum = 0;
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        if (e.ctrlKey || e.metaKey) {
          zoomAccum += e.deltaY * scale;
          if (Math.abs(zoomAccum) < 24) return;
          const p = local(e);
          const next = nextZoomStep(this.cam.zoom, zoomAccum < 0 ? 1 : -1);
          zoomAccum = 0;
          if (next !== this.cam.zoom) {
            // Zoom around the followed person rather than the cursor, so following continues.
            const anchor = this.followId
              ? { x: this.screenSize().width / 2, y: this.screenSize().height / 2 }
              : p;
            this.setCamera(zoomAt(this.cam, anchor.x, anchor.y, next));
          }
        } else {
          this.panBy(e.deltaX * scale, e.deltaY * scale);
        }
      },
      { passive: false },
    );
  }
}
