import { describe, expect, it } from 'vitest';
import { stageOf } from './agent.ts';
import { decodeMap, encodeMap } from './map.ts';
import { CreateWorldRequest, EventsQuery, WorldEventRequest } from './protocol.ts';
import { formatClock, tickToClock } from './time.ts';
import { speedLabel } from './world.ts';

describe('shared helpers', () => {
  it('turns ticks into clock time', () => {
    expect(tickToClock(0)).toEqual({ day: 1, hour: 0, minute: 0 });
    expect(tickToClock(1440 + 7 * 60 + 5)).toEqual({ day: 2, hour: 7, minute: 5 });
    expect(formatClock(420)).toBe('Day 1, 07:00');
  });

  it('names life stages by age', () => {
    expect([0.5, 2, 7, 15, 30, 70].map(stageOf)).toEqual([
      'infant',
      'toddler',
      'child',
      'teen',
      'adult',
      'elder',
    ]);
  });

  it('labels speeds', () => {
    expect(speedLabel(0)).toBe('Max');
    expect(speedLabel(60)).toBe('60×');
  });

  it('round-trips a map through its wire form', () => {
    const map = {
      width: 2,
      height: 2,
      tiles: new Uint8Array([0, 1, 2, 3]),
      objects: [{ id: 'well-1', kind: 'well' as const, x: 1, y: 1, w: 1, h: 1 }],
    };
    const back = decodeMap(encodeMap(map));
    expect([...back.tiles]).toEqual([0, 1, 2, 3]);
    expect(back.objects).toEqual(map.objects);
  });
});

describe('request validation', () => {
  it('fills in defaults for a new world', () => {
    expect(CreateWorldRequest.parse({ name: ' My village ' })).toEqual({
      name: 'My village',
      mapSize: 'medium',
      cast: { mode: 'sample' },
    });
  });

  it('rejects bad input', () => {
    expect(CreateWorldRequest.safeParse({ name: '' }).success).toBe(false);
    expect(CreateWorldRequest.safeParse({ name: 'x', mapSize: 'gigantic' }).success).toBe(false);
    expect(WorldEventRequest.safeParse({ kind: 'meteor' }).success).toBe(false);
    expect(WorldEventRequest.safeParse({ kind: 'storm', intensity: 5 }).success).toBe(false);
  });

  it('applies world event and event query defaults', () => {
    expect(WorldEventRequest.parse({ kind: 'drought' })).toEqual({
      kind: 'drought',
      intensity: 0.6,
      hours: 24,
    });
    expect(EventsQuery.parse({ limit: '50', q: '  fire ' })).toMatchObject({
      limit: 50,
      q: 'fire',
      minImportance: 1,
    });
  });
});
