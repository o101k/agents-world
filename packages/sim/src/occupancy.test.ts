import { describe, expect, it } from 'vitest';
import { Tile, type Intent } from '@aw/shared';
import { generateCast } from './generate.ts';
import { step, type TickInput } from './engine.ts';
import { occupies } from './occupancy.ts';
import { interactionTiles, invalidateMapCaches, isWalkable } from './spatial.ts';
import { createWorldState, type WorldState } from './world.ts';

/** Nobody shares a tile outdoors. Returns the first clash, or null. */
function clash(s: WorldState): string | null {
  const seen = new Map<number, string>();
  for (const a of s.agents) {
    if (!occupies(a)) continue;
    const i = a.y * s.map.width + a.x;
    const other = seen.get(i);
    if (other) return `${other} and ${a.id} at (${a.x},${a.y}) on tick ${s.tick}`;
    seen.set(i, a.id);
  }
  return null;
}

/** Advance one tick; `plans` are given on the first tick, everyone else awaiting gets `fallback`. */
function tick(
  s: WorldState,
  plans: Record<string, Intent[]> = {},
  fallback: (id: string) => Intent[] = () => [{ type: 'rest', minutes: 600 }],
): void {
  const inputs: TickInput[] = [];
  for (const a of s.agents) {
    if (!a.alive) continue;
    const plan = plans[a.id];
    if (plan)
      inputs.push({ kind: 'decision', agentId: a.id, decision: { thought: '', goal: '', plan } });
    else if (a.awaiting)
      inputs.push({
        kind: 'decision',
        agentId: a.id,
        decision: { thought: '', goal: '', plan: fallback(a.id) },
      });
  }
  step(s, inputs);
}

function calm(s: WorldState): void {
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
}

/** A world that is a single 1-tile-wide bridge (row 10, x 5..20) over water, with two people. */
function bridgeWorld(): WorldState {
  const s = createWorldState({ seed: 'bridge', mapSize: 'small' });
  s.agents = s.agents.filter((a) => a.id === 'a1' || a.id === 'a2');
  const { map } = s;
  map.tiles.fill(Tile.Water);
  for (let x = 5; x <= 20; x++) map.tiles[10 * map.width + x] = Tile.Bridge;
  map.objects = [];
  s.resources = {};
  s.owners = {};
  invalidateMapCaches(map);
  for (const a of s.agents) {
    a.homeId = null;
    a.indoorsId = null;
  }
  calm(s);
  return s;
}

