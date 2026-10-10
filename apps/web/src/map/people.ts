import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { AgentView, Appearance, Point } from '@aw/shared';
import type { Camera } from './camera.ts';
import { BUBBLE_TAIL, layoutBubbles, type BubbleRequest } from './layout.ts';
import type { Standing } from './objectLayer.ts';
import {
  CHARACTER_FRAMES,
  CHARACTER_PX,
  TILE_PX,
  characterCanvas,
  type SpriteName,
} from './pixelArt.ts';

/**
 * How far past the screen edge (in screen pixels) someone still counts as on screen: their
 * label and speech bubble reach well above and beside their feet.
 */
const SCREEN_MARGIN = 220;

export interface AgentSprite {
  /** Current label colour (to avoid restyling every frame). */
  labelFill?: string;
  view: AgentView;
  sprite: Sprite;
  frames: Texture[];
  /** The look the frames were painted for. */
  look: Appearance | null;
  label: Text;
  zzz: Text;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  bubbleTail: Graphics;
  bubbleFor: string;
  tailKey?: string;
  bubbleW: number;
  bubbleH: number;
  /** Set while inside a building: draw just in front of it. */
  indoorZ?: number;
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

/**
 * People: their sprites in the people layer, sorted by tile row (tweened between frames),
 * gravestones for the dead, and their name labels, "z z"/"…" markers and speech bubbles in the
 * screen-space overlay.
 */
export class PeopleLayer {
  readonly agents = new Map<string, AgentSprite>();
  private lastAgentsAt = 0;

  constructor(
    /** The people layer (between the map's flat and tall objects). */
    private readonly world: Container,
    /** Where gravestones go (on the ground, under people). */
    private readonly graves: Container,
    /** Screen-space container for labels and bubbles. */
    private readonly overlay: Container,
    private readonly textures: Record<SpriteName, Texture>,
  ) {}

  /**
   * The latest people. `spots` gives the feet position and depth of everyone indoors (they
   * stand on distinct spots in the room); everyone else stands on their tile.
   */
  setAgents(views: AgentView[], spots: Map<string, Point & { z: number }>): void {
    const now = performance.now();
    const interval = this.lastAgentsAt ? Math.min(1000, Math.max(50, now - this.lastAgentsAt)) : 0;
    this.lastAgentsAt = now;
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      let a = this.agents.get(v.id);
      const spot = spots.get(v.id);
      const target = spot
        ? { x: spot.x, y: spot.y }
        : { x: (v.x + 0.5) * TILE_PX, y: (v.y + 1) * TILE_PX - 1 };
      if (!a) {
        a = this.createAgentSprite(v, target);
        this.agents.set(v.id, a);
      }
      if (!a.look || !sameLook(a.look, v.appearance)) this.retexture(a, v);
      const moved = target.x !== a.to.x || target.y !== a.to.y;
      if (moved) {
        const far = Math.abs(target.x - a.shown.x) + Math.abs(target.y - a.shown.y) > TILE_PX * 6;
        a.from = far || interval === 0 ? { ...target } : { ...a.shown };
        a.to = target;
        a.moveStart = now;
        a.moveDuration = far ? 0 : interval;
      }
      if (a.label.text !== v.name) a.label.text = v.name; // e.g. a baby was named
      a.view = v;
      a.indoorZ = spot?.z;
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
  }

  /** Where each living person on screen is drawn, for fading what stands in front of them. */
  standing(): Standing[] {
    const out: Standing[] = [];
    for (const a of this.agents.values())
      if (a.sprite.visible) out.push({ x: a.shown.x, y: a.shown.y, z: a.sprite.zIndex });
    return out;
  }

  /** Where a person is drawn at time `now` (feet, world pixels), on screen or not. */
  positionAt(a: AgentSprite, now: number): Point {
    const t = a.moveDuration > 0 ? Math.min(1, (now - a.moveStart) / a.moveDuration) : 1;
    return { x: a.from.x + (a.to.x - a.from.x) * t, y: a.from.y + (a.to.y - a.from.y) * t };
  }

