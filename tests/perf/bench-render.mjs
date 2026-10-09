/* global window */
/**
 * Map rendering benchmark: a big generated village in headless Chromium.
 *   npm run bench:render -- [--adults 150] [--children 100] [--map huge] [--speed 60]
 *     [--warm 360] [--json out.json] [--shots dir [--shots-only]] [--profile out.cpuprofile]
 *     [--trace out.json]
 * Starts its own helper on a throwaway data folder, creates the world, runs it `--warm` in-game
 * minutes, then opens the page and measures loading, playing, panning and zooming.
 * PW_CHROMIUM_PATH points at a Chromium if Playwright has none of its own.
 *
 * Headless Chromium draws WebGL in software (SwiftShader) and reads every frame back for its
 * software compositor, so frames per second here are far below a real GPU's. The numbers that
 * carry over to a real machine are the main-thread JavaScript ones (time per frame, per second,
 * per map update) and the GPU work asked for (draw calls and texture uploads per frame).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const ADULTS = Number(opt('adults', 150));
const CHILDREN = Number(opt('children', 100));
const MAP = opt('map', 'huge');
const SPEED = Number(opt('speed', 60));
const WARM = Number(opt('warm', 360));
const PROFILE = opt('profile', '');
const TRACE = opt('trace', '');
const JSON_OUT = opt('json', '');
const SHOTS = opt('shots', '');
/** Only take the screenshots (to compare a change against the code before it). */
const SHOTS_ONLY = args.includes('--shots-only');
const PORT = Number(opt('port', 4811));
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), 'aw-bench-'));
const server = spawn('npm', ['run', 'start', '-w', '@aw/server'], {
  env: {
    ...process.env,
    AGENTS_WORLD_HOME: dataDir,
    AW_NO_OPEN: '1',
    AW_PORT: String(PORT),
    AW_CLAUDE_CLI: 'off',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);

async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (x) => Math.round(x * 10) / 10;

/** Runs in the page before anything else: counts frames, JS per frame, GL calls, map updates. */
function instrument() {
  const raf = window.requestAnimationFrame.bind(window);
  const b = (window.__bench = {
    frames: [],
    work: new Map(),
    ws: 0,
    long: [],
    gl: { draws: 0, uploads: 0 },
  });
  // Main-thread time spent in animation-frame callbacks, summed per frame.
  window.requestAnimationFrame = (fn) =>
    raf((t) => {
      const s = performance.now();
      try {
        fn(t);
      } finally {
        b.work.set(t, (b.work.get(t) ?? 0) + performance.now() - s);
      }
    });
  const loop = (t) => {
    b.frames.push([t, b.gl.draws, b.gl.uploads]);
    raf(loop);
  };
  raf(loop);
  // Time spent handling live updates from the helper.
  const desc = Object.getOwnPropertyDescriptor(window.WebSocket.prototype, 'onmessage');
  Object.defineProperty(window.WebSocket.prototype, 'onmessage', {
    set(fn) {
      desc.set.call(this, (ev) => {
        const s = performance.now();
        try {
          fn(ev);
        } finally {
          b.ws += performance.now() - s;
        }
      });
    },
    get() {
      return desc.get.call(this);
    },
  });
  new window.PerformanceObserver((l) => {
    for (const e of l.getEntries()) b.long.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced']) {
      const fn = C.prototype[name];
      if (!fn) continue;
      C.prototype[name] = function (...a) {
        b.firstDraw ??= performance.now();
        b.gl.draws++;
        return fn.apply(this, a);
      };
    }
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const fn = C.prototype[name];
      C.prototype[name] = function (...a) {
        b.gl.uploads++;
        return fn.apply(this, a);
      };
    }
  }
}

async function main() {
  for (let i = 0; ; i++) {
    try {
      await api('/api/health');
      break;
    } catch {
      if (i > 120) throw new Error('helper did not start');
      await sleep(250);
    }
  }
  const { world } = await api('/api/worlds', {
    name: 'Bench',
    seed: 'bench',
    mapSize: MAP,
    cast: { mode: 'generated', adults: ADULTS, children: CHILDREN },
  });
  await api(`/api/worlds/${world.id}/activate`, {});
  // Live a while first so people spread out, talk and start building (deterministic: same seed).
  // The last few minutes go slowly so it pauses exactly at the same tick every run.
  const tickNow = async () => (await api(`/api/worlds/${world.id}/view`)).tick;
  const target = (await tickNow()) + WARM;
  await api(`/api/worlds/${world.id}/control`, { running: true, speed: 0 });
  while ((await tickNow()) < target - 10) await sleep(100);
  await api(`/api/worlds/${world.id}/control`, { speed: 1 });
  while ((await tickNow()) < target) await sleep(50);
  await api(`/api/worlds/${world.id}/control`, { running: false });
  const pausedAt = (await api(`/api/worlds/${world.id}/view`)).tick;

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(instrument);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let mapFetches = 0;
  page.on('request', (r) => {
    if (/\/api\/worlds\/[^/]+\/(view|map)$/.test(new URL(r.url()).pathname)) mapFetches++;
  });
  const metrics = async () => {
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(m.map((x) => [x.name, x.value]));
  };
  /** Durations of the renderer's map updates ('aw:setMap' measures) since `since`. */
  const mapUpdates = (since) =>
    page.evaluate(
      (since) =>
        performance
          .getEntriesByName('aw:setMap')
          .filter((e) => e.startTime >= since)
          .map((e) => e.duration),
      since,
    );
  const map = page.locator('[data-testid="map"]');

  // ---- load (world paused at a fixed tick)
  await page.goto(BASE);
  await map.locator('canvas').waitFor();
  await page.waitForFunction(() => window.__bench.firstDraw !== undefined, null, {
    timeout: 60_000,
  });
  await sleep(1500);
  const load = await page.evaluate(() => ({
    firstMapFrameMs: window.__bench.firstDraw,
    longTasks: window.__bench.long.filter(([s]) => s < window.__bench.firstDraw + 1000),
  }));
  const initialMap = await mapUpdates(0);
  const results = {
    setup: { adults: ADULTS, children: CHILDREN, map: MAP, speed: SPEED, pausedAt },
    load: {
      firstMapFrameMs: Math.round(load.firstMapFrameMs),
      firstMapUpdateMs: initialMap.length ? Math.round(initialMap[0]) : null,
      longestTaskMs: Math.round(Math.max(0, ...load.longTasks.map((l) => l[1]))),
    },
    phases: {},
  };
  // Same tick, same camera every run: compare these before and after a change.
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await map.screenshot({ path: join(SHOTS, 'fit.png') });
  }
  // Zoom in to 2× around the village centre (names and speech bubbles show from 2×).
  for (let i = 0; i < 4; i++) await page.keyboard.press('Equal');
  await sleep(800);
  if (SHOTS) await map.screenshot({ path: join(SHOTS, 'zoom2.png') });
  for (let i = 0; i < 4; i++) await page.keyboard.press('Minus');
  await sleep(300);
  if (SHOTS_ONLY) {
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const box = await map.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await api(`/api/worlds/${world.id}/control`, { running: true, speed: SPEED });
  await sleep(1000);
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }

  async function phase(name, ms, during) {
    const t0 = await page.evaluate(() => {
      window.__bench.ws = 0;
      return performance.now();
    });
    const m0 = await metrics();
    const f0 = mapFetches;
    const tick0 = (await api(`/api/worlds/${world.id}/view`)).tick;
    const end = Date.now() + ms;
    if (during) await during(end);
    else await sleep(ms);
    const m1 = await metrics();
    const tick1 = (await api(`/api/worlds/${world.id}/view`)).tick;
    const d = await page.evaluate((t0) => {
      const b = window.__bench;
      const t1 = performance.now();
      const frames = b.frames.filter(([t]) => t >= t0 && t <= t1);
      const gaps = frames.slice(1).map(([t], i) => t - frames[i][0]);
      const draws = frames.slice(1).map(([, d], i) => d - frames[i][1]);
      const uploads = frames.length > 1 ? frames.at(-1)[2] - frames[0][2] : 0;
      const work = [...b.work].filter(([t]) => t >= t0 && t <= t1).map(([, w]) => w);
      const long = b.long.filter(([s]) => s >= t0 && s <= t1).map(([, d]) => d);
      const secs = (t1 - t0) / 1000;
      return { secs, frames: frames.length, gaps, draws, uploads, work, long, ws: b.ws };
    }, t0);
    const updates = await mapUpdates(t0);
    const perSec = (k) => ((m1[k] - m0[k]) / d.secs) * 1000; // ms of work per second
    results.phases[name] = {
      jsPerFrameP50Ms: r1(pct(d.work, 50)),
      jsPerFrameP95Ms: r1(pct(d.work, 95)),
      scriptMsPerSec: Math.round(perSec('ScriptDuration')),
      liveUpdateMsPerSec: r1(d.ws / d.secs),
      drawCallsPerFrame: Math.round(pct(d.draws, 50)),
      textureUploadsPerSec: r1(d.uploads / d.secs),
      mapFetches: mapFetches - f0,
      mapUpdates: updates.length,
      mapUpdateP50Ms: r1(pct(updates, 50)),
      mapUpdateMaxMs: r1(Math.max(0, ...updates)),
      fps: r1(d.frames / d.secs),
      longTasks: d.long.length,
      longestTaskMs: Math.round(Math.max(0, ...d.long)),
      ticksPerSec: r1((tick1 - tick0) / d.secs),
    };
  }

  // Whole map in view (fitted: zoom 0.5 on a huge map).
  await phase('play, whole map', 8000);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Equal');
  await sleep(500);
  if (TRACE)
    await browser.startTracing(page, {
      path: TRACE,
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'gpu'],
    });
  await phase('play, zoomed in 2×', 8000);
  if (TRACE) await browser.stopTracing();
  await phase('pan while playing', 6000, async (end) => {
    let dir = 1;
    let n = 0;
    while (Date.now() < end) {
      await page.mouse.wheel(dir * 18, dir * 12);
      if (++n % 40 === 0) dir = -dir;
    }
  });
  await phase('zoom in/out while playing', 6000, async (end) => {
    await page.keyboard.down('Control');
    const pattern = [-60, -60, -60, 60, 60, 60, 60, 60, 60, -60, -60, -60];
    let i = 0;
    while (Date.now() < end) {
      await page.mouse.wheel(0, pattern[i++ % pattern.length]);
      await sleep(30);
    }
    await page.keyboard.up('Control');
  });

  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(PROFILE, JSON.stringify(profile));
  }
  results.population = (await api(`/api/worlds/${world.id}/view`)).agents.filter(
    (a) => a.alive,
  ).length;
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    stopServer();
    rmSync(dataDir, { recursive: true, force: true });
  });
