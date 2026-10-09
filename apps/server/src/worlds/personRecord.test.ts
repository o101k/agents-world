import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecordEntry } from '@aw/shared';
import { fullName } from '@aw/sim';
import { WorldManager } from './worldManager.ts';
import { WorldFile } from './worldFile.ts';
import { buildDigest, lifeSpan, sampleEvenly } from './personRecord.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-record-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A world run for three in-game days on the Mock brains, and one of its grown-ups. */
async function setup() {
  const wm = new WorldManager(dir);
  const meta = await wm.create({ name: 'Record', seed: 'record', mapSize: 'small' });
  await wm.activate(meta.id);
  const runner = wm.active!;
  await runner.advance(3 * 1440);
  runner.persist();
  const agent = runner.state.agents.find((a) => a.alive && a.age >= 18)!;
  const file = WorldFile.open(join(dir, 'worlds', `${meta.id}.sqlite`));
  return { wm, runner, agent, file, id: meta.id };
}

describe('sampleEvenly', () => {
  it('keeps the first and last, evenly spaced, deterministically', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sampleEvenly(items, 3)).toEqual([1, 6, 10]);
    expect(sampleEvenly(items, 3)).toEqual(sampleEvenly(items, 3));
    expect(sampleEvenly(items, 10)).toEqual(items);
    expect(sampleEvenly(items, 1)).toEqual([1]);
    expect(sampleEvenly(items, 0)).toEqual([]);
    expect(sampleEvenly([1, 2], 5)).toEqual([1, 2]);
  });
});

describe('recordPage', () => {
  it('lists the newest first, counts every kind, and pages', async () => {
    const { wm, id, agent, file } = await setup();
    try {
      const all = wm.record(id, agent.id, { limit: 500, offset: 0 });
      expect(all.entries.length).toBeGreaterThan(0);
      const ticks = all.entries.map((e) => e.tick);
      expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
      const counted = Object.values(all.counts).reduce((s, n) => s + n, 0);
      expect(all.total).toBe(counted);
      expect(all.counts.thought).toBeGreaterThan(0);

      const page = wm.record(id, agent.id, { limit: 2, offset: 2 });
      expect(page.entries).toEqual(all.entries.slice(2, 4));
      expect(page.total).toBe(all.total);
      expect(page.days.length).toBeGreaterThan(0);
      expect(page.days.reduce((s, d) => s + d.entries, 0)).toBeGreaterThan(0);
    } finally {
      file.close();
      await wm.closeAll();
    }
  });

  it('filters by kinds, ignoring unknown ones', async () => {
    const { wm, id, agent, file } = await setup();
    try {
      const thoughts = wm.record(id, agent.id, { kinds: 'thought', limit: 500 });
      expect(thoughts.entries.every((e) => e.kind === 'thought')).toBe(true);
      expect(thoughts.total).toBe(thoughts.counts.thought);
      const both = wm.record(id, agent.id, { kinds: 'bogus, thought', limit: 500 });
      expect(both.total).toBe(thoughts.total);
    } finally {
      file.close();
      await wm.closeAll();
    }
  });

  it('clamps the period to their life and swaps it when backwards', async () => {
    const { wm, id, agent, file, runner } = await setup();
    try {
      const span = lifeSpan(file, runner.state, agent);
      const wide = wm.record(id, agent.id, { from: 0, to: 10_000_000 });
      expect(wide.fromTick).toBe(span.from);
      expect(wide.toTick).toBe(span.to);
      expect(wide.lifeFromTick).toBe(span.from);
      expect(wide.lifeToTick).toBe(span.to);

      const backwards = wm.record(id, agent.id, {
        from: span.from + 1000,
        to: span.from + 100,
      });
      expect(backwards.fromTick).toBe(span.from + 100);
      expect(backwards.toTick).toBe(span.from + 1000);
    } finally {
      file.close();
      await wm.closeAll();
    }
  });
});

describe('buildDigest', () => {
  it('respects the quotas for each effort and keeps the first and last of a long list', async () => {
    const { agent, file, runner } = await setup();
    try {
      const span = lifeSpan(file, runner.state, agent);
      const thoughtsOf = (entries: RecordEntry[]) => entries.filter((e) => e.kind === 'thought');
      const everything = buildDigest(file, runner.state, agent, span.from, span.to, 'deep');
      const allThoughts = thoughtsOf(everything.entries);
      expect(everything.omitted).toBe(everything.total - everything.entries.length);

      const frugal = buildDigest(file, runner.state, agent, span.from, span.to, 'frugal');
      expect(thoughtsOf(frugal.entries).length).toBeLessThanOrEqual(15);
      expect(frugal.entries.filter((e) => e.kind === 'said').length).toBeLessThanOrEqual(15);
      expect(frugal.entries.filter((e) => e.kind === 'memory').length).toBeLessThanOrEqual(10);
      expect(frugal.entries.length).toBeLessThanOrEqual(frugal.total);
      expect(frugal.entries.reduce((s, e) => s + e.text.length, 0)).toBeLessThanOrEqual(9_000);
      expect(frugal.entries.every((e) => e.text.length <= 600)).toBe(true);
      expect(frugal.omitted).toBe(frugal.total - frugal.entries.length);

      const deep = buildDigest(file, runner.state, agent, span.from, span.to, 'deep');
      expect(deep.entries.length).toBeGreaterThanOrEqual(frugal.entries.length);

      // Their first and last thoughts survive sampling.
      expect(allThoughts.length).toBeGreaterThan(15);
      const frugalThoughts = thoughtsOf(frugal.entries);
      expect(frugalThoughts[0]?.tick).toBe(allThoughts[0]?.tick);
      expect(frugalThoughts.at(-1)?.tick).toBe(allThoughts.at(-1)?.tick);
    } finally {
      file.close();
    }
  });

  it('describes the period, the person and who they dealt with', async () => {
    const { agent, file, runner } = await setup();
    try {
      const span = lifeSpan(file, runner.state, agent);
      const digest = buildDigest(file, runner.state, agent, span.from, span.to, 'standard');
      expect(digest.name).toBe(fullName(agent));
      expect(digest.firstName).toBe(agent.name);
      expect(digest.period.wholeLife).toBe(true);
      expect(digest.period.endsNow).toBe(true);
      expect(digest.period.label).toMatch(/^Day 1, \d\d:\d\d – Day \d+, \d\d:\d\d$/);
      expect(digest.companions.every((c) => c.name !== fullName(agent))).toBe(true);
      expect(digest.companions.length).toBeLessThanOrEqual(8);

      const oneDay = buildDigest(file, runner.state, agent, span.from, span.from + 1440, 'frugal');
      expect(oneDay.period.wholeLife).toBe(false);
      expect(oneDay.total).toBeLessThanOrEqual(digest.total);
    } finally {
      file.close();
    }
  });
});
