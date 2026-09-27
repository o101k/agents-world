import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainRouter } from '@aw/brain';
import { fnv1a, serializeWorldState } from '@aw/sim';
import { WorldFile } from './worldFile.ts';
import { WorldManager } from './worldManager.ts';
import { WorldRunner } from './worldRunner.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-run-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const hash = (r: WorldRunner) => fnv1a(JSON.stringify(serializeWorldState(r.state)));

async function runUntil(runner: WorldRunner, tick: number) {
  runner.setSpeed(0);
  runner.setRunning(true);
  while (runner.state.tick < tick) await new Promise((r) => setTimeout(r, 5));
  runner.setRunning(false);
}

describe('WorldRunner', () => {
  it('advances time and records events', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Run', seed: 'run', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    await runUntil(runner, w.tick + 600);
    expect(runner.state.tick).toBeGreaterThanOrEqual(w.tick + 600);
    const events = wm.events(w.id, { limit: 50, minImportance: 1 });
    expect(events.length).toBeGreaterThan(5);
    expect(events.some((e) => e.kind === 'decided')).toBe(true);
    await wm.closeAll();
  });

  it('resumes exactly where it left off, even without a clean shutdown', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Resume', seed: 'resume', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    await runUntil(runner, w.tick + 700); // crosses a 6-hour snapshot boundary
    const tick = runner.state.tick;
    const expected = hash(runner);

    // Reopen the same file without stopping the first runner (simulates a crash:
    // no final snapshot, so the resume must replay logged inputs).
    const file = WorldFile.open(join(dir, 'worlds', `${w.id}.sqlite`));
    const resumed = WorldRunner.open(file, new BrainRouter());
    expect(resumed.state.tick).toBe(tick);
    expect(hash(resumed)).toBe(expected);
    await resumed.stop();
    file.close();
    await wm.closeAll();
  });

  it('continues identically after a restart', async () => {
    // World A runs 900 ticks straight; world B (same seed) runs 400, restarts, then 500 more.
    const wm = new WorldManager(dir);
    const a = await wm.create({ name: 'A', seed: 'same', mapSize: 'small' });
    const b = await wm.create({ name: 'B', seed: 'same', mapSize: 'small' });
    await wm.activate(a.id);
    await wm.active!.advance(900);
    const straight = hash(wm.active!);

    await wm.activate(b.id);
    await wm.active!.advance(400);
    await wm.closeAll();

    const wm2 = new WorldManager(dir);
    expect(wm2.activeWorldId).toBe(b.id);
    await wm2.active!.advance(500);
    expect(hash(wm2.active!)).toBe(straight);
    await wm2.closeAll();
  });
});

describe('spending cap', () => {
  it('pauses the world before a paid decision once the cap is reached', async () => {
    const paid = {
      id: 'anthropic' as const,
      decide: async () => ({
        decision: { thought: 'ok', goal: 'rest', plan: [{ type: 'rest' as const, minutes: 30 }] },
        usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.01 },
      }),
    };
    const wm = new WorldManager(dir, { brains: new BrainRouter([paid]) });
    const w = await wm.create({ name: 'Cap', seed: 'cap', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    await runner.submit({
      kind: 'set_default_brain',
      brain: { provider: 'anthropic', model: 'x', effort: 'standard' },
      applyToAll: true,
    });
    runner.setCap(0.05);
    runner.setSpeed(0);
    runner.setRunning(true);
    for (let i = 0; i < 200 && !runner.status().capReached; i++)
      await new Promise((r) => setTimeout(r, 10));
    const status = runner.status();
    expect(status.capReached).toBe(true);
    expect(status.running).toBe(false);
    expect(status.spentUsd).toBeGreaterThanOrEqual(0.05);
    expect(status.spentUsd).toBeLessThan(0.05 + 8 * 0.01 + 1e-9); // at most one batch over
    const events = wm.events(w.id, { limit: 20, minImportance: 5 });
    expect(events.some((e) => e.kind === 'cap_reached')).toBe(true);
    const calls = runner.state.agents.flatMap((a) => wm.calls(w.id, a.id));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.reduce((s, c) => s + c.costUsd, 0)).toBeCloseTo(status.spentUsd);
    await wm.closeAll();
  });
});
