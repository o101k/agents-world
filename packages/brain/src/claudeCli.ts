import { spawn } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { BrainConfig, DecisionRequest, EffortLevel } from '@aw/shared';
import { systemPrompt, userPrompt } from './prompt.ts';
import { DECIDE_SCHEMA, extractJson, parseDecision } from './schema.ts';
import {
  NoDecisionError,
  RefusalError,
  RateLimitError,
  type BrainProvider,
  type BrainResult,
  type GenerateRequest,
  type Usage,
} from './types.ts';

/**
 * Claude through the owner's own Claude subscription (Pro/Max), by running the official Claude Code
 * command-line app (`claude -p`) that the owner installed and signed in to themselves. Anthropic
 * allows this for personal projects; it is NOT allowed to take the subscription's sign-in token and
 * call the API with it, so this helper never reads, stores or sends any Claude login. Usage counts
 * against the plan's 5-hour and weekly limits instead of costing money.
 */

/** Model aliases the CLI understands; they always point at the newest model of each family. */
export const CLAUDE_PLAN_MODELS = ['haiku', 'sonnet', 'opus'];
/** Haiku stretches the plan's limits furthest. */
export const CLAUDE_PLAN_DEFAULT_MODEL = 'haiku';

const EFFORT: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  frugal: 'low',
  standard: 'medium',
  deep: 'high',
};

/**
 * Environment variables that would make the CLI bill an API key or another cloud instead of the
 * subscription, or think it is running inside another Claude Code session.
 */
const NOT_PASSED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDECODE',
];

export function planEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of NOT_PASSED) delete out[k];
  return out;
}

/** Finds the `claude` command: on PATH, then where its installers put it. Null if not installed. */
export function findClaudeCli(env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const homes = [env.HOME, env.USERPROFILE].filter(
    (h, i, arr): h is string => Boolean(h) && arr.indexOf(h) === i,
  );
  for (const home of homes) {
    dirs.push(join(home, '.local', 'bin'), join(home, '.claude', 'local'));
  }
  if (process.platform !== 'win32') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
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
    input?: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('aborted'));
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
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
        reject(new Error('Claude CLI stdout exceeded 4 MiB limit'));
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
        reject(new Error('Claude CLI stderr exceeded 4 MiB limit'));
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
    child.stdin.on('error', () => {}); // the process may exit before reading everything
    child.stdin.end(opts.input ?? '');
  });
}

/** What `claude auth status` says, plus whether this helper can use the subscription through it. */
export interface ClaudeCliStatus {
  path: string | null;
  version: string | null;
  loggedIn: boolean;
  /** none | claude.ai | oauth_token | api_key | api_key_helper | third_party */
  authMethod: string | null;
  /** Signed in with a Claude account, so calls use the plan's limits. */
  usesPlan: boolean;
  /** One plain sentence for the settings screen. */
  message: string;
}

const PLAN_METHODS = new Set(['claude.ai', 'oauth_token']);

export async function checkClaudeCli(
  command: string | null,
  env: NodeJS.ProcessEnv,
): Promise<ClaudeCliStatus> {
  const none = { version: null, loggedIn: false, authMethod: null, usesPlan: false };
  if (!command)
    return {
      path: null,
      ...none,
      message: 'Claude Code is not installed (the `claude` command was not found).',
    };
  const opts = { env: planEnv(env), cwd: workDir(), timeoutMs: 20_000 };
  try {
    const v = await run(command, ['--version'], opts);
    const version = v.stdout.trim().split(/\s/)[0] || null;
    const s = await run(command, ['auth', 'status'], opts);
    let info: { loggedIn?: boolean; authMethod?: string } = {};
    try {
      info = JSON.parse(s.stdout) as typeof info;
    } catch {
      // older versions print text; fall back to the exit code
    }
    const loggedIn = info.loggedIn ?? s.code === 0;
    const authMethod = info.authMethod ?? (loggedIn ? 'claude.ai' : 'none');
    const usesPlan = loggedIn && PLAN_METHODS.has(authMethod);
    return {
      path: command,
      version,
      loggedIn,
      authMethod,
      usesPlan,
      message: usesPlan
        ? `Ready: Claude Code${version ? ` ${version}` : ''} is signed in with your Claude account.`
        : loggedIn
          ? `Claude Code is signed in with an API key (${authMethod}), not a Claude subscription. Run \`claude auth login\` in Terminal and choose your Claude account.`
          : 'Claude Code is installed but not signed in. Run `claude` in Terminal and log in with your Claude account.',
    };
  } catch (err) {
    return {
      path: command,
      ...none,
      message: `Couldn't run Claude Code: ${(err as Error).message}`,
    };
  }
}

