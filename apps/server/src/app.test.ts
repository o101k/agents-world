import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorldsResponse } from '@aw/shared';
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
  app = await buildApp(config);
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
});
