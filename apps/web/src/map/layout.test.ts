import { describe, expect, it } from 'vitest';
import { interiorSpots, layoutBubbles, rectsOverlap, type Rect } from './layout.ts';

const house = { x: 10, y: 5, w: 3, h: 3, door: { x: 11, y: 7 } };

function minDistance(pts: { x: number; y: number }[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      m = Math.min(m, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
  return m;
}

describe('interiorSpots', () => {
  it('returns nothing for nobody and one spot inside for one person', () => {
    expect(interiorSpots(house, 0)).toEqual([]);
    const [p] = interiorSpots(house, 1);
    expect(p!.x).toBeGreaterThan(house.x * 16);
    expect(p!.x).toBeLessThan((house.x + 3) * 16);
    expect(p!.y).toBeGreaterThan(house.y * 16);
    expect(p!.y).toBeLessThan((house.y + 3) * 16);
  });

  it('keeps everyone inside the footprint, off the doorway and apart', () => {
    for (let n = 1; n <= 12; n++) {
      const spots = interiorSpots(house, n);
      expect(spots).toHaveLength(n);
      for (const s of spots) {
        expect(s.x).toBeGreaterThanOrEqual(house.x * 16);
        expect(s.x).toBeLessThanOrEqual((house.x + 3) * 16);
        expect(s.y).toBeGreaterThanOrEqual(house.y * 16);
        expect(s.y).toBeLessThanOrEqual((house.y + 3) * 16);
        const inDoorway =
          s.y >= (house.door.y + 0.25) * 16 && s.x >= 11 * 16 - 3 && s.x <= 12 * 16 + 3;
        expect(inDoorway).toBe(false);
      }
      expect(minDistance(spots)).toBeGreaterThan(0);
      if (n <= 6) expect(minDistance(spots)).toBeGreaterThanOrEqual(10);
    }
  });

  it('stays distinct when badly overcrowded and is deterministic', () => {
    const a = interiorSpots(house, 30);
    expect(minDistance(a)).toBeGreaterThan(0);
    expect(interiorSpots(house, 30)).toEqual(a);
  });

  it('works for a wider building', () => {
    const bakery = { x: 0, y: 0, w: 4, h: 3, door: { x: 2, y: 2 } };
    const spots = interiorSpots(bakery, 5);
    expect(minDistance(spots)).toBeGreaterThanOrEqual(10);
  });
});

describe('layoutBubbles', () => {
  const anyOverlap = (rs: Rect[]) =>
    rs.some((a, i) => rs.some((b, j) => i < j && rectsOverlap(a, b)));

  it('centres a lone bubble above the head', () => {
    const out = layoutBubbles([{ id: 'a', anchor: { x: 200, y: 300 }, w: 100, h: 30 }]);
    expect(out.get('a')).toEqual({ x: 150, y: 264 });
  });

  it('never overlaps bubbles of speakers standing at the same spot', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      anchor: { x: 200 + (i % 2), y: 300 },
      w: 120 + i * 5,
      h: 30 + (i % 3) * 15,
    }));
    const out = layoutBubbles(items);
    const rects = items.map((it) => ({ ...out.get(it.id)!, w: it.w, h: it.h }));
    expect(anyOverlap(rects)).toBe(false);
  });

  it('handles adjacent speakers, is deterministic, and avoids others name labels', () => {
    const items = [
      { id: 'b', anchor: { x: 120, y: 200 }, w: 90, h: 24 },
      { id: 'a', anchor: { x: 100, y: 200 }, w: 90, h: 24 },
      { id: 'c', anchor: { x: 140, y: 205 }, w: 90, h: 24 },
    ];
    const labels = items.map((it) => ({
      owner: it.id,
      rect: { x: it.anchor.x - 20, y: it.anchor.y - 2, w: 40, h: 14 },
    }));
    const one = layoutBubbles(items, labels);
    const two = layoutBubbles([...items].reverse(), labels);
    expect([...one.entries()].sort()).toEqual([...two.entries()].sort());
    const rects = items.map((it) => ({ ...one.get(it.id)!, w: it.w, h: it.h }));
    expect(anyOverlap(rects)).toBe(false);
    for (const it of items)
      for (const l of labels)
        if (l.owner !== it.id)
          expect(rectsOverlap({ ...one.get(it.id)!, w: it.w, h: it.h }, l.rect)).toBe(false);
  });
});
