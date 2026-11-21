import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { buildApp, type App } from './app.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { Hub } from './hub.ts';
import { hostnameOf } from './security.ts';

let dir: string;
let app: App | null = null;
const HOST = { host: '127.0.0.1:4747' };

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    dataDir: dir,
    port: 4747,
    host: '127.0.0.1',
    dev: false,
    openBrowser: false,
    webDistDir: null,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-sec-'));
});

afterEach(async () => {
  if (app) {
    await app.server.close();
    app = null;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('hostnameOf and local-only guard', () => {
  it('parses valid loopback Host headers and rejects smuggled or malformed hosts', () => {
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('127.0.0.1:4747')).toBe('127.0.0.1');
    expect(hostnameOf('LOCALHOST:4747')).toBe('localhost');
    expect(hostnameOf('[::1]')).toBe('[::1]');
    expect(hostnameOf('[::1]:4747')).toBe('[::1]');

    expect(hostnameOf('')).toBe('');
    expect(hostnameOf('localhost:4747@evil.com')).toBe('');
    expect(hostnameOf('[::1]evil')).toBe('');
    expect(hostnameOf('[::1]:99999')).toBe('');
    expect(hostnameOf('localhost:0')).toBe('');
    expect(hostnameOf('localhost:abc')).toBe('');
  });

  it('sets security headers and blocks Sec-Fetch-Site: cross-site on mutating methods', async () => {
    app = await buildApp(makeConfig(), { env: {} });

    const getRes = await app.server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { ...HOST, 'sec-fetch-site': 'cross-site' },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['x-frame-options']).toBe('DENY');
    expect(getRes.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(getRes.headers['x-content-type-options']).toBe('nosniff');
    expect(getRes.headers['referrer-policy']).toBe('no-referrer');

    const postRes = await app.server.inject({
      method: 'POST',
      url: '/api/worlds',
      headers: { ...HOST, 'sec-fetch-site': 'cross-site' },
      payload: { name: 'Blocked' },
    });
    expect(postRes.statusCode).toBe(403);

    const smuggledHost = await app.server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'localhost:4747@evil.com' },
    });
    expect(smuggledHost.statusCode).toBe(403);
  });

  it('supports dynamic bound port when config.port is 0', async () => {
    app = await buildApp(makeConfig({ port: 0 }), { env: {} });
    await app.server.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.server.address() as AddressInfo).port;

    const ok = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { origin: `http://127.0.0.1:${port + 1}` },
    });
    expect(bad.status).toBe(403);
  });
});

