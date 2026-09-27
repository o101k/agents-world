import {
  Application,
  Container,
  CullerPlugin,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TextureStyle,
  extensions,
} from 'pixi.js';
import {
  Tile,
  objectContains,
  tileAt,
  type MapObject,
  type Point,
  type WorldMap,
} from '@aw/shared';
import {
  centerOn,
  clampCamera,
  fitCamera,
  nextZoomStep,
  screenToTile,
  zoomAt,
  type Camera,
} from './camera.ts';
import { HOUSE_VARIANTS, TILE_PX, buildAtlas, type SpriteName } from './pixelArt.ts';

TextureStyle.defaultOptions.scaleMode = 'nearest';
extensions.add(CullerPlugin);

const CHUNK = 32;
const DRAG_THRESHOLD = 4;

export interface MapSelection {
  tile: Point;
  tileType: Tile;
  object: MapObject | null;
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Draws a world map with PixiJS and handles camera input (drag to pan, wheel to zoom, click to
 * select). Renders on demand rather than every frame, so an idle map costs no battery.
 */
export class WorldRenderer {
  onSelect: ((sel: MapSelection | null) => void) | null = null;

  private readonly app = new Application();
  private readonly scene = new Container();
  private readonly ground = new Container();
  private readonly objects = new Container({ sortableChildren: true });
  private readonly hoverBox = new Graphics();
  private readonly selectBox = new Graphics();
  private textures: Record<SpriteName, Texture> | null = null;
  private map: WorldMap | null = null;
  private cam: Camera = { x: 0, y: 0, zoom: 2 };
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderQueued = false;
  private ready = false;
  private destroyed = false;
  private selected: MapSelection | null = null;
  private hovered: Point | null = null;
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
    this.textures = Object.fromEntries(
      Object.entries(atlas.frames).map(([name, f]) => [
        name,
        new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
      ]),
    ) as Record<SpriteName, Texture>;

    this.scene.addChild(this.ground, this.objects, this.hoverBox, this.selectBox);
    this.app.stage.addChild(this.scene);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(host);
    this.bindInput(this.app.canvas);
    this.ready = true;
    if (this.map) this.buildScene();
  }

  setMap(map: WorldMap): void {
    this.map = map;
    this.selected = null;
    this.hovered = null;
    if (this.ready) this.buildScene();
  }

  zoomBy(direction: 1 | -1): void {
    const { width, height } = this.screenSize();
    this.setCamera(zoomAt(this.cam, width / 2, height / 2, nextZoomStep(this.cam.zoom, direction)));
  }

  fit(): void {
    if (!this.map) return;
    this.setCamera(fitCamera(this.worldSize(), this.screenSize()));
  }

  panBy(dxScreen: number, dyScreen: number): void {
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
    this.onSelect?.(null);
  }

  get zoom(): number {
    return this.cam.zoom;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.ready) return; // init() finishes the teardown
    this.resizeObserver?.disconnect();
    for (const fn of this.cleanup) fn();
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  // ------------------------------------------------------------------ scene