  /**
   * Moves sprites toward their targets and places labels, markers and speech bubbles for the
   * camera `cam` on a screen of `size`. People off screen are hidden and skipped.
   * Returns true while anyone is still moving or walking.
   */
  animate(
    now: number,
    cam: Camera,
    size: { width: number; height: number },
    selectedId: string | null,
  ): boolean {
    let busy = false;
    const showLabels = cam.zoom >= 2;
    const bubbles: BubbleRequest[] = [];
    const labels: { owner: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
    for (const [id, a] of this.agents) {
      a.shown = this.positionAt(a, now);
      const moving = a.moveDuration > 0 && now - a.moveStart < a.moveDuration;
      // Keep animating for walkers off screen too, so they walk (not jump) into view.
      if (a.view.alive && (moving || a.view.activity === 'walking')) busy = true;
      // The top of their head on screen.
      const screen = {
        x: (a.shown.x - cam.x) * cam.zoom,
        y: (a.shown.y - 17 - cam.y) * cam.zoom,
      };
      const visible =
        a.view.alive &&
        screen.x > -SCREEN_MARGIN &&
        screen.x < size.width + SCREEN_MARGIN &&
        screen.y > -SCREEN_MARGIN &&
        screen.y < size.height + SCREEN_MARGIN;
      // Only changes when someone dies or crosses the edge of the view (a change makes Pixi
      // rebuild the people layer's draw list).
      a.sprite.visible = visible;
      if (!visible) {
        a.label.visible = false;
        a.zzz.visible = false;
        a.bubble.visible = false;
        continue;
      }
      a.sprite.position.set(a.shown.x, a.shown.y);
      // Depth among people by tile row, so it only changes (and makes Pixi re-sort the people
      // layer) when someone crosses a row; people inside a building share its depth.
      a.sprite.zIndex = a.indoorZ ?? Math.floor((a.shown.y + 2) / TILE_PX) * TILE_PX + 1;
      if (a.frames.length)
        a.sprite.texture = this.frameFor(a, moving || a.view.activity === 'walking', now);
      const selected = selectedId === id;
      a.label.visible = showLabels || selected;
      a.label.position.set(Math.round(screen.x), Math.round(screen.y));
      // Only touch text styles when they change (restyling re-renders the text).
      const fill = selected ? '#ffd84a' : '#ffffff';
      if (a.labelFill !== fill) {
        a.labelFill = fill;
        a.label.style.fill = fill;
      }
      const thinking = a.view.activity === 'thinking';
      a.zzz.visible = (a.view.activity === 'sleeping' || thinking) && cam.zoom >= 1.5;
      const marker = thinking ? '…' : 'z z';
      if (a.zzz.text !== marker) a.zzz.text = marker;
      a.zzz.position.set(Math.round(screen.x + 6), Math.round(screen.y + 4));
      if (a.label.visible)
        labels.push({
          owner: id,
          rect: {
            x: screen.x - a.label.width / 2,
            y: screen.y - a.label.height,
            w: a.label.width,
            h: a.label.height,
          },
        });
      const req = this.prepareBubble(a, cam.zoom >= 1.5 || selected, screen);
      if (req) bubbles.push(req);
    }
    this.placeBubbles(bubbles, labels);
    return busy;
  }

  /** The person drawn under a world point (their sprite is about 12×16 px above the feet). */
  pick(w: Point): string | null {
    let best: { id: string; d: number } | null = null;
    for (const [id, a] of this.agents) {
      const p = a.view.alive ? a.shown : a.to;
      if (Math.abs(w.x - p.x) <= 7 && w.y <= p.y + 2 && w.y >= p.y - 16) {
        const d = Math.abs(w.x - p.x) + Math.abs(w.y - (p.y - 8));
        if (!best || d < best.d) best = { id, d };
      }
    }
    return best?.id ?? null;
  }

  /** Frees the per-person textures (the rest goes with the Pixi app). */
  destroy(): void {
    for (const a of this.agents.values()) for (const t of a.frames) t.destroy(true);
  }

  private createAgentSprite(v: AgentView, at: Point): AgentSprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    this.world.addChild(sprite);
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
    const bubbleTail = new Graphics();
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
    bubble.addChild(bubbleBg, bubbleTail, bubbleText);
    bubble.visible = false;
    this.overlay.addChild(bubble, label, zzz);
    const a: AgentSprite = {
      view: v,
      sprite,
      frames: [],
      look: null,
      label,
      zzz,
      bubble,
      bubbleText,
      bubbleBg,
      bubbleTail,
      bubbleFor: '',
      bubbleW: 0,
      bubbleH: 0,
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
    a.look = v.appearance;
    a.sprite.texture = a.frames[0]!;
  }

  private styleAgent(a: AgentSprite): void {
    const v = a.view;
    if (!v.alive) {
      a.sprite.visible = false;
      if (!a.grave) {
        a.grave = new Sprite(this.textures.grave);
        a.grave.anchor.set(0.5, 1);
        a.grave.position.set(a.to.x, a.to.y + 1);
        a.grave.zIndex = a.to.y;
        this.graves.addChild(a.grave);
      }
      return;
    }
    // Nobody is ever hidden: people indoors are drawn in the open room. (animate shows the
    // living who are on screen.)
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

  /** Sizes a person's speech bubble (cached per text); null when they aren't talking. */
  private prepareBubble(a: AgentSprite, show: boolean, screen: Point): BubbleRequest | null {
    const speech = a.view.speech ?? '';
    if (!speech || !show) {
      a.bubble.visible = false;
      return null;
    }
    if (a.bubbleFor !== speech) {
      a.bubbleFor = speech;
      a.bubbleText.text = speech.length > 140 ? `${speech.slice(0, 137)}…` : speech;
      const w = Math.ceil(a.bubbleText.width + 12);
      const h = Math.ceil(a.bubbleText.height + 8);
      a.bubbleW = w;
      a.bubbleH = h;
      a.bubbleText.position.set(6, 4);
      a.bubbleBg
        .clear()
        .roundRect(0, 0, w, h, 6)
        .fill({ color: 0xfffbe8, alpha: 0.95 })
        .stroke({ width: 1, color: 0x1a1a1a, alpha: 0.6 });
      a.tailKey = undefined;
    }
    // The tail points at the head: just above the name label when it's showing.
    const tipY = a.label.visible ? screen.y - a.label.height - 1 : screen.y + 2;
    return { id: a.view.id, anchor: { x: screen.x, y: tipY }, w: a.bubbleW, h: a.bubbleH };
  }

  /** Lays out every visible bubble together so none overlap, then draws each tail to its speaker. */
  private placeBubbles(
    requests: BubbleRequest[],
    labels: { owner: string; rect: { x: number; y: number; w: number; h: number } }[],
  ): void {
    if (requests.length === 0) return;
    const spots = layoutBubbles(requests, labels);
    for (const r of requests) {
      const a = this.agents.get(r.id);
      const at = spots.get(r.id);
      if (!a || !at) continue;
      a.bubble.visible = true;
      a.bubble.position.set(at.x, at.y);
      const tipX = Math.round(r.anchor.x - at.x);
      const tipY = Math.round(r.anchor.y - at.y);
      const baseX = Math.min(Math.max(tipX, 10), r.w - 10);
      const key = `${tipX},${tipY},${baseX}`;
      if (a.tailKey === key) continue;
      a.tailKey = key;
      a.bubbleTail
        .clear()
        .moveTo(baseX - 5, r.h - 0.5)
        .lineTo(tipX, Math.max(tipY, r.h + BUBBLE_TAIL * 0.5))
        .lineTo(baseX + 5, r.h - 0.5)
        .fill({ color: 0xfffbe8, alpha: 0.95 });
    }
  }
}

/** Same colours and hair (compared field by field: this runs for everyone on every update). */
function sameLook(a: Appearance, b: Appearance): boolean {
  return (
    a.skin === b.skin &&
    a.hair === b.hair &&
    a.shirt === b.shirt &&
    a.pants === b.pants &&
    a.hairStyle === b.hairStyle
  );
}