let cachedWorkDir: string | undefined;

/** An empty private folder to run the CLI in, so it never picks up a project's CLAUDE.md or settings. */
function workDir(): string {
  if (!cachedWorkDir) {
    cachedWorkDir = mkdtempSync(join(tmpdir(), 'agents-world-claude-'));
    chmodSync(cachedWorkDir, 0o700);
  }
  return cachedWorkDir;
}

const LIMIT_RE =
  /usage limit|hit your (?:\w+ )?limit|limit reached|limit will reset|resets? (?:at )?\d|rate.?limit|out of (?:extra )?usage/i;

/** When the plan's limit resets, if the CLI's message says (epoch "…|1759780800" or "resets 9pm"). */
export function parseResetTime(text: string, now = new Date()): number | undefined {
  const epoch = /\|(\d{10,13})\b/.exec(text);
  if (epoch) {
    const n = Number(epoch[1]);
    return n < 1e12 ? n * 1000 : n;
  }
  const at =
    /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2})\s*(am|pm)?|\s*(am|pm))\b(?:\s*\(?(UTC|GMT)\)?)?/i.exec(
      text,
    );
  if (!at) return undefined;
  let hour = Number(at[1]);
  const minute = Number(at[2] ?? 0);
  const ampm = (at[3] ?? at[4])?.toLowerCase();
  const isUtc = Boolean(at[5]);
  if (ampm) {
    if (hour < 1 || hour > 12) return undefined;
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return undefined;
  const t = new Date(now);
  if (isUtc) {
    t.setUTCHours(hour, minute, 0, 0);
    if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 1);
  } else {
    t.setHours(hour, minute, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  }
  return t.getTime();
}

/** One model's share of a call, as Claude Code reports it in `modelUsage`. */
interface CliModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  stop_reason?: string;
  api_error_status?: number | null;
  structured_output?: unknown;
  /** Why an error result failed, when it has no `result` (e.g. error_max_turns). */
  errors?: string[];
  /** Estimated cost at API list prices, for all models the call used. */
  total_cost_usd?: number;
  /** Main loop only; `modelUsage` is the full count. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, CliModelUsage>;
}

/**
 * What one call used, from Claude Code's per-model totals (the top-level `usage` leaves out helper
 * calls). Cost is at API prices: the plan covers it, but the world's spending cap still counts it.
 */
export function planUsage(out: CliResult): Usage {
  const perModel = Object.values(out.modelUsage ?? {});
  const models: CliModelUsage[] =
    perModel.length > 0
      ? perModel
      : out.usage
        ? [
            {
              inputTokens: out.usage.input_tokens,
              outputTokens: out.usage.output_tokens,
              cacheReadInputTokens: out.usage.cache_read_input_tokens,
              cacheCreationInputTokens: out.usage.cache_creation_input_tokens,
            },
          ]
        : [];
  const sum = (pick: (m: CliModelUsage) => number | undefined) =>
    models.reduce((total, m) => total + (pick(m) ?? 0), 0);
  const cacheRead = sum((m) => m.cacheReadInputTokens);
  const cost = out.total_cost_usd;
  return {
    inputTokens: sum((m) => m.inputTokens) + cacheRead + sum((m) => m.cacheCreationInputTokens),
    outputTokens: sum((m) => m.outputTokens),
    cachedInputTokens: cacheRead,
    costUsd:
      typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : sum((m) => m.costUSD),
    coveredByPlan: true,
  };
}