  private buildScene(): void {
    const map = this.map;
    const tex = this.textures;
    if (!map || !tex) return;
    this.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.objects.removeChildren().forEach((c) => c.destroy());

    const fieldTiles = new Set<number>();
    for (const o of map.objects) {
      if (o.kind !== 'field') continue;
      for (let y = o.y; y < o.y + o.h; y++)
        for (let x = o.x; x < o.x + o.w; x++) fieldTiles.add(y * map.width + x);
    }
    const isWet = (x: number, y: number) => {
      const t = tileAt(map, x, y);
      return t === undefined || t === Tile.Water || t === Tile.Bridge;
    };

    for (let cy = 0; cy < map.height; cy += CHUNK) {
      for (let cx = 0; cx < map.width; cx += CHUNK) {
        const chunk = new Container({ cullable: true, cullableChildren: false });
        const cw = Math.min(CHUNK, map.width - cx);
        const ch = Math.min(CHUNK, map.height - cy);
        chunk.cullArea = new Rectangle(cx * TILE_PX, cy * TILE_PX, cw * TILE_PX, ch * TILE_PX);
        for (let y = cy; y < cy + ch; y++) {
          for (let x = cx; x < cx + cw; x++) {
            const t = map.tiles[y * map.width + x] as Tile;
            const h = hash(x, y);
            const put = (name: SpriteName) => {
              const s = new Sprite(tex[name]);
              s.position.set(x * TILE_PX, y * TILE_PX);
              chunk.addChild(s);
            };
            switch (t) {
              case Tile.Grass: {
                const r = h % 100;
                put(r < 45 ? 'grass0' : r < 80 ? 'grass1' : r < 92 ? 'grass2' : 'grass3');
                break;
              }
              case Tile.Water:
                put(h % 2 ? 'water0' : 'water1');
                if (!isWet(x, y - 1)) put('foam_n');
                if (!isWet(x + 1, y)) put('foam_e');
                if (!isWet(x, y + 1)) put('foam_s');
                if (!isWet(x - 1, y)) put('foam_w');
                break;
              case Tile.Sand:
                put(h % 2 ? 'sand0' : 'sand1');
                break;
              case Tile.Path:
                put(h % 2 ? 'path0' : 'path1');
                break;
              case Tile.Farmland:
                put('farmland');
                if (fieldTiles.has(y * map.width + x)) put('crops');
                break;
              case Tile.Bridge:
                put('bridge');
                break;
            }
          }
        }
        this.ground.addChild(chunk);
      }
    }

    for (const o of map.objects) {
      const name = this.spriteFor(o);
      if (!name) continue;
      const s = new Sprite(tex[name]);
      s.cullable = true;
      const bottom = (o.y + o.h) * TILE_PX;
      s.position.set(o.x * TILE_PX, bottom - s.texture.frame.height);
      s.zIndex = bottom;
      this.objects.addChild(s);
    }

    this.cam = fitCamera(this.worldSize(), this.screenSize());
    this.drawSelection();
    this.drawHover();
    this.applyCamera();
  }

  private spriteFor(o: MapObject): SpriteName | null {
    const h = hashString(o.id);
    switch (o.kind) {
      case 'tree':
        return h % 5 === 0 ? 'pine' : (`tree${h % 3}` as SpriteName);
      case 'house':
        return `house${h % HOUSE_VARIANTS}` as SpriteName;
      case 'field':
        return null; // drawn as ground tiles
      default:
        return o.kind;
    }
  }

  // ------------------------------------------------------------------ camera & drawing

  private screenSize() {
    return {
      width: this.app.renderer?.width / this.app.renderer?.resolution || 1,
      height: this.app.renderer?.height / this.app.renderer?.resolution || 1,
    };
  }

  private worldSize() {
    return { width: (this.map?.width ?? 1) * TILE_PX, height: (this.map?.height ?? 1) * TILE_PX };
  }

  private setCamera(cam: Camera): void {
    this.cam = clampCamera(cam, this.worldSize(), this.screenSize());
    this.drawSelection();
    this.drawHover();
    this.applyCamera();
  }

  private applyCamera(): void {
    this.scene.scale.set(this.cam.zoom);
    this.scene.position.set(
      Math.round(-this.cam.x * this.cam.zoom),
      Math.round(-this.cam.y * this.cam.zoom),
    );
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderQueued || !this.ready) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.destroyed) this.app.render();
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

  private drawSelection(): void {
    const g = this.selectBox.clear();
    const sel = this.selected;
    if (!sel) return;
    const r = sel.object ?? { x: sel.tile.x, y: sel.tile.y, w: 1, h: 1 };
    const width = 2 / this.cam.zoom;
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
    if (!map) return null;
    const tile = screenToTile(this.cam, sx, sy, TILE_PX);
    const tileType = tileAt(map, tile.x, tile.y);
    if (tileType === undefined) return null;
    // Prefer the object drawn on top (the one whose footprint ends lowest).
    const hits = map.objects.filter((o) => objectContains(o, tile.x, tile.y));
    hits.sort((a, b) => b.y + b.h - (a.y + a.h));
    return { tile, tileType, object: hits[0] ?? null };
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
          if (next !== this.cam.zoom) this.setCamera(zoomAt(this.cam, p.x, p.y, next));
        } else {
          this.panBy(e.deltaX * scale, e.deltaY * scale);
        }
      },
      { passive: false },
    );
  }
}
