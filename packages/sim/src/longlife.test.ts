import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Decision, type Intent } from '@aw/shared';
import { remember } from './agent.ts';
import { canDrinkAt, conditionLevel } from './conditions.ts';
import { step, type TickInput } from './engine.ts';
import { fadeMemories, nightOf } from './memory.ts';
import { buildPerception } from './perception.ts';
import { interactionTiles } from './spatial.ts';
import { Tile } from '@aw/shared';
import {
  createWorldState,
  deserializeWorldState,
  serializeWorldState,
  type WorldState,
} from './world.ts';

function fresh(seed = 'long-life'): WorldState {
  const s = createWorldState({ seed, mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}
const who = (s: WorldState, name: string) => s.agents.find((a) => a.name === name)!;
const rest: Decision = { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] };

/**
 * Run the world: named agents get a plan on the first tick; reflections get `reflect`; everyone
 * else who asks is told to rest. Needs are topped up so nobody dies of neglect in the test.
 */
function run(
  s: WorldState,
  ticks: number,
  opts: {
    plans?: Record<string, Intent[]>;
    first?: TickInput[];
    reflect?: (id: string, scope: 'day' | 'year') => Decision;
    feed?: boolean;
  } = {},
): void {
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = i === 0 ? [...(opts.first ?? [])] : [];
    for (const a of s.agents) {
      if (!a.alive) continue;
      if (opts.feed !== false) {
        a.needs.food = Math.max(a.needs.food, 60);
        a.needs.water = Math.max(a.needs.water, 60);
      }
      const plan = i === 0 ? opts.plans?.[a.id] : undefined;
      if (plan)
        inputs.push({ kind: 'decision', agentId: a.id, decision: { thought: '', goal: '', plan } });
      else if (a.awaiting?.kind === 'reflect')
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: opts.reflect?.(a.id, a.awaiting.scope) ?? {
            thought: '',
            goal: '',
            plan: [],
          },
        });
      else if (a.awaiting) {
        const night = s.tick % TICKS_PER_DAY >= 21 * 60 || s.tick % TICKS_PER_DAY < 5 * 60;
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: night ? { thought: '', goal: '', plan: [{ type: 'sleep' }] } : rest,
        });
      }
    }
    step(s, inputs);
  }
}

describe('memory over a long life', () => {
  it('fades trivial memories, keeps core ones, and records what was forgotten', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    maren.memories = [];
    remember(maren, s.tick, 'I saw a crow.', 2);
    remember(maren, s.tick, 'Tobias made me laugh.', 5);
    remember(maren, s.tick, 'Lise was born.', 10);
    for (let night = 0; night < 8; night++) fadeMemories(maren);
    expect(maren.memories.map((m) => m.text)).toEqual(['Tobias made me laugh.', 'Lise was born.']);
    expect(maren.forgotten.map((m) => m.text)).toEqual(['I saw a crow.']);
    for (let night = 0; night < 30; night++) fadeMemories(maren);
    expect(maren.memories.map((m) => m.text)).toEqual(['Lise was born.']);
    expect(maren.memories[0]!.strength).toBe(10);
  });

  it('lets memories from the first three years fade, however important', () => {
    const s = fresh();
    const lise = who(s, 'Lise'); // six months old
    remember(lise, s.tick, 'Mama sang to me.', 10);
    expect(lise.memories.at(-1)!.early).toBe(true);
    for (let night = 0; night < 12; night++) fadeMemories(lise);
    expect(lise.memories.some((m) => m.text === 'Mama sang to me.')).toBe(false);
  });

  it('asks sleepers to reflect each night and keeps their diary', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    remember(maren, s.tick, 'I argued with Piet at the market.', 6);
    // Run into the night: people go to bed and reflect.
    const nightStart = TICKS_PER_DAY + 21 * TICKS_PER_HOUR - s.tick;
    run(s, nightStart + 3 * TICKS_PER_HOUR, {
      reflect: (id) => ({
        thought: 'Tired.',
        goal: 'Make peace with Piet',
        plan: [{ type: 'explore' }],
        diary: `Diary of ${id}: a long day.`,
        beliefs: ['Piet cannot be trusted with money.'],
      }),
    });
    expect(maren.lastReflectDay).toBe(nightOf(s.tick));
    const diary = maren.memories.find((m) => m.kind === 'diary');
    expect(diary?.text).toBe(`Diary: Diary of ${maren.id}: a long day.`);
    expect(maren.memories.some((m) => m.kind === 'belief')).toBe(true);
    expect(maren.goal).toBe('Make peace with Piet');
    // Reflection doesn't wake anyone or give them a plan.
    expect(maren.asleep).toBe(true);
    expect(maren.plan).toEqual([]);
    // Babies and toddlers don't reflect.
    expect(who(s, 'Lise').memories.some((m) => m.kind === 'diary')).toBe(false);
  });

  it('writes a life chapter on a birthday, folding in the diary', () => {
    const s = fresh();
    s.settings.daysPerYear = 1; // a year a day
    const maren = who(s, 'Maren');
    maren.age = 34.95;
    run(s, TICKS_PER_DAY + 23 * TICKS_PER_HOUR - s.tick, {
      reflect: (_id, scope) => ({
        thought: '',
        goal: '',
        plan: [],
        diary: scope === 'year' ? 'The year Lise learned to crawl.' : 'Just another day.',
      }),
    });
    const chapter = maren.memories.find((m) => m.kind === 'chapter');
    expect(chapter?.text).toBe('My 35th year: The year Lise learned to crawl.');
    expect(maren.lastChapterAge).toBe(35);
    expect(maren.memories.some((m) => m.kind === 'diary')).toBe(false);
    const p = buildPerception(s, maren);
    expect(p.lifeChapters).toEqual([chapter!.text]);
  });
});

