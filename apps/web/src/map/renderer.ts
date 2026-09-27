import {
  Application,
  Container,
  CullerPlugin,
  Graphics,
  Rectangle,
  Sprite,
  Text,
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
  screenToWorld,
  zoomAt,
  type Camera,
} from './camera.ts';
import {
  CHARACTER_FRAMES,
  CHARACTER_PX,
  HOUSE_VARIANTS,
  TILE_PX,
  buildAtlas,
  characterCanvas,
  type SpriteName,
} from './pixelArt.ts';

TextureStyle.defaultOptions.scaleMode = 'nearest';
extensions.add(CullerPlugin);

const CHUNK = 32;
const DRAG_THRESHOLD = 4;

export type MapSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'object'; id: string; tile: Point }
  | { kind: 'tile'; tile: Point; tileType: Tile };

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

interface AgentSprite {
  view: AgentView;
  sprite: Sprite;
  frames: Texture[];
  lookKey: string;
  label: Text;
  zzz: Text;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  bubbleFor: string;
  /** Displayed position in world pixels (bottom-centre of the feet). */
  from: Point;
  to: Point;
  shown: Point;
  moveStart: number;
  moveDuration: number;
  grave: Sprite | null;
  /** Smaller for children. */
  baseScale: number;
}

/** Night darkness (0–1) and tint for an in-game time. */
export function nightLevel(tick: number): number {
  const { hour, minute } = tickToClock(tick);
  const h = hour + minute / 60;
  if (h >= 22 || h < 4) return 1;
  if (h >= 4 && h < 7) return 1 - (h - 4) / 3;
  if (h >= 19) return (h - 19) / 3;
  return 0;
}

/**
 * Draws a world with PixiJS and handles camera input (drag to pan, wheel/pinch to zoom, click to
 * select). Renders on demand; animates only while something is moving or being followed.
 */
export class WorldRenderer {
  onSelect: ((sel: MapSelection | null) => void) | null = null;
  /** Called when the user drags the map while following someone. */
  onFollowBroken: (() => void) | null = null;

  private readonly app = new Application();
  private readonly scene = new Container();
  private readonly ground = new Container();
  private readonly objects = new Container({ sortableChildren: true });
  private readonly night = new Graphics();
  /** Flames on burning buildings (world space, above objects). */
  private readonly fires = new Graphics();
  /** Falling rain in a storm (screen space). */
  private readonly rain = new Graphics();
  private conditions: ActiveCondition[] = [];
  private readonly hoverBox = new Graphics();
  private readonly selectBox = new Graphics();
  private readonly overlay = new Container();
  private textures: Record<SpriteName, Texture> | null = null;
  private map: WorldMap | null = null;
  private objectSprites = new Map<string, Sprite>();
  private agents = new Map<string, AgentSprite>();
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
  private lastAgentsAt = 0;
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

    this.scene.addChild(
      this.ground,
      this.objects,
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
    if (this.map) this.buildScene();
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
    const tex = this.textures;
    if (!tex) return;
    for (const id of Object.keys(changes)) {
      const s = this.objectSprites.get(id);
      if (s && id.startsWith('berry_bush'))
        s.texture = (changes[id] ?? 0) >= 1 ? tex.berry_bush : tex.berry_bush_empty;
    }
    this.requestRender();
  }

  setAgents(views: AgentView[]): void {
    if (!this.ready || !this.textures) return;
    const now = performance.now();
    const interval = this.lastAgentsAt ? Math.min(1000, Math.max(50, now - this.lastAgentsAt)) : 0;
    this.lastAgentsAt = now;
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      let a = this.agents.get(v.id);
      const target = { x: (v.x + 0.5) * TILE_PX, y: (v.y + 1) * TILE_PX - 1 };
      if (!a) {
        a = this.createAgentSprite(v, target);
        this.agents.set(v.id, a);
      }
      const lookKey = JSON.stringify(v.appearance);
      if (lookKey !== a.lookKey) this.retexture(a, v);
      const moved = target.x !== a.to.x || target.y !== a.to.y;
      if (moved) {
        const far = Math.abs(target.x - a.shown.x) + Math.abs(target.y - a.shown.y) > TILE_PX * 6;
        a.from = far || interval === 0 ? { ...target } : { ...a.shown };
        a.to = target;
        a.moveStart = now;
        a.moveDuration = far ? 0 : interval;
      }
      a.view = v;
      this.styleAgent(a);
    }
    for (const [id, a] of this.agents) {
      if (!seen.has(id)) {
        a.sprite.destroy();
        a.label.destroy();
        a.zzz.destroy();
        a.bubble.destroy({ children: true });
        a.grave?.destroy();
        this.agents.delete(id);
      }
    }
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
        const a = this.agents.get(sel.id);
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
    for (const a of this.agents.values()) for (const t of a.frames) t.destroy(true);
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  // ------------------------------------------------------------------ scene

