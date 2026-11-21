import { spawn } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { BrainConfig, DecisionRequest, EffortLevel, ModelPrice } from '@aw/shared';
import { parseResetTime } from './claudeCli.ts';
import { costOf } from './pricing.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { DECIDE_SCHEMA, extractJson, parseDecision } from './schema.ts';
import {
  NoDecisionError,
  RateLimitError,
  type BrainProvider,
  type BrainResult,
  type GenerateRequest,
  type Usage,
} from './types.ts';

/**
 * Gemini (and other plan models) through the owner's own Antigravity subscription, by running the
 * official Antigravity command-line app (`agy --print`) that the owner installed and signed in to
 * themselves. Never reads, stores or sends any login tokens; usage counts against the plan's quota
 * instead of costing money.
 */

/** Fallback model list when `agy models` hasn't run yet. */
export const AGY_PLAN_MODELS = [
  'gemini-3.8-flash-low',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-high',
  'gemini-4-argon-low',
  'gemini-4-argon-medium',
  'gemini-4-argon-high',
  'gemini-4-neon-low',
  'gemini-4-neon-medium',
  'gemini-4-neon-high',
];
/** Gemini 3.8 Flash (Low) is fastest and stretches plan quota furthest. */
export const AGY_PLAN_DEFAULT_MODEL = 'gemini-3.8-flash-low';

export interface AgyModelOption {
  id: string;
  label: string;
}

const EFFORT: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  frugal: 'low',
  standard: 'medium',
  deep: 'high',
};

/**
 * Environment variables that could override or interfere with the owner's Antigravity subscription
 * session.
 */
const NOT_PASSED = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

export function agyPlanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of NOT_PASSED) delete out[k];
  return out;
}

/** Finds the `agy` command: on PATH, then common install locations. Null if not installed. */
export function findAgyCli(env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const homes = [env.HOME, env.USERPROFILE].filter(
    (h, i, arr): h is string => Boolean(h) && arr.indexOf(h) === i,
  );
  for (const home of homes) {
    dirs.push(join(home, '.local', 'bin'));
  }
  if (process.platform !== 'win32') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  const names = process.platform === 'win32' ? ['agy.exe', 'agy.cmd'] : ['agy'];
  for (const dir of dirs) {
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (!statSync(path).isFile()) continue;
        accessSync(path, constants.X_OK);
        return path;
      } catch {
        // not here
      }
    }
  }
  return null;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SIGKILL_DELAY_MS = 3_000;

