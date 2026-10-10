import type { MapObject } from '@aw/shared';

/**
 * Pure helpers for updating the drawn map objects when a new map arrives. Kept free of PixiJS
 * so they can be unit-tested.
 */

/**
 * What changes how or where an object is drawn: two objects with the same key look and sit the
 * same, so the layer can keep the sprite it already has. The id is the map key, not part of it,
 * and fields that aren't drawn (name, resources, work done) are left out on purpose.
 */
export function lookKey(o: MapObject): string {
  return [
    o.kind,
    o.x,
    o.y,
    o.w,
    o.h,
    o.progress ?? '-',
    o.burntTick ?? '-',
    o.stone ? 1 : 0,
    // Room spots keep clear of the door.
    o.door ? `${o.door.x},${o.door.y}` : '-',
  ].join('|');
}

export interface ObjectDiff {
  /** Objects with an id not seen before. */
  added: MapObject[];
  /** Known ids whose look key changed. */
  changed: MapObject[];
  /** Ids that were known but are gone from the new map. */
  removed: string[];
  /** Known ids whose look key is unchanged. */
  same: MapObject[];
  /**
   * Look key of every object of the new map (id → key), drawn or not. Keep it as the `prev` of
   * the next diff, so no look key is computed twice.
   */
  keys: Map<string, string>;
}

/**
 * Compares a previous map (id → look key, for every object, drawn or not) with the objects of a
 * new map. Each object's look key is computed once; the keys come back in `keys`.
 */
export function diffObjects(prev: Map<string, string>, next: MapObject[]): ObjectDiff {
  const diff: ObjectDiff = { added: [], changed: [], removed: [], same: [], keys: new Map() };
  for (const o of next) {
    const key = lookKey(o);
    diff.keys.set(o.id, key);
    const before = prev.get(o.id);
    if (before === undefined) diff.added.push(o);
    else if (before === key) diff.same.push(o);
    else diff.changed.push(o);
  }
  for (const id of prev.keys()) if (!diff.keys.has(id)) diff.removed.push(id);
  return diff;
}
