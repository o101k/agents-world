import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainRouter, UsageLimitError } from '@aw/brain';
import { fnv1a, serializeWorldState } from '@aw/sim';
import { Replayer } from './replayer.ts';
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

  it('replays world events and night-time reflections exactly after a crash', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Events', seed: 'events', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    await runUntil(runner, w.tick + 60);
    await wm.worldEvent(w.id, { kind: 'disease', intensity: 0.8, hours: 30 });
    await wm.worldEvent(w.id, { kind: 'storm', intensity: 0.5, hours: 3 });
    await runUntil(runner, w.tick + 1200); // through the night: diaries get written
    expect(runner.state.conditions.some((c) => c.kind === 'disease')).toBe(true);
    const diaries = wm.events(w.id, { limit: 50, minImportance: 1, q: 'diary' });
    expect(diaries.length).toBeGreaterThan(0);
    const someone = diaries[0]!.actors[0]!;
    const story = wm.story(w.id, someone);
    expect(story.some((e) => e.source === 'memory')).toBe(true);
    expect(story.every((e, i) => i === 0 || e.tick >= story[i - 1]!.tick)).toBe(true);

    const tick = runner.state.tick;
    const expected = hash(runner);
    const file = WorldFile.open(join(dir, 'worlds', `${w.id}.sqlite`));
    const resumed = WorldRunner.open(file, new BrainRouter());
    expect(resumed.state.tick).toBe(tick);
    expect(hash(resumed)).toBe(expected);
    await resumed.stop();
    file.close();
    await wm.closeAll();
  });

  it('replays any past moment exactly, backwards and forwards, without asking any brain', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Replay', seed: 'replay', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    const marks: [number, string][] = [];
    for (const n of [90, 500, 1100, 1700]) {
      await runner.advance(w.tick + n - runner.state.tick);
      if (n === 500) await wm.worldEvent(w.id, { kind: 'storm', intensity: 0.7, hours: 4 });
      marks.push([runner.state.tick, hash(runner)]);
    }
    runner.persist();
    const file = WorldFile.open(join(dir, 'worlds', `${w.id}.sqlite`));
    const replayer = new Replayer(file);
    const stateHash = (t: number) => fnv1a(JSON.stringify(serializeWorldState(replayer.at(t))));
    for (const [t, h] of [...marks].reverse()) expect(stateHash(t)).toBe(h);
    for (const [t, h] of marks) expect(stateHash(t)).toBe(h);
    file.close();

    const view = wm.replay(w.id, marks[1]![0], -1);
    expect(view.tick).toBe(marks[1]![0]);
    expect(view.lastTick).toBe(runner.state.tick);
    expect(view.map).toBeDefined();
    expect(view.conditions.map((c) => c.kind)).toEqual(['storm']);
    expect(wm.replay(w.id, 0, view.mapVersion).tick).toBe(view.firstTick);
    expect(wm.replay(w.id, 0, view.mapVersion).map).toBeUndefined();
    expect(wm.replayAgent(w.id, marks[0]![0], 'a1').name).toBe('Maren Holt');
    const early = wm.events(w.id, { limit: 500, minImportance: 1, atOrBeforeTick: marks[0]![0] });
    expect(early.every((e) => e.tick <= marks[0]![0])).toBe(true);
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

describe('Claude subscription limit', () => {
  it('ignores the spending cap, pauses when the plan limit is used up, and Play clears it', async () => {
    let limited = false;
    let calls = 0;
    const plan = {
      id: 'claude_plan' as const,
      decide: async () => {
        calls++;
        if (limited) throw new UsageLimitError("You've hit your limit", Date.now() + 3_600_000);
        return {
          decision: { thought: 'ok', goal: 'rest', plan: [{ type: 'rest' as const, minutes: 30 }] },
          usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0 },
        };
      },
    };
    const wm = new WorldManager(dir, { brains: new BrainRouter([plan]) });
    const w = await wm.create({ name: 'Plan', seed: 'plan', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    await runner.submit({
      kind: 'set_default_brain',
      brain: { provider: 'claude_plan', model: 'haiku', effort: 'standard' },
      applyToAll: true,
    });
    runner.setCap(0); // the cap counts API money only
    await runUntil(runner, runner.state.tick + 30);
    expect(calls).toBeGreaterThan(0);
    expect(runner.status().capReached).toBe(false);

    limited = true;
    runner.setRunning(true);
    for (let i = 0; i < 300 && !runner.status().planLimit; i++)
      await new Promise((r) => setTimeout(r, 10));
    const status = runner.status();
    expect(status.running).toBe(false);
    expect(status.planLimit?.resumeAt).toBeGreaterThan(Date.now() + 3_600_000);
    const events = wm.events(w.id, { limit: 20, minImportance: 5 });
    expect(events.some((e) => e.kind === 'limit_reached')).toBe(true);

    runner.setRunning(true); // "try sooner"
    expect(runner.status().planLimit).toBeNull();
    runner.setRunning(false);
    await wm.closeAll();
  });
});

describe('what each brain has used', () => {
  it('adds up the AI calls, tokens and cost of each villager and of the village', async () => {
    const paid = {
      id: 'anthropic' as const,
      decide: async () => ({
        decision: { thought: 'ok', goal: 'rest', plan: [{ type: 'rest' as const, minutes: 30 }] },
        usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.01 },
      }),
    };
    const wm = new WorldManager(dir, { brains: new BrainRouter([paid]) });
    const w = await wm.create({ name: 'Usage', seed: 'usage', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    const [a, b, c, d] = runner.state.agents.map((x) => x.id) as [string, string, string, string];
    const empty = wm.brainsView(w.id);
    expect(empty.totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(empty.people.every((p) => p.calls === 0 && p.costUsd === 0)).toBe(true);

    await runner.advance(1); // the first round of decisions is made by everyone's current brain
    const chosen = [a, b, d];
    await wm.setBrains(w.id, chosen, { provider: 'anthropic', model: 'x', effort: 'standard' });
    await runner.advance(300); // long enough for check-ins, which these three now ask the AI
    runner.state.agents.find((x) => x.id === c)!.alive = false;

    // Read straight away: calls still buffered in the runner are included.
    const view = wm.brainsView(w.id);
    const withCalls = view.people.filter((p) => p.calls > 0);
    expect(withCalls.length).toBeGreaterThan(0);
    for (const r of withCalls) {
      expect(chosen).toContain(r.id);
      expect(r.inputTokens).toBe(r.calls * 1000);
      expect(r.outputTokens).toBe(r.calls * 100);
      expect(r.costUsd).toBeCloseTo(r.calls * 0.01, 6);
      expect(r.calls).toBe(wm.calls(w.id, r.id, 1000).length);
    }
    const row = (id: string) => view.people.find((p) => p.id === id)!;
    expect(view.people.filter((p) => !chosen.includes(p.id)).every((p) => p.calls === 0)).toBe(
      true,
    );
    const sum = (key: 'calls' | 'inputTokens' | 'outputTokens' | 'costUsd') =>
      view.people.reduce((total, p) => total + p[key], 0);
    expect(view.totals.calls).toBe(sum('calls'));
    expect(view.totals.inputTokens).toBe(sum('inputTokens'));
    expect(view.totals.outputTokens).toBe(sum('outputTokens'));
    expect(view.totals.costUsd).toBeCloseTo(sum('costUsd'), 6);
    expect(view.totals.costUsd).toBeCloseTo(runner.status().spentUsd, 6);

    // Everyone who has lived here is listed, the living first, with name, age and stage.
    expect(view.people).toHaveLength(11);
    expect(view.people.at(-1)).toMatchObject({ id: c, alive: false });
    expect(view.people.slice(0, -1).every((p) => p.alive)).toBe(true);
    expect(row(a)).toMatchObject({ name: 'Maren Holt', stage: 'adult' });
    expect(view.people.some((p) => p.stage === 'child' && p.age < 13)).toBe(true);
    await wm.closeAll();
  });

  it('includes calls the runner has made but not written to the file yet', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Buffered', seed: 'buffered', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    // Calls wait in the runner's batch (as they do between flushes of a running world).
    const batch = (runner as unknown as { batch: { calls: unknown[]; dirty: boolean } }).batch;
    batch.calls.push({
      tick: 1,
      agentId: 'a1',
      provider: 'anthropic',
      model: 'x',
      trigger: 'idle',
      inputTokens: 123,
      outputTokens: 4,
      cachedTokens: 0,
      costUsd: 0.5,
      estimated: false,
      latencyMs: 5,
      prompt: null,
      response: null,
      error: null,
    });
    batch.dirty = true;
    const view = wm.brainsView(w.id);
    expect(view.people.find((p) => p.id === 'a1')).toMatchObject({
      calls: 1,
      inputTokens: 123,
      outputTokens: 4,
      costUsd: 0.5,
    });
    expect(view.totals).toEqual({ calls: 1, inputTokens: 123, outputTokens: 4, costUsd: 0.5 });
    await wm.closeAll();
  });

  it('sums the log of AI calls per person, whoever they are', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Log', seed: 'log', mapSize: 'small' });
    const file = WorldFile.open(join(dir, 'worlds', `${w.id}.sqlite`));
    expect(file.usageByAgent().size).toBe(0);
    const call = (agentId: string, inputTokens: number, costUsd: number) => ({
      tick: 1,
      agentId,
      provider: 'anthropic',
      model: 'x',
      trigger: 'idle',
      inputTokens,
      outputTokens: 10,
      cachedTokens: 0,
      costUsd,
      estimated: false,
      latencyMs: 5,
      prompt: null,
      response: null,
      error: null,
    });
    file.appendCalls([
      call('a1', 100, 0.1),
      call('a1', 200, 0.2),
      call('a2', 50, 0),
      call('draft', 7, 0.3),
    ]);
    const usage = file.usageByAgent();
    expect(usage.get('a1')).toEqual({ calls: 2, inputTokens: 300, outputTokens: 20, costUsd: 0.3 });
    expect(usage.get('a2')).toEqual({ calls: 1, inputTokens: 50, outputTokens: 10, costUsd: 0 });
    expect(usage.get('draft')?.calls).toBe(1);
    expect(usage.has('a3')).toBe(false);
    file.close();
    await wm.closeAll();
  });
});