describe('settings validation and security', () => {
  it('validates cliPath, restricts openai baseUrl, fixes localhost detection and short keyHint', async () => {
    app = await buildApp(makeConfig(), { env: {} });

    // Reject cliPath on non-claude_plan providers
    const wrongProvider = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai',
      headers: HOST,
      payload: { cliPath: '/usr/bin/claude' },
    });
    expect(wrongProvider.statusCode).toBe(400);

    // Reject relative, missing, wrong-basename, and non-executable cliPath on claude_plan
    const fakeDir = join(dir, 'bin');
    mkdirSync(fakeDir, { recursive: true });
    const wrongName = join(fakeDir, 'sh');
    writeFileSync(wrongName, '#!/bin/sh\n');
    chmodSync(wrongName, 0o755);

    const nonExecClaude = join(fakeDir, 'claude');
    writeFileSync(nonExecClaude, '#!/bin/sh\nexit 0\n');
    chmodSync(nonExecClaude, 0o644);

    for (const cliPath of [
      'claude',
      join(fakeDir, 'does-not-exist', 'claude'),
      wrongName,
      fakeDir,
      nonExecClaude,
    ]) {
      const res = await app.server.inject({
        method: 'PUT',
        url: '/api/settings/providers/claude_plan',
        headers: HOST,
        payload: { cliPath },
      });
      expect(res.statusCode).toBe(400);
    }

    // Executable named "claude" succeeds
    chmodSync(nonExecClaude, 0o755);
    const validCli = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/claude_plan',
      headers: HOST,
      payload: { cliPath: nonExecClaude },
    });
    expect(validCli.statusCode).toBe(200);

    // Restrict custom baseUrl on openai, allow empty string
    const badBase = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai',
      headers: HOST,
      payload: { baseUrl: 'https://evil.example/v1' },
    });
    expect(badBase.statusCode).toBe(400);

    const clearBase = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai',
      headers: HOST,
      payload: { baseUrl: '' },
    });
    expect(clearBase.statusCode).toBe(200);

    // Short API key hint should not reveal characters
    const shortKey = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai',
      headers: HOST,
      payload: { apiKey: '1234567890' },
    });
    expect(shortKey.statusCode).toBe(200);
    const openai = shortKey.json().providers.find((p: { id: string }) => p.id === 'openai');
    expect(openai.keyHint).toBe('••••');

    // Localhost detection via URL parsing (not substring regex)
    const spoofedLocal = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai_compatible',
      headers: HOST,
      payload: { baseUrl: 'https://evil.example/http://localhost:11434/v1' },
    });
    expect(spoofedLocal.statusCode).toBe(200);
    const spoofedView = spoofedLocal
      .json()
      .providers.find((p: { id: string }) => p.id === 'openai_compatible');
    expect(spoofedView.configured).toBe(false);

    const ipv6Local = await app.server.inject({
      method: 'PUT',
      url: '/api/settings/providers/openai_compatible',
      headers: HOST,
      payload: { baseUrl: 'http://[::1]:11434/v1' },
    });
    expect(ipv6Local.statusCode).toBe(200);
    const ipv6View = ipv6Local
      .json()
      .providers.find((p: { id: string }) => p.id === 'openai_compatible');
    expect(ipv6View.configured).toBe(true);
  });

  it('returns 404 for unknown provider on /models and truncates 502 error messages', async () => {
    app = await buildApp(makeConfig(), { env: {} });
    const unknown = await app.server.inject({
      url: '/api/providers/bogus/models',
      headers: HOST,
    });
    expect(unknown.statusCode).toBe(404);

    // Register a failing provider on the app's router to verify 502 sanitization & truncation
    const longMsg = 'x'.repeat(500) + '\nsecret\tline';
    app.worlds.brains.register({
      id: 'openai',
      decide: async () => ({ decision: { thought: '', goal: '', plan: [] } }),
      listModels: async () => {
        throw new Error(longMsg);
      },
    });
    const failed = await app.server.inject({
      url: '/api/providers/openai/models',
      headers: HOST,
    });
    expect(failed.statusCode).toBe(502);
    const errText = failed.json().error as string;
    expect(errText.startsWith("Couldn't reach the provider: ")).toBe(true);
    expect(errText.slice("Couldn't reach the provider: ".length).length).toBeLessThanOrEqual(300);
    expect(errText).not.toContain('\n');
  });
});

describe('config and SPA 404 routing', () => {
  it('falls back to ~/.agents-world when AGENTS_WORLD_HOME is empty or whitespace', () => {
    const expected = resolve(join(homedir(), '.agents-world'));
    expect(loadConfig({ AGENTS_WORLD_HOME: '' }).dataDir).toBe(expected);
    expect(loadConfig({ AGENTS_WORLD_HOME: '   ' }).dataDir).toBe(expected);
  });

  it('strips query strings in SPA 404 handler so /api and /ws return 404 JSON', async () => {
    const webDir = join(dir, 'web');
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, 'index.html'), '<html>SPA</html>');

    app = await buildApp(makeConfig({ webDistDir: webDir }), { env: {} });

    for (const url of ['/api?x=1', '/api/does-not-exist?foo=bar']) {
      const res = await app.server.inject({ url, headers: HOST });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not found' });
    }

    const wsNonUpgrade = await app.server.inject({ url: '/ws?token=1', headers: HOST });
    expect(wsNonUpgrade.statusCode).toBe(404);
    expect(wsNonUpgrade.body).not.toContain('<html>SPA</html>');

    const postMissing = await app.server.inject({
      method: 'POST',
      url: '/worlds/123?tab=map',
      headers: HOST,
    });
    expect(postMissing.statusCode).toBe(404);
    expect(postMissing.json()).toEqual({ error: 'Not found' });

    const spa = await app.server.inject({ url: '/worlds/123?tab=map', headers: HOST });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<html>SPA</html>');
  });
});

