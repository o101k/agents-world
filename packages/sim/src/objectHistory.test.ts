import { describe, expect, it } from 'vitest';
import type { Intent, MapObject, WorldEvent } from '@aw/shared';
import { step, type TickInput } from './engine.ts';
import { interactionTiles } from './spatial.ts';
import { createWorldState, type WorldState } from './world.ts';

function fresh(): WorldState {
  const s = createWorldState({ seed: 'object-history', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

/**
 * Run `ticks` ticks, giving `agentId` a plan on the first one (and `first` extra inputs), and
 * telling everyone else who asks to rest. Returns every event emitted.
 */
function play(
  s: WorldState,
  ticks: number,
  agentId: string | null,
  plan: Intent[] = [],
  first: TickInput[] = [],
): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = i === 0 ? [...first] : [];
    for (const a of s.agents) {
      if (!a.alive) continue;
      if (i === 0 && a.id === agentId) {
        inputs.push({ kind: 'decision', agentId, decision: { thought: '', goal: '', plan } });
      } else if (a.awaiting) {
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
        });
      }
    }
    events.push(...step(s, inputs).events);
  }
  return events;
}

/** Put an agent on the first tile from which it can use `o`. */
function standAt(s: WorldState, id: string, o: MapObject) {
  const a = s.agents.find((x) => x.id === id)!;
  const t = interactionTiles(s.map, o)[0]!;
  a.x = t.x;
  a.y = t.y;
  return a;
}

describe('object history tags', () => {
  it('tags both fire events with the house that burns', () => {
    const s = fresh();
    const home = s.map.objects.find((o) => o.kind === 'house')!;
    const events = play(
      s,
      150,
      null,
      [],
      [
        {
          kind: 'world_event',
          event: { kind: 'fire', intensity: 0.5, hours: 1, targetId: home.id },
        },
      ],
    );
    const fires = events.filter((e) => e.kind === 'fire');
    expect(fires.some((e) => e.text.includes('is on fire!'))).toBe(true);
    expect(fires.some((e) => e.text.includes('burnt down.'))).toBe(true);
    for (const e of fires) expect(e.objects).toEqual([home.id]);
  });

  it('tags every event of building a new house with that house', () => {
    const s = fresh();
    const before = new Set(s.map.objects.map((o) => o.id));
    const maren = s.agents.find((a) => a.name === 'Maren')!;
    maren.asleep = false;
    maren.action = null;
    maren.inventory.planks = 60;
    maren.skills.building = 60;
    let events: WorldEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const site = s.map.objects.find((o) => o.kind === 'house' && !before.has(o.id));
      if (site && site.progress === undefined) break;
      events = events.concat(play(s, 70, maren.id, [{ type: 'build_house' }]));
    }
    const site = s.map.objects.find((o) => o.kind === 'house' && !before.has(o.id))!;
    expect(site.progress).toBeUndefined();
    const built = events.filter((e) => e.kind === 'built' && e.text.includes(site.name!));
    expect(built.some((e) => e.text.includes('started building'))).toBe(true);
    expect(built.some((e) => e.text.includes('worked on'))).toBe(true);
    expect(built.some((e) => e.text.includes('finished building'))).toBe(true);
    for (const e of built) expect(e.objects).toEqual([site.id]);
  });

  it('tags picking a bush with the bush', () => {
    const s = fresh();
    const bush = s.map.objects.find((o) => o.kind === 'berry_bush')!;
    const a = standAt(s, 'a1', bush);
    a.knowledge[bush.id] = { lastSeenTick: s.tick };
    const events = play(s, 60, a.id, [{ type: 'gather', objectId: bush.id }]);
    const gathered = events.filter((e) => e.kind === 'gathered' && e.actors[0] === a.id);
    expect(gathered.length).toBeGreaterThan(0);
    for (const e of gathered) expect(e.objects).toEqual([bush.id]);
  });

  it('tags chopping a tree with the tree', () => {
    const s = fresh();
    const tree = s.map.objects.find(
      (o) => o.kind === 'tree' && interactionTiles(s.map, o).length > 0,
    )!;
    const a = standAt(s, 'a1', tree);
    const events = play(s, 60, a.id, [{ type: 'chop_wood', objectId: tree.id }]);
    const chopped = events.filter((e) => e.kind === 'gathered' && e.text.includes('chopped'));
    expect(chopped.length).toBeGreaterThan(0);
    for (const e of chopped) expect(e.objects).toEqual([tree.id]);
  });

  it('tags buying and selling at the market with the market', () => {
    const s = fresh();
    const market = s.map.objects.find((o) => o.kind === 'market')!;
    const a = standAt(s, 'a1', market);
    a.money = 100;
    const events = play(s, 60, a.id, [{ type: 'buy', item: 'bread', quantity: 2 }]);
    const traded = events.filter((e) => e.kind === 'traded');
    expect(traded.length).toBeGreaterThan(0);
    for (const e of traded) expect(e.objects).toEqual([market.id]);
  });

  it('leaves the objects key off events that have nothing to tag', () => {
    const s = fresh();
    const a = s.agents.find((x) => x.id === 'a1')!;
    a.inventory.bread = 2;
    const events = play(s, 20, a.id, [{ type: 'eat', item: 'bread' }]);
    expect(events.some((e) => e.kind === 'ate')).toBe(true);
    expect(events.filter((e) => e.kind === 'ate').every((e) => !('objects' in e))).toBe(true);
    for (const e of events) if ('objects' in e) expect(e.objects!.length).toBeGreaterThan(0);
  });
});
