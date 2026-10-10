import { Sprite, type Container, type Texture } from 'pixi.js';
import type { AgentView, MapObject, Point, WorldMap } from '@aw/shared';
import { hashString } from './hash.ts';
import { interiorSpots } from './layout.ts';
import { diffObjects, lookKey } from './objectDiff.ts';
import { HOUSE_VARIANTS, TILE_PX, type SpriteName } from './pixelArt.ts';

/** Alpha of a sprite drawn in front of a person (roof, tree canopy) so they stay visible. */
const OCCLUDER_ALPHA = 0.4;
/** Alpha of a building without a cutaway sprite while someone is inside. */
const SEE_THROUGH_ALPHA = 0.45;
/** Up to this many sprites are removed one by one; more go in a single pass (see removeSprites). */
const SINGLE_REMOVE_LIMIT = 32;

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
  /** Drawn taller than its footprint (trees, stalls), so in the layer above people. */
  tall: boolean;
}

/** Where a person stands (feet, world pixels) and the depth they are drawn at. */
export interface Standing {
  x: number;
  y: number;
  z: number;
}

/**
 * The map's objects (trees, bushes, houses, workshops, fields being cleared…) as depth-sorted
 * sprites in two layers: objects drawn within their footprint go under people, objects drawn
 * taller than it (trees, stalls) over them (see WorldRenderer). Also knows who is inside which
 * building (to open it up) and fades whatever tall object stands in front of a person.
 *
 * Objects are never culled: the layers are static, so Pixi keeps their draw lists, and hiding
 * sprites as the camera moves would make it rebuild them.
 *
 * A new map is applied as a diff: objects that look the same keep their sprite, only changed
 * ones are redrawn, and removed ones are dropped.
 */
export class ObjectLayer {
  /** Every map object by id (drawn or not). */
  private byId = new Map<string, MapObject>();
  /** Doorway tile ("x,y") → id of the house with that door. */
  private doors = new Map<string, string>();
  /** Look key of every map object as last set (drawn or not), for diffing. */
  private lookKeys = new Map<string, string>();
  private resources: Record<string, number> = {};
  private entries = new Map<string, ObjEntry>();
  /** Tall object entries bucketed by the tiles their drawn rectangle touches. */
  private grid = new Map<number, ObjEntry[]>();
  private occluding = new Set<ObjEntry>();
  /** Living people inside each building (by building id). */
  private occupancy = new Map<string, number>();
  /** Interior spots by `${id}:${count}`. */
  private spots = new Map<string, Point[]>();

  constructor(
    /** Objects drawn within their footprint (under people). */
    private readonly under: Container,
    /** Objects drawn taller than their footprint (over people). */
    private readonly over: Container,
    private readonly textures: Record<SpriteName, Texture>,
  ) {}

  /** Shows the objects of `map`, changing only what differs from the map shown before. */
  setMap(map: WorldMap): void {
    this.byId = new Map();
    this.doors = new Map();
    const keys = new Map<string, string>();
    for (const o of map.objects) {
      this.byId.set(o.id, o);
      keys.set(o.id, lookKey(o));
      if (o.kind === 'house' && o.door) {
        const key = `${o.door.x},${o.door.y}`;
        if (!this.doors.has(key)) this.doors.set(key, o.id);
      }
    }
    const diff = diffObjects(this.lookKeys, map.objects);
    this.lookKeys = keys;

    // Changed and removed buildings lose their sprite, their cached spots and their occlusion.
    const stale = [...diff.changed.map((o) => o.id), ...diff.removed];
    const gone: Sprite[] = [];
    for (const id of stale) {
      const e = this.entries.get(id);
      if (!e) continue;
      gone.push(e.sprite);
      this.entries.delete(id);
      this.occluding.delete(e);
    }
    if (stale.length) this.dropSpots(new Set(stale));
    for (const id of diff.removed) this.occupancy.delete(id);
    this.removeSprites(gone);

    // New and changed objects get a sprite; their occupancy (if any) opens them up at once.
    for (const o of diff.added) this.addEntry(o);
    for (const o of diff.changed) this.addEntry(o);
    for (const o of diff.same) {
      const e = this.entries.get(o.id);
      if (e) e.obj = o;
    }

    if (diff.added.length + diff.changed.length + diff.removed.length > 0) this.rebuildGrid();
  }

  /** The map object with this id (any kind, drawn as a sprite or as ground). */
  object(id: string): MapObject | undefined {
    return this.byId.get(id);
  }