describe('Hub connection limits and backpressure', () => {
  function fakeSocket(overrides: Partial<WebSocket> = {}): WebSocket & {
    handlers: Record<string, (() => void)[]>;
    sent: string[];
    closedWith: [number, string] | null;
    terminated: boolean;
  } {
    const handlers: Record<string, (() => void)[]> = {};
    const sock = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      handlers,
      sent: [] as string[],
      closedWith: null as [number, string] | null,
      terminated: false,
      on(event: string, fn: () => void) {
        (handlers[event] ??= []).push(fn);
        return this;
      },
      send(data: string, cb?: (err?: Error) => void) {
        this.sent.push(data);
        cb?.();
      },
      close(code: number, reason: string) {
        this.closedWith = [code, reason];
      },
      terminate() {
        this.terminated = true;
      },
      ...overrides,
    };
    return sock as unknown as WebSocket & {
      handlers: Record<string, (() => void)[]>;
      sent: string[];
      closedWith: [number, string] | null;
      terminated: boolean;
    };
  }

  it('caps connections at 50 and closes excess with 1013', () => {
    const hub = new Hub();
    for (let i = 0; i < 50; i++) expect(hub.add(fakeSocket())).toBe(true);
    expect(hub.size).toBe(50);

    const extra = fakeSocket();
    expect(hub.add(extra)).toBe(false);
    expect(extra.closedWith?.[0]).toBe(1013);
    expect(hub.size).toBe(50);
  });

  it('skips JSON.stringify when empty, drops backpressured frames, terminates wedged sockets, and handles send/close errors', () => {
    const hub = new Hub();
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    hub.broadcast({ type: 'worlds_changed', worlds: [], activeWorldId: null });
    expect(stringifySpy).not.toHaveBeenCalled();
    stringifySpy.mockRestore();

    const normal = fakeSocket();
    const slow = fakeSocket({ bufferedAmount: 2_000_000 });
    const wedged = fakeSocket({ bufferedAmount: 20_000_000 });
    const throwing = fakeSocket({
      send: (() => {
        throw new Error('boom');
      }) as WebSocket['send'],
    });
    const connecting = fakeSocket({ readyState: 0 });

    hub.add(normal);
    hub.add(slow);
    hub.add(wedged);
    hub.add(throwing);
    hub.add(connecting);

    const frame = {
      type: 'frame' as const,
      worldId: 'w_1234567890ab',
      tick: 1,
      mapVersion: 1,
      agents: [],
      resources: {},
      conditions: [],
      calendar: { year: 1, season: 'spring' as const, progress: 0 },
      runner: {
        running: false,
        speed: 1,
        actualSpeed: 0,
        thinking: 0,
        spentUsd: 0,
        planUsd: 0,
        capUsd: 1,
        capReached: false,
        rateLimit: null,
      },
    };
    hub.broadcast(frame);

    expect(normal.sent).toHaveLength(1);
    expect(slow.sent).toHaveLength(0);
    expect(slow.terminated).toBe(false);
    expect(wedged.terminated).toBe(true);
    expect(throwing.terminated).toBe(true);
    expect(hub.size).toBe(3); // normal, slow, connecting

    hub.closeAll();
    expect(normal.closedWith?.[0]).toBe(1001);
    expect(connecting.terminated).toBe(true);
    expect(hub.size).toBe(0);
  });
});
