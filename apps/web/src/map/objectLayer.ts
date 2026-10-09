import { Sprite, type Container, type Texture } from 'pixi.js';
import type { AgentView, MapObject, Point, WorldMap } from '@aw/shared';
import type { ViewRect } from './ground.ts';
import { hashString } from './hash.ts';
import { interiorSpots } from './layout.ts';
import { HOUSE_VARIANTS, TILE_PX, type SpriteName } from './pixelArt.ts';

/** Alpha of a sprite drawn in front of a person (roof, tree canopy) so they stay visible. */
const OCCLUDER_ALPHA = 0.4;
/** Alpha of a building without a cutaway sprite while someone is inside. */
const SEE_THROUGH_ALPHA = 0.45;

/** A map object's sprite plus what's needed to fade it and swap it for its open version. */
interface ObjEntry {
  sprite: Sprite;
  obj: MapObject;
  /** Drawn rectangle in world pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Alpha before any fading (burnt or under construction). */
  baseAlpha: number;
  normal: Texture;
  open: Texture | null;
  inside: boolean;
  occluding: boolean;
}

/** Where a person stands (feet, world pixels) and the depth they are drawn at. */
export interface Standing {
  x: number;
  y: number;
  z: number;
}

/**
 * The map's objects (trees, bushes, houses, workshops, fields being cleared…) as depth-sorted
 * sprites in the shared world container, where people are drawn too. Also knows who is inside
 * which building (to open it up) and fades whatever stands in front of a person.
 */
export class ObjectLayer {
  private map: WorldMap | null = null;
  private resources: Record<string, number> = {};
  private sprites = new Map<string, Sprite>();
  private entries = new Map<string, ObjEntry>();
  /** Object entries bucketed by the tiles their drawn rectangle touches. */
  private grid = new Map<number, ObjEntry[]>();
  private occluding = new Set<ObjEntry>();
  /** Living people inside each building (by building id). */
  private occupancy = new Map<string, number>();

  constructor(
    /** The depth-sorted container shared with people. */
    private readonly world: Container,
    private readonly textures: Record<SpriteName, Texture>,
  ) {}

  /** Shows the objects of `map`, replacing whatever was shown before. */
  setMap(map: WorldMap): void {
    const tex = this.textures;
    this.map = map;
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.entries.clear();
    this.grid.clear();
    this.occluding.clear();

    for (const o of map.objects) {
      const name = this.spriteFor(o);
      if (!name) continue;
      const s = new Sprite(tex[name]);
      s.cullable = true;
      const bottom = (o.y + o.h) * TILE_PX;
      s.position.set(o.x * TILE_PX, bottom - s.texture.frame.height);
      s.zIndex = bottom;
      let baseAlpha = 1;
      if (o.burntTick !== undefined) {
        // A burnt-out ruin, blackened until rebuilt.
        baseAlpha = 0.55 + 0.45 * (o.progress ?? 0);
        s.tint = 0x5a4a40;
      } else if (o.progress !== undefined && o.kind !== 'field') {
        // Under construction: fades in as the work progresses.
        baseAlpha = 0.3 + 0.6 * o.progress;
        s.tint = 0xd8c8a8;
      } else if (o.stone) {
        // Stone buildings read as cool grey.
        s.tint = 0xc8d4dc;
      }
      s.alpha = baseAlpha;
      this.world.addChild(s);
      this.sprites.set(o.id, s);
      const openName =
        o.kind === 'house'
          ? (`house_open${hashString(o.id) % HOUSE_VARIANTS}` as SpriteName)
          : null;
      const entry: ObjEntry = {
        sprite: s,
        obj: o,
        x: s.position.x,
        y: s.position.y,
        w: s.texture.frame.width,
        h: s.texture.frame.height,
        z: bottom,
        baseAlpha,
        normal: s.texture,
        open: openName ? tex[openName] : null,
        inside: false,
        occluding: false,
      };
      this.entries.set(o.id, entry);
      // Bucket by tile (only things that can stand in front of someone: tall or wide sprites).
      for (
        let ty = Math.floor(entry.y / TILE_PX);
        ty <= Math.floor((entry.y + entry.h - 1) / TILE_PX);
        ty++
      )
        for (
          let tx = Math.floor(entry.x / TILE_PX);
          tx <= Math.floor((entry.x + entry.w - 1) / TILE_PX);
          tx++
        ) {
          const key = ty * 100000 + tx;
          const list = this.grid.get(key);
          if (list) list.push(entry);
          else this.grid.set(key, [entry]);
        }
    }
    this.setResources({ ...this.resources });
    this.applyOccupancy();
  }

  /** The map object with this id (any kind, drawn as a sprite or as ground). */
  object(id: string): MapObject | undefined {
    return this.map?.objects.find((o) => o.id === id);
  }

