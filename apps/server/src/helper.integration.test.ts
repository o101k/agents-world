import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeMap,
  type MapResponse,
  type ServerMessage,
  type WorldViewResponse,
} from '@aw/shared';
import { buildApp, type App } from './app.ts';
import type { ServerConfig } from './config.ts';

/**
 * The local helper end to end, the way the browser uses it: a real server on a real port, plain
 * HTTP requests and a WebSocket. Everything runs on the free Mock brain.
 */

let dir: string;
let app: App | null = null;
let base = '';

async function startHelper(): Promise<void> {
  const config: ServerConfig = {
    dataDir: dir,
    port: 0,
    host: '127.0.0.1',
    dev: false,
    openBrowser: false,
    webDistDir: null,
  };
  app = await buildApp(config, { env: {} });
  await app.server.listen({ host: '127.0.0.1', port: 0 });
  base = `127.0.0.1:${(app.server.server.address() as AddressInfo).port}`;
}

async function stopHelper(): Promise<void> {
  await app?.server.close();
  app = null;
}

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Resolve when `check` passes (polling), or fail after `ms`. */
async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function createWorld(name: string): Promise<string> {
  const { world } = await api<{ world: { id: string } }>('POST', '/api/worlds', {
    name,
    seed: name.toLowerCase(),
    mapSize: 'small',
  });
  await api('POST', `/api/worlds/${world.id}/activate`);
  return world.id;
}

/** Run the world at full speed until at least `ticks` have passed, then pause. */
async function runFor(id: string, ticks: number): Promise<WorldViewResponse> {
  const start = (await api<WorldViewResponse>('GET', `/api/worlds/${id}/view`)).tick;
  await api('POST', `/api/worlds/${id}/control`, { running: true, speed: 0 });
  await waitFor(
    async () =>
      (await api<WorldViewResponse>('GET', `/api/worlds/${id}/view`)).tick >= start + ticks,
  );
  await api('POST', `/api/worlds/${id}/control`, { running: false });
  return api<WorldViewResponse>('GET', `/api/worlds/${id}/view`);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aw-helper-'));
  await startHelper();
});

afterEach(async () => {
  await stopHelper();
  rmSync(dir, { recursive: true, force: true });
});

describe('the local helper (real HTTP + WebSocket)', () => {
  it('answers the health check', async () => {
    expect(await api('GET', '/api/health')).toMatchObject({ ok: true });
  });

  it('runs a world and streams frames and events to the browser', async () => {
    const socket = new WebSocket(`ws://${base}/ws`);
    const messages: ServerMessage[] = [];
    socket.onmessage = (m) => messages.push(JSON.parse(String(m.data)) as ServerMessage);
    await waitFor(() => messages.some((m) => m.type === 'hello'));

    const id = await createWorld('Streamed');
    const view = await runFor(id, 300);
    expect(view.agents).toHaveLength(11);
    expect(view.runner.running).toBe(false);

    const frames = messages.filter((m) => m.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.type === 'frame' && f.worldId === id)).toBe(true);
    await waitFor(() => messages.some((m) => m.type === 'events' && m.events.length > 0));
    socket.close();
  });

  it('serves the map and its owners on their own, at the version the frames carry', async () => {
    const socket = new WebSocket(`ws://${base}/ws`);
    const messages: ServerMessage[] = [];
    socket.onmessage = (m) => messages.push(JSON.parse(String(m.data)) as ServerMessage);
    await waitFor(() => messages.some((m) => m.type === 'hello'));

    const id = await createWorld('Mapped');
    const view = await runFor(id, 300);
    const map = await api<MapResponse>('GET', `/api/worlds/${id}/map`);
    // Pausing sends a frame of the paused world; its map version is the one the map carries.
    await waitFor(() =>
      messages.some((m) => m.type === 'frame' && !m.runner.running && m.tick === view.tick),
    );
    const paused = messages.find(
      (m) => m.type === 'frame' && !m.runner.running && m.tick === view.tick,
    );
    expect(paused?.type === 'frame' && paused.mapVersion).toBe(map.mapVersion);

    const decoded = decodeMap(map.map);
    expect(decoded.width).toBe(view.meta.mapWidth);
    expect(decoded.height).toBe(view.meta.mapHeight);
    expect(map.map).toEqual(view.map);
    expect(map.mapVersion).toBe(view.mapVersion);
    expect(map.owners).toEqual(view.owners);
    socket.close();
  });

  it('lets the observer spawn people, start world events, search, read stories and replay', async () => {
    const id = await createWorld('Observed');
    const { agentId } = await api<{ agentId: string }>('POST', `/api/worlds/${id}/spawn`, {
      description: 'A travelling tinker who mends pots.',
      name: 'Hob',
    });
    // Commands sent while paused take effect straight away.
    await api('POST', `/api/worlds/${id}/world-event`, { kind: 'storm', hours: 6 });
    const now = await api<WorldViewResponse>('GET', `/api/worlds/${id}/view`);
    expect(now.conditions.map((c) => c.kind)).toEqual(['storm']);
    const view = await runFor(id, 120);
    expect(view.agents.some((a) => a.id === agentId && a.name.startsWith('Hob'))).toBe(true);

    const found = await api<{ events: { text: string }[] }>(
      'GET',
      `/api/worlds/${id}/events?q=storm`,
    );
    expect(found.events.length).toBeGreaterThan(0);
    const story = await api<{ entries: unknown[] }>('GET', `/api/worlds/${id}/agents/a1/story`);
    expect(Array.isArray(story.entries)).toBe(true);

    const past = await api<WorldViewResponse & { firstTick: number }>(
      'GET',
      `/api/worlds/${id}/replay?tick=0&mapVersion=0`,
    );
    expect(past.tick).toBe(past.firstTick);
    expect(past.agents.some((a) => a.id === agentId)).toBe(false); // not arrived yet
  });

  it('picks up exactly where it left off after the helper restarts', async () => {
    const id = await createWorld('Restarted');
    const before = await runFor(id, 200);
    await stopHelper();
    await startHelper();

    const worlds = await api<{ activeWorldId: string }>('GET', '/api/worlds');
    expect(worlds.activeWorldId).toBe(id);
    const after = await api<WorldViewResponse>('GET', `/api/worlds/${id}/view`);
    expect(after.tick).toBe(before.tick);
    expect(after.agents).toEqual(before.agents);
  });

  it('starts up with a world that was left running and keeps it running', async () => {
    const id = await createWorld('LeftRunning');
    await api('POST', `/api/worlds/${id}/control`, { running: true, speed: 0 });
    await stopHelper();
    await startHelper();

    const view = await api<WorldViewResponse>('GET', `/api/worlds/${id}/view`);
    expect(view.runner.running).toBe(true);
    await api('POST', `/api/worlds/${id}/control`, { running: false });
  });

  it('refuses requests from other websites', async () => {
    const res = await fetch(`http://${base}/api/worlds`, {
      headers: { origin: 'http://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
