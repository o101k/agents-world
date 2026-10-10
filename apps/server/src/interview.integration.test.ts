import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainRouter, RateLimitError, type BrainProvider, type GenerateRequest } from '@aw/brain';
import type { InterviewsResponse, RecordResponse } from '@aw/shared';
import { fnv1a, serializeWorldState } from '@aw/sim';
import { buildApp, type App } from './app.ts';
import { WorldManager } from './worlds/worldManager.ts';

/**
 * Asking about a villager, end to end through the helper: their own brain answers from their
 * record, the cost lands on the meter, the cap and their AI use, and the world never changes.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-ask-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A paid provider whose free-form answers we control (decisions cost nothing). */
function fakeProvider() {
  const asked: GenerateRequest[] = [];
  let next: () => Promise<
    Awaited<ReturnType<NonNullable<BrainProvider['generate']>>>
  > = async () => ({
    output: { answer: 'She baked bread and talked with Tom.' },
    model: 'claude-test',
    usage: { inputTokens: 3000, outputTokens: 200, costUsd: 0.004 },
  });
  const provider: BrainProvider = {
    id: 'anthropic',
    decide: async () => ({
      decision: { thought: 'ok', goal: 'rest', plan: [{ type: 'rest', minutes: 30 }] },
    }),
    generate: async (req) => {
      asked.push(req);
      return next();
    },
  };
  return {
    provider,
    asked,
    answerWith: (fn: typeof next) => {
      next = fn;
    },
  };
}

const hash = (wm: WorldManager) => fnv1a(JSON.stringify(serializeWorldState(wm.active!.state)));

async function villageWithHistory(brains: BrainRouter) {
  const wm = new WorldManager(dir, { brains });
  const w = await wm.create({ name: 'Ask', seed: 'ask', mapSize: 'small' });
  await wm.activate(w.id);
  await wm.active!.advance(1440); // a day of Mock-brain life
  return { wm, worldId: w.id };
}

describe('asking about a villager', () => {
  it("answers with the person's own AI and counts the cost, without changing the world", async () => {
    const fake = fakeProvider();
    const { wm, worldId } = await villageWithHistory(new BrainRouter([fake.provider]));
    const person = wm.active!.state.agents[0]!;
    await wm.setBrain(worldId, person.id, {
      provider: 'anthropic',
      model: 'claude-test',
      effort: 'frugal',
    });
    const life = wm.interviews(worldId, person.id);
    expect(life.interviews).toEqual([]);
    expect(life.lifeToTick).toBe(wm.active!.state.tick);

    const before = { tick: wm.active!.state.tick, hash: hash(wm), meta: wm.active!.currentMeta() };
    const answer = await wm.ask(worldId, person.id, {
      question: 'What did she do?',
      fromTick: life.lifeFromTick,
      toTick: life.lifeToTick,
    });

    expect(answer.answer).toBe('She baked bread and talked with Tom.');
    expect(answer.provider).toBe('anthropic');
    expect(answer.fallback).toBeUndefined();
    expect(answer.costUsd).toBeCloseTo(0.004, 6);
    expect(answer.recordCount).toBeGreaterThan(10);
    expect(answer.usedCount).toBeGreaterThan(0);
    // The brain read the question and the record.
    expect(fake.asked).toHaveLength(1);
    expect(fake.asked[0]!.user).toContain('What did she do?');
    expect(fake.asked[0]!.user).toContain('[Day 1');

    // Cost: the meter (and so the cap), the person's AI use, their question spend, the call log.
    const meta = wm.active!.currentMeta();
    expect(meta.spentUsd).toBeCloseTo(before.meta.spentUsd + 0.004, 6);
    const row = wm.brainsView(worldId).people.find((p) => p.id === person.id)!;
    expect(row.costUsd).toBeCloseTo(0.004, 6);
    expect(wm.agent(worldId, person.id).askedUsd).toBeCloseTo(0.004, 6);
    const call = wm.calls(worldId, person.id)[0]!;
    expect(call.trigger).toBe('interview');
    expect(call.prompt).toContain('What did she do?');

    // The world didn't move or change.
    expect(wm.active!.state.tick).toBe(before.tick);
    expect(hash(wm)).toBe(before.hash);

    // It's kept, and a follow-up about the same period carries the conversation.
    expect(wm.interviews(worldId, person.id).interviews).toHaveLength(1);
    await wm.ask(worldId, person.id, {
      question: 'And who with?',
      fromTick: life.lifeFromTick,
      toTick: life.lifeToTick,
    });
    expect(fake.asked[1]!.user).toContain('What did she do?');
    expect(fake.asked[1]!.user).toContain('She baked bread');
    await wm.closeAll();
  });

  it('gives the free summary, saying why, when the cap is reached or a limit is hit', async () => {
    const fake = fakeProvider();
    const { wm, worldId } = await villageWithHistory(new BrainRouter([fake.provider]));
    const person = wm.active!.state.agents[1]!;
    await wm.setBrain(worldId, person.id, { provider: 'anthropic', model: '', effort: 'frugal' });
    const { lifeFromTick, lifeToTick } = wm.interviews(worldId, person.id);

    // A rate limit: the free summary answers, and the world isn't paused for it.
    fake.answerWith(async () => {
      throw new RateLimitError('Too many requests', { status: 429, limit: 'requests per minute' });
    });
    const limited = await wm.ask(worldId, person.id, {
      question: '',
      fromTick: lifeFromTick,
      toTick: lifeToTick,
    });
    expect(limited.fallback).toBe('rate_limit');
    expect(limited.provider).toBe('mock');
    expect(limited.note).toMatch(/limit/i);
    expect(limited.answer).toContain(person.name);
    expect(wm.active!.status().rateLimit).toBeNull();
    // The call that hit the limit is logged against their own provider.
    const failed = wm.calls(worldId, person.id)[0]!;
    expect(failed.trigger).toBe('interview');
    expect(failed.provider).toBe('anthropic');
    expect(failed.error).toMatch(/Rate limit/);

    // The cap: no call at all.
    wm.setCap(worldId, 0);
    const calls = fake.asked.length;
    const spent = wm.active!.currentMeta().spentUsd;
    const capped = await wm.ask(worldId, person.id, {
      question: 'How has he been feeling?',
      fromTick: lifeFromTick,
      toTick: lifeToTick,
    });
    expect(capped.fallback).toBe('cap_reached');
    expect(capped.costUsd).toBe(0);
    expect(capped.answer.length).toBeGreaterThan(0);
    expect(fake.asked.length).toBe(calls);
    expect(wm.active!.currentMeta().spentUsd).toBe(spent);
    await wm.closeAll();
  });

  it('answers for free for Mock-brain people', async () => {
    const { wm, worldId } = await villageWithHistory(new BrainRouter());
    const person = wm.active!.state.agents[2]!;
    const { lifeFromTick, lifeToTick } = wm.interviews(worldId, person.id);
    const answer = await wm.ask(worldId, person.id, {
      question: 'What did they do?',
      fromTick: lifeFromTick,
      toTick: lifeToTick,
    });
    expect(answer.provider).toBe('mock');
    expect(answer.fallback).toBe('mock_brain');
    expect(answer.costUsd).toBe(0);
    expect(answer.answer).toContain(person.name);
    // Free answers aren't AI calls.
    expect(wm.calls(worldId, person.id).some((c) => c.trigger === 'interview')).toBe(false);
    await wm.closeAll();
  });
});

