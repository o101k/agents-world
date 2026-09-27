import { describe, expect, it } from 'vitest';
import { findPath } from './pathfinding.ts';

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
});