/** The model that did most of the work (most output tokens), or the one asked for. */
function reportedModel(out: CliResult, fallback: string): string {
  let best = fallback;
  let bestOutput = -1;
  for (const [name, m] of Object.entries(out.modelUsage ?? {})) {
    const output = m.outputTokens ?? 0;
    if (output > bestOutput) {
      best = name;
      bestOutput = output;
    }
  }
  return best;
}

export class ClaudePlanProvider implements BrainProvider {
  readonly id = 'claude_plan' as const;

  constructor(
    private readonly command: string,
    private readonly defaultModel: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly timeoutMs = 90_000,
  ) {}

  /** Runs one `claude -p` call that must answer with JSON matching `schema`. */
  private async ask(
    opts: { model: string; system: string; user: string; schema: unknown; effort?: EffortLevel },
    signal?: AbortSignal,
  ): Promise<{ output: unknown; text?: string; usage: Usage; model: string }> {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(opts.schema),
      '--model',
      opts.model,
      '--system-prompt',
      `${opts.system}\n\nGive your answer through your structured-output tool, exactly once; it takes the same fields as the tool described above.`,
      // A villager's mind, not a coding agent: no tools, no MCP servers, no skills, no CLAUDE.md,
      // no saved session.
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--safe-mode',
      '--no-session-persistence',
      '--max-turns',
      '3',
    ];
    // Haiku has no effort setting.
    if (opts.effort && !/haiku/i.test(opts.model)) args.push('--effort', EFFORT[opts.effort]);
    const res = await run(this.command, args, {
      env: planEnv(this.env),
      cwd: workDir(),
      input: opts.user,
      signal,
      timeoutMs: this.timeoutMs,
    });
    let out: CliResult | null;
    try {
      out = JSON.parse(res.stdout) as CliResult;
    } catch {
      out = extractJson(res.stdout) as CliResult | null;
    }
    const resultText =
      typeof out?.result === 'string' && out.result.trim() ? out.result.trim() : '';
    const errorsText = out?.errors?.length ? out.errors.join('; ').trim() : '';
    const stderrText = res.stderr.trim();
    const text = (
      resultText ||
      errorsText ||
      (out?.subtype?.startsWith('error_')
        ? `Claude Code stopped (${out.subtype})`
        : out
          ? stderrText
          : `${res.stdout}\n${res.stderr}`.trim())
    ).trim();
    if (!out || out.is_error || res.code !== 0) {
      const combined = [resultText, errorsText, stderrText, !out ? res.stdout.trim() : '']
        .filter(Boolean)
        .join('\n');
      const limitText = LIMIT_RE.test(text) ? text : combined;
      if (out?.api_error_status === 429 || LIMIT_RE.test(limitText))
        throw new RateLimitError((limitText || text).slice(0, 300), {
          resetsAt: parseResetTime(limitText || text),
          status: out?.api_error_status ?? undefined,
          limit: /weekly/i.test(limitText || text) ? 'weekly plan limit' : 'plan usage limit',
        });
      if (/unknown option|unrecognized/i.test(combined || text))
        throw new Error(
          `Claude Code is too old for Agents World; run \`claude update\`. (${(text || combined).slice(0, 200)})`,
        );
      // The call ran and gave no answer, but its tokens and cost still count.
      if (out)
        throw new NoDecisionError(
          text.slice(0, 300) || `claude exited with code ${res.code}`,
          planUsage(out),
        );
      throw new Error(text.slice(0, 300) || `claude exited with code ${res.code}`);
    }
    const usage = planUsage(out);
    if (out.stop_reason === 'refusal') throw new RefusalError('The model declined.', usage);
    const model = reportedModel(out, opts.model);
    return {
      output: out.structured_output ?? extractJson(out.result ?? ''),
      text: typeof out.result === 'string' && out.result.trim() ? out.result.trim() : undefined,
      usage,
      model,
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

  /** The aliases, after checking the CLI still runs and is signed in (no AI call, no usage). */
  async listModels(): Promise<string[]> {
    const status = await checkClaudeCli(this.command, this.env);
    if (!status.usesPlan) throw new Error(status.message);
    return [...CLAUDE_PLAN_MODELS];
  }
}
