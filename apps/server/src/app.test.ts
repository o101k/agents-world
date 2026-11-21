import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrainsResponse, CastPreviewResponse, WorldsResponse } from '@aw/shared';
import { buildApp, type App } from './app.ts';
import type { ServerConfig } from './config.ts';

let dir: string;
let app: App;
const HOST = { host: '127.0.0.1:4747' };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aw-app-'));
  const config: ServerConfig = {
    dataDir: dir,
    port: 4747,
    host: '127.0.0.1',
    dev: false,
    openBrowser: false,
    webDistDir: null,
  };
  app = await buildApp(config, { env: {} });
});
afterEach(async () => {
  await app.server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('HTTP API', () => {
  it('supports the world lifecycle', async () => {
    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'Test world', seed: 'abc', mapSize: 'small' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().world.id as string;

    const act = await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/activate`,
      headers: HOST,
    });
    expect(act.statusCode).toBe(200);

    const list = (
      await app.server.inject({ url: '/api/worlds', headers: HOST })
    ).json() as WorldsResponse;
    expect(list.activeWorldId).toBe(id);
    expect(list.worlds).toHaveLength(1);

    const view = await app.server.inject({ url: `/api/worlds/${id}/view`, headers: HOST });
    expect(view.json().map.width).toBe(48);

    const del = await app.server.inject({
      method: 'DELETE',
      url: `/api/worlds/${id}`,
      headers: HOST,
    });
    expect(del.statusCode).toBe(204);
    const after = (
      await app.server.inject({ url: '/api/worlds', headers: HOST })
    ).json() as WorldsResponse;
    expect(after.worlds).toHaveLength(0);
    expect(after.activeWorldId).toBeNull();
  });

  it('returns 400 for invalid input and 404 for unknown worlds', async () => {
    const bad = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: '' },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.server.inject({ url: '/api/worlds/w_nope12345/view', headers: HOST });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects non-loopback hosts and foreign origins', async () => {
    const rebind = await app.server.inject({
      url: '/api/worlds',
      headers: { host: 'evil.example:4747' },
    });
    expect(rebind.statusCode).toBe(403);
    const foreign = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: { ...HOST, origin: 'https://evil.example' },
      payload: { name: 'x' },
    });
    expect(foreign.statusCode).toBe(403);
    const own = await app.server.inject({
      url: '/api/worlds',
      headers: { ...HOST, origin: 'http://127.0.0.1:4747' },
    });
    expect(own.statusCode).toBe(200);
  });

  it('stores API keys privately and never returns them', async () => {
    const put = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/anthropic',
      headers: HOST,
      payload: { apiKey: 'sk-ant-secret-1234' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('secret');
    const view = (await app.server.inject({ url: '/api/settings', headers: HOST })).json();
    const anthropic = view.providers.find((p: { id: string }) => p.id === 'anthropic');
    expect(anthropic.configured).toBe(true);
    expect(anthropic.keyHint).toBe('sk-…1234');
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(statSync(join(dir, 'secrets.json')).mode & 0o777).toBe(0o600);
  });

  it('spawns a person from a description (offline draft without an AI)', async () => {
    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'Spawn', seed: 'sp', mapSize: 'small' },
    });
    const id = created.json().world.id as string;
    await app.server.inject({ method: 'POST', url: `/api/worlds/${id}/activate`, headers: HOST });
    const res = await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/spawn`,
      headers: HOST,
      payload: {
        description: 'A weary travelling tinker who sells pots and tells tall tales.',
        name: 'Hob',
      },
    });
    expect(res.statusCode).toBe(200);
    const agentId = res.json().agentId as string;
    const agent = (
      await app.server.inject({ url: `/api/worlds/${id}/agents/${agentId}`, headers: HOST })
    ).json().agent;
    expect(agent.name).toContain('Hob');
    expect(agent.homeId).toBeNull();
    expect(agent.knownPlaces).toBeLessThan(10);
  });

  it('triggers world events, searches the timeline and tells a life story', async () => {
    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'Events', seed: 'ev', mapSize: 'small' },
    });
    const id = created.json().world.id as string;
    await app.server.inject({ method: 'POST', url: `/api/worlds/${id}/activate`, headers: HOST });
    const bad = await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/world-event`,
      headers: HOST,
      payload: { kind: 'meteor' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/world-event`,
      headers: HOST,
      payload: { kind: 'drought', intensity: 0.9, hours: 48 },
    });
    expect(ok.statusCode).toBe(200);
    const view = (await app.server.inject({ url: `/api/worlds/${id}/view`, headers: HOST })).json();
    expect(view.conditions).toEqual([expect.objectContaining({ kind: 'drought', intensity: 0.9 })]);
    const found = (
      await app.server.inject({ url: `/api/worlds/${id}/events?q=DROUGHT`, headers: HOST })
    ).json().events;
    expect(found.map((e: { kind: string }) => e.kind)).toEqual(['world_event']);
    const none = (
      await app.server.inject({ url: `/api/worlds/${id}/events?q=100%25_x`, headers: HOST })
    ).json().events;
    expect(none).toEqual([]);
    const story = await app.server.inject({
      url: `/api/worlds/${id}/agents/a1/story`,
      headers: HOST,
    });
    expect(story.statusCode).toBe(200);
    expect(Array.isArray(story.json().entries)).toBe(true);
  });

  it('previews the starting cast before a world is created', async () => {
    const preview = await app.server.inject({
      method: 'POST',
      url: '/api/cast-preview',
      headers: HOST,
      payload: { cast: { mode: 'generated', adults: 6, children: 2, useAi: false } },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as CastPreviewResponse;
    expect(body.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(body.people).toHaveLength(8);
    expect(body.people[0]).toMatchObject({ index: 0, sex: expect.any(String) });

    // The same seed gives the same people, and an empty request previews the sample cast.
    const again = await app.server.inject({
      method: 'POST',
      url: '/api/cast-preview',
      headers: HOST,
      payload: { seed: body.seed, cast: { mode: 'generated', adults: 6, children: 2 } },
    });
    expect(again.json()).toEqual(body);
    const sample = (
      await app.server.inject({ method: 'POST', url: '/api/cast-preview', headers: HOST })
    ).json() as CastPreviewResponse;
    expect(sample.people.map((p) => p.name)).toContain('Maren');
    expect(sample.people).toHaveLength(11);

    // Nothing was created, and bad requests are 400s.
    expect(
      ((await app.server.inject({ url: '/api/worlds', headers: HOST })).json() as WorldsResponse)
        .worlds,
    ).toHaveLength(0);
    for (const payload of [
      { cast: { mode: 'custom', people: [] } },
      {
        cast: {
          mode: 'custom',
          people: [
            { name: 'X', sex: 'male', age: 20 },
            { name: 'X', sex: 'female', age: 20 },
          ],
        },
      },
    ]) {
      const bad = await app.server.inject({
        method: 'POST',
        url: '/api/cast-preview',
        headers: HOST,
        payload,
      });
      expect(bad.statusCode).toBe(400);
    }
  });

  it('creates a world with chosen brains and changes them later, one or many at once', async () => {
    const claude = { provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'standard' };
    const plan = { provider: 'claude_plan', model: 'haiku', effort: 'deep' };
    const bad = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'Bad', mapSize: 'small', brains: [{ provider: 'nope' }] },
    });
    expect(bad.statusCode).toBe(400);

    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: {
        name: 'Brains',
        seed: 'br',
        mapSize: 'small',
        brains: [claude, plan],
        defaultBrain: plan,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().world.id as string;
    const brainsUrl = `/api/worlds/${id}/brains`;
    // Only the active world can be looked at.
    expect((await app.server.inject({ url: brainsUrl, headers: HOST })).statusCode).toBe(409);
    await app.server.inject({ method: 'POST', url: `/api/worlds/${id}/activate`, headers: HOST });

    const first = (
      await app.server.inject({ url: brainsUrl, headers: HOST })
    ).json() as BrainsResponse;
    expect(first.defaultBrain).toEqual(plan);
    expect(first.people).toHaveLength(11);
    expect(first.people.map((p) => p.brain)).toEqual([claude, ...Array(10).fill(plan)]);
    expect(first.people[0]).toMatchObject({
      id: 'a1',
      name: 'Maren Holt',
      age: 34,
      stage: 'adult',
      alive: true,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    expect(first.totals).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      planUsd: 0,
    });

    // Change three at once: the answer already shows the change.
    const put = await app.server.inject({
      method: 'PUT',
      url: brainsUrl,
      headers: HOST,
      payload: { agentIds: ['a2', 'a3', 'a4'], brain: claude },
    });
    expect(put.statusCode).toBe(200);
    const after = put.json() as BrainsResponse;
    expect(after.people.filter((p) => p.brain.provider === 'anthropic').map((p) => p.id)).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
    expect(after.defaultBrain).toEqual(plan);
    expect((await app.server.inject({ url: brainsUrl, headers: HOST })).json()).toEqual(after);

    for (const [payload, status] of [
      [{ agentIds: ['a1', 'a999'], brain: claude }, 404],
      [{ agentIds: [], brain: claude }, 400],
      [{ agentIds: ['a1'], brain: { provider: 'nope', model: '', effort: 'frugal' } }, 400],
      [{ agentIds: ['a1'] }, 400],
    ] as const) {
      const res = await app.server.inject({
        method: 'PUT',
        url: brainsUrl,
        headers: HOST,
        payload,
      });
      expect(res.statusCode).toBe(status);
    }
    // A refused request changes nobody.
    expect(
      (await app.server.inject({ url: brainsUrl, headers: HOST })).json<BrainsResponse>().people[0]!
        .brain,
    ).toEqual(claude);
  });

  it('returns updated brain and settings immediately while running and validates default-brain/aging', async () => {
    const created = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: HOST,
      payload: { name: 'RunningUpdates', seed: 'ru', mapSize: 'small' },
    });
    const id = created.json().world.id as string;
    await app.server.inject({ method: 'POST', url: `/api/worlds/${id}/activate`, headers: HOST });
    // Start running slowly so queued inputs haven't been stepped yet when PUT returns.
    await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/control`,
      headers: HOST,
      payload: { running: true, speed: 1 },
    });

    const newBrain = { provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'standard' };
    const brainRes = await app.server.inject({
      method: 'PUT',
      url: `/api/worlds/${id}/agents/a1/brain`,
      headers: HOST,
      payload: newBrain,
    });
    expect(brainRes.statusCode).toBe(200);
    expect(brainRes.json().agent.brain).toEqual(newBrain);

    const defRes = await app.server.inject({
      method: 'PUT',
      url: `/api/worlds/${id}/default-brain`,
      headers: HOST,
      payload: { brain: newBrain, applyToAll: false },
    });
    expect(defRes.statusCode).toBe(200);
    expect(defRes.json().defaultBrain).toEqual(newBrain);

    const agingRes = await app.server.inject({
      method: 'PUT',
      url: `/api/worlds/${id}/aging`,
      headers: HOST,
      payload: { daysPerYear: 12 },
    });
    expect(agingRes.statusCode).toBe(200);
    expect(agingRes.json().daysPerYear).toBe(12);

    const badAging = await app.server.inject({
      method: 'PUT',
      url: `/api/worlds/${id}/aging`,
      headers: HOST,
      payload: { daysPerYear: 999 },
    });
    expect(badAging.statusCode).toBe(400);

    const badDef = await app.server.inject({
      method: 'PUT',
      url: `/api/worlds/${id}/default-brain`,
      headers: HOST,
      payload: { brain: newBrain, applyToAll: 'yes' },
    });
    expect(badDef.statusCode).toBe(400);

    await app.server.inject({
      method: 'POST',
      url: `/api/worlds/${id}/control`,
      headers: HOST,
      payload: { running: false },
    });
  });
});
