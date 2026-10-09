import { describe, expect, it } from 'vitest';
import type { MapObject } from '@aw/shared';
import { diffObjects, lookKey } from './objectDiff.ts';

function obj(over: Partial<MapObject> = {}): MapObject {
  return { id: 'house_1', kind: 'house', x: 10, y: 5, w: 3, h: 3, door: { x: 11, y: 7 }, ...over };
}

/** The previous look keys, as the object layer keeps them. */
function keysOf(objects: MapObject[]): Map<string, string> {
  return new Map(objects.map((o) => [o.id, lookKey(o)]));
}

describe('lookKey', () => {
  it('changes with what is drawn or where it stands', () => {
    const base = lookKey(obj());
    expect(lookKey(obj({ kind: 'workshop' }))).not.toBe(base);
    expect(lookKey(obj({ x: 11 }))).not.toBe(base);
    expect(lookKey(obj({ y: 6 }))).not.toBe(base);
    expect(lookKey(obj({ w: 4 }))).not.toBe(base);
    expect(lookKey(obj({ h: 4 }))).not.toBe(base);
    expect(lookKey(obj({ stone: true }))).not.toBe(base);
  });

  it('tells a missing progress or burn tick apart from zero', () => {
    const base = lookKey(obj());
    expect(lookKey(obj({ progress: 0 }))).not.toBe(base);
    expect(lookKey(obj({ burntTick: 0 }))).not.toBe(base);
    expect(lookKey(obj({ progress: 0 }))).not.toBe(lookKey(obj({ burntTick: 0 })));
  });

  it('ignores fields that are not drawn', () => {
    const base = lookKey(obj());
    expect(lookKey(obj({ name: 'Mill House' }))).toBe(base);
    expect(lookKey(obj({ workDone: 4, stoneWork: 2 }))).toBe(base);
  });
});

describe('diffObjects', () => {
  const objects = [
    obj({ id: 'house_1' }),
    obj({ id: 'tree_1', kind: 'tree', x: 2, y: 2, w: 1, h: 1, door: undefined }),
    obj({ id: 'field_1', kind: 'field', x: 20, y: 20, w: 2, h: 2, door: undefined }),
  ];

  it('reports identical maps as all same', () => {
    const diff = diffObjects(
      keysOf(objects),
      objects.map((o) => ({ ...o })),
    );
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.same.map((o) => o.id)).toEqual(['house_1', 'tree_1', 'field_1']);
  });

  it('treats a building whose progress changed as changed', () => {
    const next = objects.map((o) => (o.id === 'house_1' ? { ...o, progress: 0.4 } : o));
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.changed.map((o) => o.id)).toEqual(['house_1']);
    expect(diff.changed[0]!.progress).toBe(0.4);
    expect(diff.same.map((o) => o.id)).toEqual(['tree_1', 'field_1']);
  });

  it('reports a new id as added', () => {
    const next = [...objects, obj({ id: 'house_2', x: 30 })];
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.added.map((o) => o.id)).toEqual(['house_2']);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('reports an id that is gone as removed', () => {
    const next = objects.filter((o) => o.id !== 'tree_1');
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.removed).toEqual(['tree_1']);
    expect(diff.added).toEqual([]);
    expect(diff.same.map((o) => o.id)).toEqual(['house_1', 'field_1']);
  });

  it('treats a moved object as changed', () => {
    const next = objects.map((o) => (o.id === 'tree_1' ? { ...o, x: 3 } : o));
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.changed.map((o) => o.id)).toEqual(['tree_1']);
  });

  it('treats a burnt building as changed', () => {
    const next = objects.map((o) => (o.id === 'house_1' ? { ...o, burntTick: 900 } : o));
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.changed.map((o) => o.id)).toEqual(['house_1']);
  });

  it('treats a field that finishes being cleared as changed (its sprite goes away)', () => {
    const cleared = [obj({ id: 'field_9', kind: 'field', x: 4, y: 4, w: 2, h: 2, progress: 0.9 })];
    const finished = [{ ...cleared[0]!, progress: undefined }];
    const diff = diffObjects(keysOf(cleared), finished);
    expect(diff.changed.map((o) => o.id)).toEqual(['field_9']);
    expect(diff.changed[0]!.progress).toBeUndefined();
    // And back again: a finished field that gets work starts with a sprite.
    const again = diffObjects(keysOf(finished), cleared);
    expect(again.changed.map((o) => o.id)).toEqual(['field_9']);
  });

  it('keeps the same objects (not copies) so the caller can compare identity', () => {
    const next = objects.map((o) => ({ ...o }));
    const diff = diffObjects(keysOf(objects), next);
    expect(diff.same[0]).toBe(next[0]);
  });
});