describe('one person per tile outdoors', () => {
  it('two people meeting on a one-tile bridge pass each other and both arrive', () => {
    const s = bridgeWorld();
    const [a, b] = s.agents as [(typeof s.agents)[0], (typeof s.agents)[0]];
    a.x = 5;
    a.y = 10;
    b.x = 20;
    b.y = 10;
    const plans = {
      [a.id]: [{ type: 'go_to', target: { x: 20, y: 10 } } as Intent],
      [b.id]: [{ type: 'go_to', target: { x: 5, y: 10 } } as Intent],
    };
    tick(s, plans);
    for (let i = 0; i < 40; i++) {
      expect(clash(s)).toBeNull();
      tick(s);
    }
    expect(clash(s)).toBeNull();
    expect([a.x, a.y]).toEqual([20, 10]);
    expect([b.x, b.y]).toEqual([5, 10]);
  });

  it('walks round or waits for someone standing still, never onto them', () => {
    const s = createWorldState({ seed: 'standing', mapSize: 'small' });
    calm(s);
    const well = s.map.objects.find((o) => o.kind === 'well')!;
    const tiles = interactionTiles(s.map, well);
    const sitter = s.agents[0]!;
    const walker = s.agents[1]!;
    for (const a of s.agents) a.indoorsId = null;
    sitter.x = tiles[0]!.x;
    sitter.y = tiles[0]!.y;
    walker.x = tiles[0]!.x + 6;
    walker.y = tiles[0]!.y + 6;
    if (!isWalkable(s.map, walker.x, walker.y)) {
      walker.x = tiles[0]!.x - 6;
      walker.y = tiles[0]!.y - 6;
    }
    tick(
      s,
      {
        [sitter.id]: [{ type: 'rest', minutes: 600 }],
        [walker.id]: [{ type: 'go_to', target: { objectId: well.id } }],
      },
      () => [{ type: 'rest', minutes: 600 }],
    );
    for (let i = 0; i < 120; i++) {
      expect(clash(s)).toBeNull();
      tick(s);
    }
    expect([sitter.x, sitter.y]).toEqual([tiles[0]!.x, tiles[0]!.y]);
    expect(tiles.some((t) => t.x === walker.x && t.y === walker.y)).toBe(true);
  });

  it('keeps 40 people on separate tiles for several hours of sending everyone to the same places', () => {
    const cast = generateCast('crowd', { adults: 28, children: 12 });
    const s = createWorldState({ seed: 'crowd', mapSize: 'medium', cast });
    calm(s);
    const well = s.map.objects.find((o) => o.kind === 'well')!;
    const market = s.map.objects.find((o) => o.kind === 'market')!;
    const spots = [well, market];
    const goTo = (i: number): Intent[] => [
      { type: 'go_to', target: { objectId: spots[i % 2]!.id } },
      { type: 'rest', minutes: 10 },
      { type: 'go_to', target: { objectId: spots[(i + 1) % 2]!.id } },
    ];
    const plans: Record<string, Intent[]> = {};
    s.agents.forEach((a, i) => (plans[a.id] = goTo(i)));
    tick(s, plans, (id) => goTo(Number(id.slice(1))));
    for (let i = 0; i < 4 * 60; i++) {
      expect(clash(s)).toBeNull();
      tick(s, {}, (id) => goTo(Number(id.slice(1)) + s.tick));
    }
    expect(clash(s)).toBeNull();
  });

  it('lets housemates share the door tile while indoors', () => {
    const s = createWorldState({ seed: 'indoors', mapSize: 'small' });
    calm(s);
    const house = s.map.objects.find((o) => o.kind === 'house')!;
    const inside = s.agents.filter((a) => a.homeId === house.id).slice(0, 2);
    expect(inside.length).toBe(2);
    for (const a of inside) {
      a.x = house.door!.x;
      a.y = house.door!.y;
      a.indoorsId = house.id;
      a.action = { type: 'rest', until: s.tick + 600 };
    }
    for (let i = 0; i < 10; i++) tick(s);
    for (const a of inside) {
      expect(a.indoorsId).toBe(house.id);
      expect([a.x, a.y]).toEqual([house.door!.x, house.door!.y]);
    }
  });

  it('spreads people who were put on the same tile', () => {
    const s = createWorldState({ seed: 'spread', mapSize: 'small' });
    calm(s);
    const crowd = s.agents.slice(0, 6);
    const spot = interactionTiles(
      s.map,
      s.map.objects.find((o) => o.kind === 'well')!,
    )[0]!;
    expect(isWalkable(s.map, spot.x, spot.y)).toBe(true);
    for (const a of crowd) {
      a.x = spot.x;
      a.y = spot.y;
      a.indoorsId = null;
      a.action = { type: 'rest', until: s.tick + 600 };
    }
    tick(s);
    expect(clash(s)).toBeNull();
    // The first keeps the tile; everyone else is close by.
    expect([crowd[0]!.x, crowd[0]!.y]).toEqual([spot.x, spot.y]);
    for (const a of crowd)
      expect(Math.abs(a.x - spot.x) + Math.abs(a.y - spot.y)).toBeLessThanOrEqual(3);
  });

  it('a walker pushed off its path re-routes to where it was going', () => {
    const s = createWorldState({ seed: 'reroute', mapSize: 'small' });
    calm(s);
    const [a, b] = s.agents as [(typeof s.agents)[0], (typeof s.agents)[0]];
    for (const p of s.agents) p.indoorsId = null;
    a.x = 12;
    a.y = 12;
    b.x = 12;
    b.y = 12;
    for (const p of s.agents.slice(2)) {
      p.x = 40;
      p.y = 40 + s.agents.indexOf(p);
    }
    tick(s, { [b.id]: [{ type: 'go_to', target: { x: 20, y: 12 } }] });
    for (let i = 0; i < 40; i++) {
      expect(clash(s)).toBeNull();
      tick(s);
    }
    expect([b.x, b.y]).toEqual([20, 12]);
  });

  it('a line of walkers moves up together and goes round someone resting in the way', () => {
    const s = createWorldState({ seed: 'line', mapSize: 'small' });
    s.agents = s.agents.slice(0, 5);
    const { map } = s;
    map.tiles.fill(Tile.Grass);
    map.objects = [];
    s.resources = {};
    s.owners = {};
    invalidateMapCaches(map);
    for (const a of s.agents) {
      a.homeId = null;
      a.indoorsId = null;
    }
    calm(s);
    // Four walkers one behind the other along row 10, and someone resting at (12, 10).
    const walkers = s.agents.slice(0, 4);
    walkers.forEach((a, k) => {
      a.x = 5 - k;
      a.y = 10;
    });
    const rester = s.agents[4]!;
    rester.x = 12;
    rester.y = 10;
    const plans: Record<string, Intent[]> = { [rester.id]: [{ type: 'rest', minutes: 600 }] };
    for (const a of walkers)
      plans[a.id] = [{ type: 'go_to', target: { x: 20 - (5 - a.x), y: 10 } }];
    tick(s, plans);
    for (let t = 0; t < 40; t++) {
      tick(s);
      expect(clash(s)).toBeNull();
    }
    // Nobody waited behind anybody: the whole line arrived together in a straight line.
    walkers.forEach((a, k) => expect([a.x, a.y]).toEqual([20 - k, 10]));
    expect(rester.action?.type).toBe('rest');
  });
});