  /** Resource amounts changed (by object id): bushes show whether they have berries. */
  setResources(changes: Record<string, number>): void {
    Object.assign(this.resources, changes);
    const tex = this.textures;
    for (const id of Object.keys(changes)) {
      const e = this.entries.get(id);
      if (!e || !id.startsWith('berry_bush')) continue;
      // Set the normal texture too, so a later refresh (occupancy, occlusion) doesn't bring back
      // the old one.
      e.normal = (changes[id] ?? 0) >= 1 ? tex.berry_bush : tex.berry_bush_empty;
      this.refreshEntry(e);
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
        id = this.doors.get(`${v.x},${v.y}`);
      }
      if (!id || !this.entries.has(id)) continue;
      const list = groups.get(id);
      if (list) list.push(v);
      else groups.set(id, [v]);
    }
    const before = this.occupancy;
    this.occupancy = new Map();
    for (const [id, list] of groups) {
      const e = this.entries.get(id)!;
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const pts = this.spotsFor(e, list.length);
      list.forEach((v, i) => out.set(v.id, { ...pts[i]!, z: e.z + 1 }));
      this.occupancy.set(id, list.length);
    }
    this.applyOccupancy(before);
    return out;
  }

  /** Opens up or closes only the buildings whose occupied state changed since `before`. */
  private applyOccupancy(before: Map<string, number>): void {
    const occupied = (id: string) => (this.occupancy.get(id) ?? 0) > 0;
    for (const id of before.keys()) this.setInside(id, occupied(id));
    for (const id of this.occupancy.keys()) this.setInside(id, occupied(id));
  }

  private setInside(id: string, inside: boolean): void {
    const e = this.entries.get(id);
    if (!e || e.inside === inside) return;
    e.inside = inside;
    this.refreshEntry(e);
  }

  private refreshEntry(e: ObjEntry): void {
    const tex = e.inside && e.open ? e.open : e.normal;
    if (e.sprite.texture !== tex) e.sprite.texture = tex;
    let alpha = e.baseAlpha;
    if (e.inside && !e.open) alpha = Math.min(alpha, SEE_THROUGH_ALPHA);
    if (e.occluding) alpha = Math.min(alpha, OCCLUDER_ALPHA);
    if (e.sprite.alpha !== alpha) e.sprite.alpha = alpha;
  }

  /**
   * Fade whatever is drawn in front of a person (tree canopies, stall awnings) so nobody is
   * hidden. Only tall objects can be: everything else is drawn under people.
   */
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

  /** Creates the sprite and entry for an object (none for objects drawn as ground). */
  private addEntry(o: MapObject): void {
    const name = this.spriteFor(o);
    if (!name) return;
    const tex = this.textures;
    const s = new Sprite(tex[name]);
    s.cullable = false;
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
    const openName =
      o.kind === 'house' ? (`house_open${hashString(o.id) % HOUSE_VARIANTS}` as SpriteName) : null;
    // A field being cleared is bare dirt people walk on, whatever its sprite's size.
    const tall = o.kind !== 'field' && s.texture.frame.height > o.h * TILE_PX;
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
      inside: (this.occupancy.get(o.id) ?? 0) > 0,
      occluding: false,
      tall,
    };
    (tall ? this.over : this.under).addChild(s);
    this.entries.set(o.id, entry);
    if (entry.inside) this.refreshEntry(entry);
  }

  /** Takes sprites out of their layers and frees them. */
  private removeSprites(sprites: Sprite[]): void {
    if (sprites.length <= SINGLE_REMOVE_LIMIT) {
      for (const s of sprites) s.destroy();
      return;
    }
    // Pixi removes children one at a time by searching the child list, which is quadratic for
    // many sprites, so rebuild each layer's list in one pass (keeping graves in the under layer).
    const gone = new Set<Container>(sprites);
    for (const layer of [this.under, this.over]) {
      const keep = layer.children.filter((c) => !gone.has(c));
      if (keep.length === layer.children.length) continue;
      layer.removeChildren();
      if (keep.length) layer.addChild(...keep);
    }
    for (const s of sprites) s.destroy();
  }

  /** Rebuilds the tile grid of tall entries (called only when entries were added or removed). */
  private rebuildGrid(): void {
    this.grid.clear();
    for (const e of this.entries.values()) {
      if (!e.tall) continue;
      for (let ty = Math.floor(e.y / TILE_PX); ty <= Math.floor((e.y + e.h - 1) / TILE_PX); ty++)
        for (
          let tx = Math.floor(e.x / TILE_PX);
          tx <= Math.floor((e.x + e.w - 1) / TILE_PX);
          tx++
        ) {
          const key = ty * 100000 + tx;
          const list = this.grid.get(key);
          if (list) list.push(e);
          else this.grid.set(key, [e]);
        }
    }
  }

  /** Interior spots for a building holding `count` people, computed once per footprint. */
  private spotsFor(e: ObjEntry, count: number): Point[] {
    const key = `${e.obj.id}:${count}`;
    let pts = this.spots.get(key);
    if (!pts) {
      pts = interiorSpots(e.obj, count);
      this.spots.set(key, pts);
    }
    return pts;
  }

  /** Forgets the cached spots of these buildings (one pass over the cache). */
  private dropSpots(ids: Set<string>): void {
    for (const key of this.spots.keys())
      if (ids.has(key.slice(0, key.lastIndexOf(':')))) this.spots.delete(key);
  }

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
