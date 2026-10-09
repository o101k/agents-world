import { Container, Sprite, Texture } from 'pixi.js';
import type { WorldMap } from '@aw/shared';
import { TILE_PX, type AtlasFrame, type SpriteName } from './pixelArt.ts';
import {
  CHUNK,
  changedChunks,
  chunkRect,
  chunksAcross,
  chunksDown,
  fieldTiles,
  tileLayers,
} from './groundPaint.ts';

export { CHUNK };

/** The part of the world on screen, in world pixels (a layer may add its own margin). */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The sprite atlas: one canvas with every sprite, and where each one is on it. */
export interface Atlas {
  canvas: HTMLCanvasElement;
  frames: Record<SpriteName, AtlasFrame>;
}

/** One chunk of the ground: its canvas, the sprite that shows it, and where it sits in world pixels. */
interface GroundChunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sprite: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The ground: grass, water with foam at the shore, sand, paths, farmland with crops, bridges. */
export class GroundLayer {
  readonly container = new Container();
  /** The map last drawn (a copy, since callers may reuse their arrays) and its field tiles. */
  private drawn: { map: WorldMap; fields: Set<number> } | null = null;
  private chunks: GroundChunk[] = [];
  /** The last view, applied to chunks as they are built. */
  private view: ViewRect | null = null;

  constructor(
    readonly atlas: Atlas,
    _textures: Record<SpriteName, Texture>,
  ) {}

  /**
   * Draws the ground of `map`, replacing whatever was drawn before. Only the chunks that changed
   * since the last call are painted again.
   */
  setMap(map: WorldMap): void {
    const fields = fieldTiles(map);
    const prev = this.drawn;
    const copy: WorldMap = {
      width: map.width,
      height: map.height,
      tiles: map.tiles.slice(),
      objects: [],
    };
    this.drawn = { map: copy, fields };
    if (prev && prev.map.width === map.width && prev.map.height === map.height) {
      for (const i of changedChunks(prev.map, prev.fields, copy, fields)) this.paintChunk(i);
    } else {
      this.rebuild();
    }
  }

  /** Builds every chunk from scratch: the first map, or a map of another size. */
  private rebuild(): void {
    const drawn = this.drawn;
    if (!drawn) return;
    for (const c of this.container.removeChildren())
      c.destroy({ texture: true, textureSource: true });
    this.chunks = [];
    const { width, height } = drawn.map;
    const count = chunksAcross(width) * chunksDown(height);
    for (let i = 0; i < count; i++) {
      const r = chunkRect(drawn.map, i);
      const canvas = document.createElement('canvas');
      canvas.width = r.w * TILE_PX;
      canvas.height = r.h * TILE_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D is not available');
      // Tiles are pixel art: copy them without smoothing.
      ctx.imageSmoothingEnabled = false;
      const sprite = new Sprite(Texture.from(canvas));
      const x0 = r.x0 * TILE_PX;
      const y0 = r.y0 * TILE_PX;
      sprite.position.set(x0, y0);
      sprite.cullable = false;
      this.container.addChild(sprite);
      this.chunks.push({
        canvas,
        ctx,
        sprite,
        x0,
        y0,
        x1: x0 + canvas.width,
        y1: y0 + canvas.height,
      });
      this.paintChunk(i);
    }
    if (this.view) this.cull(this.view);
  }

  /** Repaints one chunk's canvas from the drawn map and tells Pixi to upload it again. */
  private paintChunk(index: number): void {
    const chunk = this.chunks[index];
    const drawn = this.drawn;
    if (!chunk || !drawn) return;
    const { map, fields } = drawn;
    const r = chunkRect(map, index);
    const { ctx, canvas } = chunk;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let ty = 0; ty < r.h; ty++) {
      for (let tx = 0; tx < r.w; tx++) {
        for (const name of tileLayers(map, fields, r.x0 + tx, r.y0 + ty)) {
          const f = this.atlas.frames[name];
          ctx.drawImage(
            this.atlas.canvas,
            f.x,
            f.y,
            f.w,
            f.h,
            tx * TILE_PX,
            ty * TILE_PX,
            f.w,
            f.h,
          );
        }
      }
    }
    // Pixi uploads a canvas again only when it is told the canvas changed.
    chunk.sprite.texture.source.update();
  }

  /**
   * Shows only the chunks that overlap `view`. Called whenever the camera moves or the map
   * changes.
   */
  cull(view: ViewRect): void {
    this.view = view;
    for (const c of this.chunks) {
      const visible = c.x0 < view.x1 && c.x1 > view.x0 && c.y0 < view.y1 && c.y1 > view.y0;
      if (c.sprite.visible !== visible) c.sprite.visible = visible;
    }
  }
}
