import { describe, expect, it } from 'vitest';
import { Tile, type WorldMap } from '@aw/shared';
import { step } from './engine.ts';
import { findFreePlot } from './land.ts';
import { findPath, findPathToAny } from './pathfinding.ts';
import { invalidateMapCaches, isWalkable, nearestWalkable, objectsNear } from './spatial.ts';
import { createWorldState } from './world.ts';

describe('findPath', () => {
  it('finds a shortest path around a wall', () => {
    // 5x5 grid with a wall at x=2 except y=4.
    const wall = (x: number, y: number) => x === 2 && y < 4;
    const path = findPath(5, 5, { x: 0, y: 0 }, { x: 4, y: 0 }, (x, y) =>
      wall(x, y) ? Infinity : 1,
    );
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
    expect(path!.length).toBe(13);
    expect(path!.some((p) => wall(p.x, p.y))).toBe(false);
  });

  it('returns null when unreachable', () => {
    const path = findPath(3, 3, { x: 0, y: 0 }, { x: 2, y: 2 }, (x) => (x === 1 ? Infinity : 1));
    expect(path).toBeNull();
  });

  it('reuses scratch buffers cleanly across repeated findPath and findPathToAny calls', () => {
    const p1 = findPath(16, 16, { x: 0, y: 0 }, { x: 15, y: 15 }, () => 1);
    const p2 = findPath(8, 8, { x: 0, y: 0 }, { x: 7, y: 7 }, (x) => (x === 4 ? Infinity : 1));
    const p3 = findPathToAny(16, 16, { x: 0, y: 0 }, [{ x: 15, y: 15 }], () => 1);
    expect(p1).toHaveLength(31);
    expect(p2).toBeNull();
    expect(p3).toEqual(p1);
    expect(findPath(8, 8, { x: -1, y: 0 }, { x: 2, y: 2 }, () => 1)).toBeNull();
  });
});

describe('spatial & land regression checks', () => {
  it('objectsNear indexes large multi-cell objects across all overlapped cells and deduplicates', () => {
    const map: WorldMap = {
      width: 32,
      height: 32,
      tiles: new Uint8Array(32 * 32).fill(Tile.Grass),
      objects: [{ id: 'big-field', kind: 'field', x: 4, y: 4, w: 12, h: 12 }],
    };
    invalidateMapCaches(map);
    // Point near bottom-right corner (16, 16) is > 8 tiles from top-left (4, 4) — old -4 hack missed this!
    const nearBR = objectsNear(map, { x: 16, y: 16 }, 1);
    expect(nearBR.map((o) => o.id)).toEqual(['big-field']);
    // Wide query overlapping multiple cells returns the object only once.
    const nearCenter = objectsNear(map, { x: 10, y: 10 }, 10);
    expect(nearCenter.map((o) => o.id)).toEqual(['big-field']);
  });

  it('nearestWalkable requires walkability at d=0, checks bounds, and escapes multi-tile obstacles', () => {
    const map: WorldMap = {
      width: 16,
      height: 16,
      tiles: new Uint8Array(16 * 16).fill(Tile.Grass),
      objects: [{ id: 'b1', kind: 'bakery', x: 5, y: 5, w: 4, h: 3 }],
    };
    invalidateMapCaches(map);
    expect(nearestWalkable(map, { x: -1, y: 0 }, () => true)).toBeNull();
    expect(nearestWalkable(map, { x: 16, y: 5 }, () => true)).toBeNull();
    // Center of 4x3 bakery (6, 6) is unwalkable: must NOT return (6, 6) even though test returns true.
    const escaped = nearestWalkable(map, { x: 6, y: 6 }, () => true, 10);
    expect(escaped).not.toBeNull();
    expect(isWalkable(map, escaped!.x, escaped!.y)).toBe(true);
  });

  it('findFreePlot avoids outdoor living agents and go_to rejects out-of-bounds coordinates', () => {
    const s = createWorldState({ seed: 'spatial-check', mapSize: 'small' });
    const a = s.agents[0]!;
    a.indoorsId = null;
    a.asleep = false;
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    const anchor = { x: 20, y: 20 };
    const spot1 = findFreePlot(s, anchor, 4, 3, true)!;
    expect(spot1).not.toBeNull();
    // Place an outdoor living agent on spot1: findFreePlot must pick a plot not covering the agent.
    a.x = spot1.x + 1;
    a.y = spot1.y + 1;
    const spot2 = findFreePlot(s, anchor, 4, 3, true)!;
    expect(spot2).not.toBeNull();
    const coversAgent = a.x >= spot2.x && a.x < spot2.x + 4 && a.y >= spot2.y && a.y < spot2.y + 3;
    expect(coversAgent).toBe(false);
    // Out-of-bounds go_to fails cleanly.
    step(s, [
      {
        kind: 'decision',
        agentId: a.id,
        decision: { thought: '', goal: '', plan: [{ type: 'go_to', target: { x: 999, y: -5 } }] },
      },
    ]);
    expect(a.action).toBeNull();
    expect(a.recent.some((r) => r.text.includes("couldn't find a way"))).toBe(true);
  });
});