  private buildScene(keepCamera = false): void {
    const map = this.map;
    const tex = this.textures;
    if (!map || !tex) return;
    this.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const s of this.objectSprites.values()) s.destroy();
    this.objectSprites.clear();

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
      if (o.burntTick !== undefined) {
        // A burnt-out ruin, blackened until rebuilt.
        s.alpha = 0.55 + 0.45 * (o.progress ?? 0);
        s.tint = 0x5a4a40;
      } else if (o.progress !== undefined) {
        // Under construction: fades in as the work progresses.
        s.alpha = 0.3 + 0.6 * o.progress;
        s.tint = 0xd8c8a8;
      }
      this.objects.addChild(s);
      this.objectSprites.set(o.id, s);
    }
    this.setResources({ ...this.resources });
    for (const a of this.agents.values()) {
      this.objects.addChild(a.sprite);
      if (a.grave) this.objects.addChild(a.grave);
    }

    if (!keepCamera) this.cam = fitCamera(this.worldSize(), this.screenSize());
    this.drawNight();
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
      case 'berry_bush':
        return (this.resources[o.id] ?? 1) >= 1 ? 'berry_bush' : 'berry_bush_empty';
      default:
        return o.kind;
    }
  }

  // ------------------------------------------------------------------ people

  private createAgentSprite(v: AgentView, at: Point): AgentSprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    sprite.cullable = true;
    this.objects.addChild(sprite);
    const label = new Text({
      text: v.name,
      style: {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
        fontWeight: '600',
        fill: '#ffffff',
        stroke: { color: '#0b0f14', width: 3 },
      },
      resolution: Math.max(2, window.devicePixelRatio || 1),
    });
    label.anchor.set(0.5, 1);
    const zzz = new Text({
      text: 'z z',
      style: {
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10,
        fontWeight: '700',
        fill: '#cfe3ff',
        stroke: { color: '#0b0f14', width: 3 },
      },
      resolution: Math.max(2, window.devicePixelRatio || 1),
    });
    zzz.anchor.set(0, 1);
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({
      text: '',
      style: {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        fill: '#1a1a1a',
        wordWrap: true,
        wordWrapWidth: 200,
        lineHeight: 15,
      },
      resolution: Math.max(2, window.devicePixelRatio || 1),
    });
    bubble.addChild(bubbleBg, bubbleText);
    bubble.visible = false;
    this.overlay.addChild(bubble, label, zzz);
    const a: AgentSprite = {
      view: v,
      sprite,
      frames: [],
      lookKey: '',
      label,
      zzz,
      bubble,
      bubbleText,
      bubbleBg,
      bubbleFor: '',
      from: { ...at },
      to: { ...at },
      shown: { ...at },
      moveStart: 0,
      moveDuration: 0,
      grave: null,
      baseScale: 1,
    };
    this.retexture(a, v);
    return a;
  }

  private retexture(a: AgentSprite, v: AgentView): void {
    for (const t of a.frames) t.destroy(true);
    const canvas = characterCanvas(v.appearance);
    const base = Texture.from(canvas);
    a.frames = Array.from(
      { length: CHARACTER_FRAMES },
      (_, i) =>
        new Texture({
          source: base.source,
          frame: new Rectangle(i * CHARACTER_PX, 0, CHARACTER_PX, CHARACTER_PX),
        }),
    );
    a.lookKey = JSON.stringify(v.appearance);
    a.sprite.texture = a.frames[0]!;
  }

  private styleAgent(a: AgentSprite): void {
    const v = a.view;
    if (!v.alive) {
      a.sprite.visible = false;
      if (!a.grave && this.textures) {
        a.grave = new Sprite(this.textures.grave);
        a.grave.anchor.set(0.5, 1);
        a.grave.position.set(a.to.x, a.to.y + 1);
        a.grave.zIndex = a.to.y;
        this.objects.addChild(a.grave);
      }
      return;
    }
    a.sprite.visible = !v.indoors;
    a.baseScale =
      v.stage === 'toddler' ? 0.6 : v.stage === 'child' ? 0.8 : v.stage === 'teen' ? 0.92 : 1;
    const sleeping = v.activity === 'sleeping';
    // The sick look pale and greenish.
    a.sprite.tint = v.sick ? 0xb8e0a0 : 0xffffff;
    a.sprite.rotation = sleeping ? -Math.PI / 2 : 0;
    a.sprite.anchor.set(sleeping ? 0.5 : 0.5, sleeping ? 0.6 : 1);
  }

  private frameFor(a: AgentSprite, moving: boolean, now: number): Texture {
    const step = moving ? Math.floor(now / 160) % 2 : 0;
    const dir = a.view.facing;
    const base = dir === 'up' ? 2 : dir === 'down' ? 0 : 4;
    a.sprite.scale.set(dir === 'left' ? -a.baseScale : a.baseScale, a.baseScale);
    return a.frames[base + step] ?? a.frames[0]!;
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
    let busy = false;
    const showLabels = this.cam.zoom >= 2;
    for (const [id, a] of this.agents) {
      const t = a.moveDuration > 0 ? Math.min(1, (now - a.moveStart) / a.moveDuration) : 1;
      a.shown = { x: a.from.x + (a.to.x - a.from.x) * t, y: a.from.y + (a.to.y - a.from.y) * t };
      const moving = t < 1;
      if (moving) busy = true;
      if (a.view.alive) {
        a.sprite.position.set(a.shown.x, a.shown.y);
        // +2 so someone standing in a doorway draws in front of their house.
        a.sprite.zIndex = a.shown.y + 2;
        if (a.frames.length)
          a.sprite.texture = this.frameFor(a, moving || a.view.activity === 'walking', now);
        if (a.view.activity === 'walking') busy = true;
      }
      const selected = this.selected?.kind === 'agent' && this.selected.id === id;
      const visible = a.view.alive && !a.view.indoors;
      const screen = this.toScreen(a.shown.x, a.shown.y - 17);
      a.label.visible = visible && (showLabels || selected);
      a.label.position.set(Math.round(screen.x), Math.round(screen.y));
      a.label.style.fill = selected ? '#ffd84a' : '#ffffff';
      const thinking = a.view.activity === 'thinking';
      a.zzz.visible =
        visible && (a.view.activity === 'sleeping' || thinking) && this.cam.zoom >= 1.5;
      a.zzz.text = thinking ? '…' : 'z z';
      a.zzz.position.set(Math.round(screen.x + 6), Math.round(screen.y + 4));
      this.updateBubble(a, visible && (this.cam.zoom >= 1.5 || selected), screen);
    }
    if (this.followId) {
      const a = this.agents.get(this.followId);
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
    if (!this.map || this.conditions.length === 0) return;
    for (const c of this.conditions) {
      if (c.kind !== 'fire' || !c.targetId) continue;
      const o = this.map.objects.find((x) => x.id === c.targetId);
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

  /** Speech bubble above a person while they're talking. */
  private updateBubble(a: AgentSprite, show: boolean, screen: Point): void {
    const speech = a.view.speech ?? '';
    if (!speech || !show) {
      a.bubble.visible = false;
      return;
    }
    if (a.bubbleFor !== speech) {
      a.bubbleFor = speech;
      a.bubbleText.text = speech.length > 140 ? `${speech.slice(0, 137)}…` : speech;
      const w = a.bubbleText.width + 12;
      const h = a.bubbleText.height + 8;
      a.bubbleText.position.set(6, 4);
      a.bubbleBg
        .clear()
        .roundRect(0, 0, w, h, 6)
        .fill({ color: 0xfffbe8, alpha: 0.95 })
        .stroke({ width: 1, color: 0x1a1a1a, alpha: 0.6 })
        .moveTo(w / 2 - 5, h)
        .lineTo(w / 2, h + 6)
        .lineTo(w / 2 + 5, h)
        .fill({ color: 0xfffbe8, alpha: 0.95 });
    }
    a.bubble.visible = true;
    const b = a.bubble.getLocalBounds();
    a.bubble.position.set(Math.round(screen.x - b.width / 2), Math.round(screen.y - 16 - b.height));
  }

  private toScreen(wx: number, wy: number): Point {
    return { x: (wx - this.cam.x) * this.cam.zoom, y: (wy - this.cam.y) * this.cam.zoom };
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
    if (!sel || !this.map) return;
    const width = 2 / this.cam.zoom;
    if (sel.kind === 'agent') {
      const a = this.agents.get(sel.id);
      if (!a || (a.view.alive && a.view.indoors)) return;
      const p = a.view.alive ? a.shown : a.to;
      g.ellipse(p.x, p.y, 7, 3).stroke({ width, color: 0xffd84a });
      return;
    }
    const obj = sel.kind === 'object' ? this.map.objects.find((o) => o.id === sel.id) : undefined;
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
    if (!map) return null;
    // People first: hit-test their drawn sprite (about 12×16 px above the feet).
    const w = screenToWorld(this.cam, sx, sy);
    let best: { id: string; d: number } | null = null;
    for (const [id, a] of this.agents) {
      if (a.view.alive && a.view.indoors) continue;
      const p = a.view.alive ? a.shown : a.to;
      if (Math.abs(w.x - p.x) <= 7 && w.y <= p.y + 2 && w.y >= p.y - 16) {
        const d = Math.abs(w.x - p.x) + Math.abs(w.y - (p.y - 8));
        if (!best || d < best.d) best = { id, d };
      }
    }
    if (best) return { kind: 'agent', id: best.id };
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
