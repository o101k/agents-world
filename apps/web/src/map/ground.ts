import { Container, Rectangle, Sprite, type Texture } from 'pixi.js';
import { Tile, tileAt, type WorldMap } from '@aw/shared';
import { hash } from './hash.ts';
import { TILE_PX, type AtlasFrame, type SpriteName } from './pixelArt.ts';

/** Ground is drawn in CHUNK×CHUNK-tile pieces. */
export const CHUNK = 32;

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

/** The ground: grass, water with foam at the shore, sand, paths, farmland with crops, bridges. */
export class GroundLayer {
  readonly container = new Container();

  constructor(
    readonly atlas: Atlas,
    private readonly textures: Record<SpriteName, Texture>,
  ) {}

  /** Draws the ground of `map`, replacing whatever was drawn before. */
  setMap(map: WorldMap): void {
    const tex = this.textures;
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));

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
        // The ground never changes between map reloads: draw each chunk once into a texture
        // (one sprite instead of ~1,000 per chunk; matters on big maps).
        chunk.cacheAsTexture({ scaleMode: 'nearest', resolution: 1 });
        this.container.addChild(chunk);
      }
    }
  }

  /**
   * Shows only the chunks that overlap `view`. Called whenever the camera moves or the map
   * changes. (For now Pixi's culler hides off-screen chunks, so this does nothing.)
   */
  cull(_view: ViewRect): void {}
}