  /** Resource amounts changed (by object id): bushes show whether they have berries. */
  setResources(changes: Record<string, number>): void {
    Object.assign(this.resources, changes);
    const tex = this.textures;
    for (const id of Object.keys(changes)) {
      const s = this.sprites.get(id);
      if (s && id.startsWith('berry_bush'))
        s.texture = (changes[id] ?? 0) >= 1 ? tex.berry_bush : tex.berry_bush_empty;
    }
  }

  /**
   * People inside a building stand on distinct spots in its room (sorted by id, so nobody
   * shuffles between updates). Also records which buildings are occupied and opens them up.
   * Returns each indoor person's feet position and the depth to draw them at.
   */
  placeIndoors(views: AgentView[]): Map<string, Point & { z: number }> {
    const out = new Map<string, Point & { z: number }>();
    const groups = new Map<string, AgentView[]>();
    for (const v of views) {
      if (!v.alive || !v.indoors) continue;
      let id = v.indoorsId;
      if (!id || !this.entries.has(id)) {
        // Older frames: find the home whose door this person is standing on.
        id = this.map?.objects.find(
          (o) => o.kind === 'house' && o.door && o.door.x === v.x && o.door.y === v.y,
        )?.id;
      }
      if (!id || !this.entries.has(id)) continue;
      const list = groups.get(id);
      if (list) list.push(v);
      else groups.set(id, [v]);
    }
    this.occupancy = new Map();
    for (const [id, list] of groups) {
      const e = this.entries.get(id)!;
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const pts = interiorSpots(e.obj, list.length);
      list.forEach((v, i) => out.set(v.id, { ...pts[i]!, z: e.z + 1 }));
      this.occupancy.set(id, list.length);
    }
    this.applyOccupancy();
    return out;
  }

  /** Occupied houses show their cutaway; other buildings turn see-through. */
  private applyOccupancy(): void {
    for (const e of this.entries.values()) {
      const inside = (this.occupancy.get(e.obj.id) ?? 0) > 0;
      if (inside !== e.inside) {
        e.inside = inside;
        this.refreshEntry(e);
      }
    }
  }

  private refreshEntry(e: ObjEntry): void {
    const tex = e.inside && e.open ? e.open : e.normal;
    if (e.sprite.texture !== tex) e.sprite.texture = tex;
    let alpha = e.baseAlpha;
    if (e.inside && !e.open) alpha = Math.min(alpha, SEE_THROUGH_ALPHA);
    if (e.occluding) alpha = Math.min(alpha, OCCLUDER_ALPHA);
    if (e.sprite.alpha !== alpha) e.sprite.alpha = alpha;
  }

  /** Fade whatever is drawn in front of a person (roofs, tree canopies) so nobody is hidden. */
  updateOccluders(people: Iterable<Standing>): void {
    const next = new Set<ObjEntry>();
    for (const p of people) {
      const x0 = p.x - 7;
      const x1 = p.x + 7;
      const y0 = p.y - 16;
      const y1 = p.y;
      for (let ty = Math.floor(y0 / TILE_PX); ty <= Math.floor(y1 / TILE_PX); ty++)
        for (let tx = Math.floor(x0 / TILE_PX); tx <= Math.floor(x1 / TILE_PX); tx++) {
          const list = this.grid.get(ty * 100000 + tx);
          if (!list) continue;
          for (const e of list)
            if (e.z > p.z && e.x < x1 && e.x + e.w > x0 && e.y < y1 && e.y + e.h > y0) next.add(e);
        }
    }
    for (const e of this.occluding)
      if (!next.has(e)) {
        e.occluding = false;
        this.refreshEntry(e);
      }
    for (const e of next)
      if (!e.occluding) {
        e.occluding = true;
        this.refreshEntry(e);
      }
    this.occluding = next;
  }

  /**
   * Shows only the objects that overlap `view`. Called whenever the camera moves or the map
   * changes. (For now Pixi's culler hides off-screen sprites, so this does nothing.)
   */
  cull(_view: ViewRect): void {}

  private spriteFor(o: MapObject): SpriteName | null {
    const h = hashString(o.id);
    switch (o.kind) {
      case 'tree':
        return h % 5 === 0 ? 'pine' : (`tree${h % 3}` as SpriteName);
      case 'house':
        return `house${h % HOUSE_VARIANTS}` as SpriteName;
      case 'field':
        // Finished fields are drawn as ground tiles; one still being cleared is bare dirt.
        return o.progress !== undefined ? 'plot' : null;
      case 'berry_bush':
        return (this.resources[o.id] ?? 1) >= 1 ? 'berry_bush' : 'berry_bush_empty';
      default:
        return o.kind;
    }
  }
}