describe('world events', () => {
  it('a drought stunts growth and dries up the river', () => {
    const s = fresh();
    const bush = Object.entries(s.resources).find(([, r]) => r.max === 5)!;
    bush[1].amount = 0;
    const river = (() => {
      for (let y = 0; y < s.map.height; y++)
        for (let x = 0; x < s.map.width; x++) {
          const p = { x, y };
          if (s.map.tiles[y * s.map.width + x] !== Tile.Water && canDrinkAt(s, p)) {
            const nearWell = s.map.objects.some(
              (o) => o.kind === 'well' && Math.abs(o.x - x) <= 3 && Math.abs(o.y - y) <= 3,
            );
            if (!nearWell) return p;
          }
        }
      return null;
    })()!;
    expect(river).not.toBeNull();
    run(s, 1, {
      first: [{ kind: 'world_event', event: { kind: 'drought', intensity: 1, hours: 48 } }],
    });
    expect(conditionLevel(s, 'drought')).toBe(1);
    expect(canDrinkAt(s, river)).toBe(false);
    const well = s.map.objects.find((o) => o.kind === 'well')!;
    expect(interactionTiles(s.map, well).some((t) => canDrinkAt(s, t))).toBe(true);
    run(s, 24 * TICKS_PER_HOUR);
    expect(bush[1].amount).toBeLessThan(0.5); // normally 3 a day
    expect(buildPerception(s, who(s, 'Maren')).conditions.join(' ')).toMatch(/only the well/);
    run(s, 25 * TICKS_PER_HOUR);
    expect(s.conditions).toHaveLength(0);
  });

  it('a storm chills those outside but not those resting at home', () => {
    const s = fresh();
    const maren = who(s, 'Maren'); // starts at her door
    const piet = who(s, 'Piet');
    piet.x = maren.x + 4;
    piet.y = maren.y + 3;
    run(s, 3 * TICKS_PER_HOUR, {
      first: [{ kind: 'world_event', event: { kind: 'storm', intensity: 1, hours: 6 } }],
      plans: {
        [maren.id]: [{ type: 'rest', minutes: 600 }],
        [piet.id]: [{ type: 'rest', minutes: 600 }],
      },
    });
    expect(maren.indoorsId).toBe(maren.homeId);
    expect(maren.needs.warmth).toBe(100);
    expect(piet.needs.warmth).toBeLessThan(75);
    expect(piet.memories.some((m) => m.text.includes('storm'))).toBe(true);
  });

  it('a disease spreads between people close together; nursing helps; the recovered are immune', () => {
    const s = fresh();
    const wenna = who(s, 'Wenna');
    const aldric = who(s, 'Aldric');
    run(s, 1, {
      first: [
        {
          kind: 'world_event',
          event: { kind: 'disease', intensity: 1, hours: 72, targetId: aldric.id },
        },
      ],
    });
    expect(aldric.sickness).not.toBeNull();
    // Symptoms appear after a few hours.
    run(s, 4 * TICKS_PER_HOUR);
    expect(aldric.sickness?.known).toBe(true);
    expect(buildPerception(s, aldric).sick).toBe(true);
    // Nursing.
    aldric.indoorsId = null;
    wenna.x = aldric.x + 1;
    wenna.y = aldric.y;
    wenna.indoorsId = null;
    const before = aldric.sickness!.severity;
    run(s, 2, { plans: { [wenna.id]: [{ type: 'tend', agentId: aldric.id }] } });
    expect(aldric.sickness!.severity).toBeLessThan(before - 0.05);
    // Contagion: staying close to the sick for a day infects at least someone in the house.
    run(s, TICKS_PER_DAY);
    expect(s.agents.filter((a) => a.sickness || a.immuneUntil > 0).length).toBeGreaterThan(1);
    // Everyone recovers or dies in time; survivors are immune for a while.
    run(s, 6 * TICKS_PER_DAY);
    const recovered = s.agents.filter((a) => a.alive && a.immuneUntil > s.tick);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.every((a) => a.sickness === null)).toBe(true);
  });

  it('a fire drives people out, leaves a ruin that gives no shelter, and it can be rebuilt', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const home = s.map.objects.find((o) => o.id === maren.homeId)!;
    run(s, 2, { plans: { [maren.id]: [{ type: 'rest', minutes: 600 }] } });
    expect(maren.indoorsId).toBe(home.id);
    run(s, 61, {
      first: [
        {
          kind: 'world_event',
          event: { kind: 'fire', intensity: 0.2, hours: 1, targetId: home.id },
        },
      ],
    });
    expect(maren.indoorsId).toBeNull();
    expect(maren.memories.some((m) => m.text.includes('burning'))).toBe(true);
    expect(home.burntTick).toBeDefined();
    expect(home.progress).toBeLessThan(1);
    // No shelter in a ruin.
    run(s, 2, {
      plans: { [maren.id]: [{ type: 'go_to', target: { objectId: home.id } }, { type: 'sleep' }] },
    });
    run(s, 30);
    expect(maren.indoorsId).toBeNull();
    // Rebuild it.
    maren.asleep = false;
    maren.action = null;
    maren.inventory.planks = 60;
    maren.skills.building = 60;
    for (let i = 0; i < 12 && home.progress !== undefined; i++)
      run(s, 70, { plans: { [maren.id]: [{ type: 'build_house' }] } });
    expect(home.progress).toBeUndefined();
    expect(home.burntTick).toBeUndefined();
    run(s, 2, {
      plans: {
        [maren.id]: [
          { type: 'go_to', target: { objectId: home.id } },
          { type: 'rest', minutes: 60 },
        ],
      },
    });
    run(s, 40);
    expect(maren.indoorsId).toBe(home.id);
  });

  it('a bumper harvest fills the land', () => {
    const s = fresh();
    for (const r of Object.values(s.resources)) r.amount = 0;
    run(s, 1, {
      first: [
        { kind: 'world_event', event: { kind: 'bumper_harvest', intensity: 0.5, hours: 24 } },
      ],
    });
    expect(Object.values(s.resources).every((r) => r.amount === r.max || r.item === 'wood')).toBe(
      true,
    );
  });

  it('stays deterministic with world events', () => {
    const go = () => {
      const s = fresh('det');
      run(s, 2 * TICKS_PER_DAY, {
        first: [
          { kind: 'world_event', event: { kind: 'disease', intensity: 0.8, hours: 48 } },
          { kind: 'world_event', event: { kind: 'storm', intensity: 0.6, hours: 5 } },
          { kind: 'world_event', event: { kind: 'fire', intensity: 0.9, hours: 1 } },
        ],
        feed: false,
      });
      return JSON.stringify(serializeWorldState(s));
    };
    expect(go()).toBe(go());
  });

  it('upgrades a phase 4 save', () => {
    const s = fresh();
    const old = JSON.parse(JSON.stringify(serializeWorldState(s)));
    old.version = 5;
    delete old.conditions;
    delete old.nextConditionNum;
    for (const a of old.agents) {
      delete a.forgotten;
      delete a.sickness;
      delete a.immuneUntil;
      delete a.lastReflectDay;
      delete a.lastChapterAge;
      for (const m of a.memories) delete m.strength;
    }
    const up = deserializeWorldState(old);
    expect(up.version).toBe(6);
    expect(up.conditions).toEqual([]);
    const maren = up.agents[0]!;
    expect(maren.forgotten).toEqual([]);
    expect(maren.sickness).toBeNull();
    for (const m of maren.memories) expect(m.strength).toBe(m.importance);
    step(up, []);
  });
});
