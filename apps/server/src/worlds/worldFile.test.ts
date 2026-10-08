import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldMeta, WorldEvent } from '@aw/shared';
import { createWorldState, type WorldState } from '@aw/sim';
import { WorldFile } from './worldFile.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-file-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function meta(state: WorldState): WorldMeta {
  return {
    id: 'w1',
    name: 'Test',
    seed: 'seed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tick: state.tick,
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    population: state.agents.length,
    running: false,
    speed: 1,
    spentUsd: 0,
    planUsd: 0,
    capUsd: 1,
  };
}

/** A small world whose map has two named houses, "House 1" (h1) and "House 12" (h12). */
function namedState(): WorldState {
  const state = createWorldState({ seed: 'objects', mapSize: 'small' });
  state.map.objects.push(
    { id: 'h1', kind: 'house', x: 1, y: 1, w: 3, h: 3, name: 'House 1' },
    { id: 'h12', kind: 'house', x: 6, y: 1, w: 3, h: 3, name: 'House 12' },
  );
  return state;
}

function event(tick: number, text: string, importance: number, objects: string[], actor?: string) {
  return {
    tick,
    kind: 'gathered',
    actors: actor ? [actor] : [],
    text,
    importance,
    objects,
  } as WorldEvent;
}

describe('WorldFile object events', () => {
  it('stores the objects of an event and returns them with the event', () => {
    const state = namedState();
    const file = WorldFile.create(join(dir, 'a.sqlite'), meta(state), state);
    file.appendWorldEvents([event(5, 'House 1 is on fire!', 3, ['h1']), event(6, 'Plain.', 1, [])]);
    const events = file.queryEvents({ limit: 10, minImportance: 0 });
    expect(events.find((e) => e.text === 'House 1 is on fire!')?.objects).toEqual(['h1']);
    expect(events.find((e) => e.text === 'Plain.')?.objects).toBeUndefined();
    file.close();
  });

  it('splits an object history into milestones and routine uses, and ranks regulars', () => {
    const state = namedState();
    const file = WorldFile.create(join(dir, 'b.sqlite'), meta(state), state);
    file.appendWorldEvents([
      event(10, 'Ana gathered berries.', 1, ['h1'], 'ana'),
      event(11, 'Bo gathered berries.', 1, ['h1'], 'bo'),
      event(12, 'House 1 is on fire!', 3, ['h1']),
      event(13, 'Ana gathered berries.', 1, ['h1'], 'ana'),
      event(20, 'Cy visited House 1.', 2, ['h1'], 'cy'),
      event(30, 'Ana gathered berries.', 1, ['h12'], 'ana'),
    ]);
    const all = file.objectHistory('h1');
    expect(all.milestones.map((e) => e.text)).toEqual(['House 1 is on fire!']);
    expect(all.recent.map((e) => e.tick)).toEqual([20, 13, 11, 10]);
    expect(all.uses).toBe(4);
    expect(all.regulars).toEqual([
      { agentId: 'ana', count: 2 },
      { agentId: 'bo', count: 1 },
      { agentId: 'cy', count: 1 },
    ]);
    expect(file.objectHistory('h12').uses).toBe(1);
    file.close();
  });

  it('limits an object history to the moment it asks about', () => {
    const state = namedState();
    const file = WorldFile.create(join(dir, 'c.sqlite'), meta(state), state);
    file.appendWorldEvents([
      event(10, 'Ana gathered berries.', 1, ['h1'], 'ana'),
      event(12, 'House 1 is on fire!', 3, ['h1']),
      event(40, 'Bo gathered berries.', 1, ['h1'], 'bo'),
    ]);
    const past = file.objectHistory('h1', 20);
    expect(past.milestones.map((e) => e.tick)).toEqual([12]);
    expect(past.recent.map((e) => e.tick)).toEqual([10]);
    expect(past.uses).toBe(1);
    expect(past.regulars).toEqual([{ agentId: 'ana', count: 1 }]);
    file.close();
  });

  it('knows what was there when the world was created', () => {
    const state = namedState();
    const file = WorldFile.create(join(dir, 'd.sqlite'), meta(state), state);
    expect([...file.foundingObjectIds()].sort()).toEqual(state.map.objects.map((o) => o.id).sort());
    // A brand-new world has nothing to recover, so its history is complete from the start.
    expect(file.objectHistorySince()).toBe(0);
    file.close();
  });

  it('recovers building and fire history of a world saved before object history', () => {
    const state = namedState();
    const path = join(dir, 'old.sqlite');
    WorldFile.create(path, meta(state), state).close();

    // Turn it back into a version 3 file with only the events the old game had.
    const raw = new Database(path);
    raw.exec("DROP TABLE event_objects; DELETE FROM meta WHERE key = 'objectHistorySince';");
    raw.pragma('user_version = 3');
    const insert = raw.prepare(
      'INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)',
    );
    insert.run(
      4,
      'built',
      '[]',
      JSON.stringify({ text: 'Ana started building House 1.', importance: 3 }),
    );
    insert.run(5, 'fire', '[]', JSON.stringify({ text: 'House 12 is on fire!', importance: 3 }));
    insert.run(6, 'fire', '[]', JSON.stringify({ text: 'House 1 is on fire!', importance: 3 }));
    insert.run(7, 'gathered', '[]', JSON.stringify({ text: 'House 1 is nice.', importance: 1 }));
    raw.close();

    const file = WorldFile.open(path);
    expect(file.objectHistory('h1').milestones.map((e) => e.text)).toEqual([
      'Ana started building House 1.',
      'House 1 is on fire!',
    ]);
    expect(file.objectHistory('h12').milestones.map((e) => e.text)).toEqual([
      'House 12 is on fire!',
    ]);
    // Day-to-day use is recorded from the upgrade on.
    expect(file.objectHistorySince()).toBe(state.tick);
    file.close();
  });

  it('still opens a world whose history cannot be recovered', () => {
    const state = namedState();
    const path = join(dir, 'broken.sqlite');
    WorldFile.create(path, meta(state), state).close();
    const raw = new Database(path);
    raw.exec('DROP TABLE event_objects; DELETE FROM snapshots;');
    raw.pragma('user_version = 3');
    raw.close();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = WorldFile.open(path);
    expect(spy).toHaveBeenCalled();
    expect(file.queryEvents({ limit: 5, minImportance: 0 })).toEqual(expect.any(Array));
    file.close();
    spy.mockRestore();
  });
});