function run(
  command: string,
  args: string[],
  opts: {
    env: NodeJS.ProcessEnv;
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('aborted'));
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let killing = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      if (killing) return;
      killing = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // already exited
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already exited
        }
      }, SIGKILL_DELAY_MS);
      killTimer.unref?.();
    };

    const cleanup = (includeKillTimer: boolean) => {
      clearTimeout(timer);
      if (includeKillTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', terminate);
    };

    const timer = setTimeout(terminate, opts.timeoutMs);
    opts.signal?.addEventListener('abort', terminate, { once: true });

    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      if (settled) return;
      stdoutBytes += Buffer.byteLength(d, 'utf8');
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        settled = true;
        cleanup(false);
        terminate();
        reject(new Error('Antigravity CLI stdout exceeded 4 MiB limit'));
        return;
      }
      stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (settled) return;
      stderrBytes += Buffer.byteLength(d, 'utf8');
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        settled = true;
        cleanup(false);
        terminate();
        reject(new Error('Antigravity CLI stderr exceeded 4 MiB limit'));
        return;
      }
      stderr += d;
    });

    child.on('error', (err) => {
      cleanup(true);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('close', (code) => {
      cleanup(true);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

/** What `agy models` reports, plus whether this helper can use the subscription through it. */
export interface AgyCliStatus {
  path: string | null;
  version: string | null;
  loggedIn: boolean;
  /** Signed in and able to list models, so calls use the Antigravity plan. */
  usesPlan: boolean;
  models: AgyModelOption[];
  /** One plain sentence for the settings screen. */
  message: string;
}

const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[a-zA-Z]`, 'g');

/** Parses `agy models` output, stripping spinner carriage returns and ANSI escape sequences. */
export function parseAgyModels(stdout: string): AgyModelOption[] {
  const models: AgyModelOption[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const clean = rawLine.replace(ANSI_RE, '');
    const afterCr = clean.includes('\r') ? clean.slice(clean.lastIndexOf('\r') + 1) : clean;
    const line = afterCr.trim();
    if (!line) continue;
    const m = /^([a-z0-9]+(?:[._-][a-z0-9]+)+)\s+(.+)$/.exec(line);
    if (m) models.push({ id: m[1]!, label: m[2]!.trim() });
  }
  return models;
}

export async function checkAgyCli(
  command: string | null,
  env: NodeJS.ProcessEnv,
): Promise<AgyCliStatus> {
  const none = { version: null, loggedIn: false, usesPlan: false, models: [] };
  if (!command)
    return {
      path: null,
      ...none,
      message: 'Antigravity CLI is not installed (the `agy` command was not found).',
    };
  const opts = { env: agyPlanEnv(env), cwd: workDir(), timeoutMs: 30_000 };
  try {
    const v = await run(command, ['--version'], opts);
    const version = v.stdout.trim().split(/\s/)[0] || null;
    const m = await run(command, ['models'], opts);
    const models = parseAgyModels(m.stdout);
    const loggedIn = m.code === 0 && models.length > 0;
    const usesPlan = loggedIn;
    const detail = `${m.stderr}\n${m.stdout}`.trim();
    const authError =
      /sign.?in|log.?in|auth|unauthenticated|credential|not logged in/i.test(detail) || !detail;
    return {
      path: command,
      version,
      loggedIn,
      usesPlan,
      models,
      message: usesPlan
        ? `Ready: Antigravity CLI${version ? ` ${version}` : ''} is signed in (${models.length} models available).`
        : authError
          ? 'Antigravity CLI is installed but not signed in. Run `agy` in Terminal and log in with your Google account.'
          : `Antigravity CLI check failed: ${detail.split(/\r?\n/)[0]!.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      path: command,
      ...none,
      message: `Couldn't run Antigravity CLI: ${(err as Error).message}`,
    };
  }
}

let cachedWorkDir: string | undefined;

/** An empty private folder to run the CLI in, so it never picks up a project's AGENTS/CLAUDE instructions. */
function workDir(): string {
  if (!cachedWorkDir) {
    cachedWorkDir = mkdtempSync(join(tmpdir(), 'agents-world-agy-'));
    chmodSync(cachedWorkDir, 0o700);
  }
  return cachedWorkDir;
}

const LIMIT_RE =
  /429|quota|resource_exhausted|too many requests|usage limit|hit your (?:\w+ )?limit|limit reached|limit will reset|resets? (?:at )?\d|rate.?limit|out of (?:extra )?usage/i;

interface AgyCliResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  structured_output?: unknown;
  finished_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Estimates the API-price value of one `agy` call from its reported token counts. Covered by the
 * owner's subscription, but counted toward the world's spending cap.
 */
export function agyPlanUsage(
  out: AgyCliResult,
  model: string,
  prices: Record<string, ModelPrice>,
): Usage {
  const cacheRead = out.usage?.cache_read_tokens ?? 0;
  const input = Math.max(0, (out.usage?.input_tokens ?? 0) - cacheRead);
  const output = (out.usage?.output_tokens ?? 0) + (out.usage?.thinking_tokens ?? 0);
  return {
    ...costOf(model, { input, output, cacheRead }, prices),
    coveredByPlan: true,
  };
}

export class AgyPlanProvider implements BrainProvider {
  readonly id = 'agy_plan' as const;

  constructor(
    private readonly command: string,
    private readonly defaultModel: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly prices: () => Record<string, ModelPrice>,
    private readonly timeoutMs = 90_000,
  ) {}

  /** Runs one `agy --print` call that must answer with JSON matching `schema`. */
  private async ask(
    opts: { model: string; system: string; user: string; schema: unknown; effort?: EffortLevel },
    signal?: AbortSignal,
  ): Promise<{ output: unknown; text?: string; usage: Usage; model: string }> {
    const prompt = `${opts.system}\n\nRespond with JSON matching the required schema.\n\n---\n\n${opts.user}`;
    const args = [
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(opts.schema),
      '--model',
      opts.model,
      '--disable-slash-commands',
    ];
    if (opts.effort) args.push('--effort', EFFORT[opts.effort]);
    args.push('--print', prompt);

    const res = await run(this.command, args, {
      env: agyPlanEnv(this.env),
      cwd: workDir(),
      signal,
      timeoutMs: this.timeoutMs,
    });
    let out: AgyCliResult | null;
    try {
      out = JSON.parse(res.stdout) as AgyCliResult;
    } catch {
      out = extractJson(res.stdout) as AgyCliResult | null;
    }
    const errorText = typeof out?.error === 'string' && out.error.trim() ? out.error.trim() : '';
    const responseText =
      typeof out?.response === 'string' && out.response.trim() ? out.response.trim() : '';
    const stderrText = res.stderr.trim();
    const text = (
      errorText ||
      responseText ||
      (out ? stderrText : `${res.stdout}\n${res.stderr}`.trim())
    ).trim();
    if (!out || out.status === 'ERROR' || out.finished_reason === 'error' || res.code !== 0) {
      const combined = [errorText, responseText, stderrText, !out ? res.stdout.trim() : '']
        .filter(Boolean)
        .join('\n');
      const limitText = LIMIT_RE.test(text) ? text : combined;
      if (LIMIT_RE.test(limitText))
        throw new RateLimitError((limitText || text).slice(0, 300), {
          resetsAt: parseResetTime(limitText || text),
          status: /\b429\b/.test(limitText || text) ? 429 : undefined,
          limit: /weekly/i.test(limitText || text) ? 'weekly plan limit' : 'plan usage limit',
        });
      if (/unknown flag|flag provided but not defined|unrecognized/i.test(combined || text))
        throw new Error(
          `Antigravity CLI is too old for Agents World; run \`agy update\`. (${(text || combined).slice(0, 200)})`,
        );
      if (out && (out.usage?.total_tokens ?? 0) > 0)
        throw new NoDecisionError(
          text.slice(0, 300) || `agy exited with code ${res.code}`,
          agyPlanUsage(out, opts.model, this.prices()),
        );
      throw new Error(text.slice(0, 300) || `agy exited with code ${res.code}`);
    }
    const usage = agyPlanUsage(out, opts.model, this.prices());
    return {
      output: out.structured_output ?? extractJson(out.response ?? ''),
      text: typeof out.response === 'string' && out.response.trim() ? out.response.trim() : undefined,
      usage,
      model: opts.model,
    };
  }

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    signal?: AbortSignal,
  ): Promise<BrainResult> {
    const p = request.perception;
    const system = systemPrompt(p);
    const user = userPrompt(p);
    const started = Date.now();
    const { output, usage, model } = await this.ask(
      {
        model: config.model || this.defaultModel,
        system,
        user,
        schema: DECIDE_SCHEMA,
        effort: config.effort,
      },
      signal,
    );
    if (!output) throw new NoDecisionError('The model did not return a decision.', usage);
    return {
      decision: parseDecision(output, p),
      usage,
      trace: {
        model,
        prompt: `${system}\n\n---\n\n${user}`,
        response: JSON.stringify(output, null, 2),
        latencyMs: Date.now() - started,
      },
    };
  }

  async generate(req: GenerateRequest, signal?: AbortSignal) {
    return this.ask(
      {
        model: req.model || this.defaultModel,
        system: req.system,
        user: req.user,
        schema: req.schema,
      },
      signal,
    );
  }

  /** Available models from `agy models`, after verifying the CLI runs and is signed in. */
  async listModels(): Promise<string[]> {
    const status = await checkAgyCli(this.command, this.env);
    if (!status.usesPlan) throw new Error(status.message);
    return status.models.length ? status.models.map((m) => m.id) : [...AGY_PLAN_MODELS];
  }
}