describe('the record and asking over HTTP', () => {
  let app: App;
  const HOST = { host: '127.0.0.1:4747' };
  beforeEach(async () => {
    app = await buildApp(
      {
        dataDir: dir,
        port: 4747,
        host: '127.0.0.1',
        dev: false,
        openBrowser: false,
        webDistDir: null,
      },
      { env: {} },
    );
  });
  afterEach(async () => {
    await app.server.close();
  });

  it('pages through a person’s record and answers a question', async () => {
    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'Record', seed: 'rec', mapSize: 'small' },
    });
    const id = created.json().world.id as string;
    await app.server.inject({ method: 'POST', url: `/api/worlds/${id}/activate`, headers: HOST });
    await app.worlds.active!.advance(1440);
    const agentId = app.worlds.active!.state.agents[0]!.id;

    const page = (
      await app.server.inject({
        url: `/api/worlds/${id}/agents/${agentId}/record?limit=20`,
        headers: HOST,
      })
    ).json() as RecordResponse;
    expect(page.entries).toHaveLength(20);
    expect(page.entries[0]!.tick).toBeGreaterThanOrEqual(page.entries[19]!.tick); // newest first
    expect(page.counts.thought).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThan(20);
    expect(page.days.length).toBeGreaterThanOrEqual(1);

    const thoughts = (
      await app.server.inject({
        url: `/api/worlds/${id}/agents/${agentId}/record?kinds=thought&limit=5&offset=5`,
        headers: HOST,
      })
    ).json() as RecordResponse;
    expect(thoughts.entries.every((e) => e.kind === 'thought')).toBe(true);
    expect(thoughts.total).toBe(page.counts.thought);

    const asked = await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/agents/${agentId}/ask`,
      headers: HOST,
      payload: { question: 'What did she do today?', fromTick: 0, toTick: 99_999_999 },
    });
    expect(asked.statusCode).toBe(200);
    expect(asked.json().interview.fallback).toBe('mock_brain');

    const list = (
      await app.server.inject({
        url: `/api/worlds/${id}/agents/${agentId}/interviews`,
        headers: HOST,
      })
    ).json() as InterviewsResponse;
    expect(list.interviews).toHaveLength(1);
    expect(list.interviews[0]!.toTick).toBeLessThanOrEqual(list.lifeToTick); // clamped

    const missing = await app.server.inject({
      url: `/api/worlds/${id}/agents/nobody/interviews`,
      headers: HOST,
    });
    expect(missing.statusCode).toBe(404);
  });
});
