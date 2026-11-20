import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import {
  ANTHROPIC_DEFAULT_MODEL,
  AnthropicProvider,
  checkClaudeCli,
  CLAUDE_PLAN_DEFAULT_MODEL,
  ClaudePlanProvider,
  DEFAULT_PRICES,
  findClaudeCli,
  OpenAIProvider,
  type BrainProvider,
  type ClaudeCliStatus,
} from '@aw/brain';
import type { ModelPrice, ProviderStatus, ProviderUpdate, SettingsResponse } from '@aw/shared';
import { ValidationError } from './worlds/worldManager.ts';

type ProviderKey = ProviderStatus['id'];

interface Secrets {
  apiKeys: Partial<Record<ProviderKey, string>>;
}

interface Settings {
  baseUrls: Partial<Record<ProviderKey, string>>;
  defaultModels: Partial<Record<ProviderKey, string>>;
  prices: Record<string, ModelPrice>;
  /** Where the `claude` command is, if it isn't found automatically. */
  claudeCliPath?: string;
}

const LABELS: Record<ProviderKey, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible (OpenRouter, Ollama, LM Studio, …)',
  claude_plan: 'Claude subscription (Pro/Max)',
};
const ENV_KEYS: Partial<Record<ProviderKey, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openai_compatible: 'OPENAI_COMPATIBLE_API_KEY',
};
const DEFAULT_MODELS: Record<ProviderKey, string> = {
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  openai: '',
  openai_compatible: '',
  claude_plan: CLAUDE_PLAN_DEFAULT_MODEL,
};
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED_CLI_BASENAMES = new Set(['claude', 'claude.exe', 'claude.cmd']);

function isLocalUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validateClaudeCliPath(cliPath: string): void {
  if (!isAbsolute(cliPath)) {
    throw new ValidationError('Claude CLI path must be an absolute path.');
  }
  if (!ALLOWED_CLI_BASENAMES.has(basename(cliPath).toLowerCase())) {
    throw new ValidationError('Claude CLI executable must be named "claude".');
  }
  let st;
  try {
    st = statSync(cliPath);
  } catch {
    throw new ValidationError('Claude CLI path does not exist.');
  }
  if (!st.isFile()) {
    throw new ValidationError('Claude CLI path must point to a regular file.');
  }
  try {
    accessSync(cliPath, constants.X_OK);
  } catch {
    throw new ValidationError('Claude CLI path is not executable.');
  }
}

/**
 * API keys live in <dataDir>/secrets.json (readable only by you) or environment variables; they are
 * never sent to the browser. Other settings (base URLs, default models, prices) live in settings.json.
 */
export class SettingsStore {
  private readonly secretsPath: string;
  private readonly settingsPath: string;
  private secrets: Secrets;
  private settings: Settings;
  /** Last check of the Claude Code command (null until checkClaudePlan() has run). */
  private plan: ClaudeCliStatus | null = null;

  constructor(
    readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.secretsPath = join(dataDir, 'secrets.json');
    this.settingsPath = join(dataDir, 'settings.json');
    this.secrets = readJson<Secrets>(this.secretsPath, { apiKeys: {} });
    this.settings = readJson<Settings>(this.settingsPath, {
      baseUrls: {},
      defaultModels: {},
      prices: {},
    });
  }

  prices(): Record<string, ModelPrice> {
    return { ...DEFAULT_PRICES, ...this.settings.prices };
  }

  private key(id: ProviderKey): { key: string | null; source: 'settings' | 'environment' | null } {
    const stored = this.secrets.apiKeys[id];
    if (stored) return { key: stored, source: 'settings' };
    const envName = ENV_KEYS[id];
    const fromEnv = envName ? this.env[envName] : undefined;
    if (fromEnv) return { key: fromEnv, source: 'environment' };
    return { key: null, source: null };
  }

  private baseUrl(id: ProviderKey): string | null {
    if (id === 'openai') return null;
    if (id === 'openai_compatible') return this.settings.baseUrls[id] || DEFAULT_BASE_URL;
    return this.settings.baseUrls[id] || null;
  }

  defaultModel(id: ProviderKey): string {
    return this.settings.defaultModels[id] ?? DEFAULT_MODELS[id];
  }

  /**
   * Finds the `claude` command and asks it whether it's signed in with a Claude account. Runs at
   * startup and whenever the owner presses "Check" (no AI call, so it uses none of the plan).
   */
  async checkClaudePlan(): Promise<ClaudeCliStatus> {
    // AW_CLAUDE_CLI overrides the path; "off" hides Claude Code (end-to-end tests).
    const forced = this.env.AW_CLAUDE_CLI;
    const command =
      forced === 'off' ? null : forced || this.settings.claudeCliPath || findClaudeCli(this.env);
    this.plan = await checkClaudeCli(command, this.env);
    return this.plan;
  }

  view(): SettingsResponse {
    const providers = (Object.keys(LABELS) as ProviderKey[]).map((id): ProviderStatus => {
      if (id === 'claude_plan')
        return {
          id,
          kind: 'plan',
          label: LABELS[id],
          configured: Boolean(this.plan?.usesPlan),
          keyHint: null,
          keySource: null,
          baseUrl: null,
          defaultModel: this.defaultModel(id),
          cliPath: this.plan?.path ?? this.settings.claudeCliPath ?? null,
          message: this.plan?.message ?? 'Not checked yet.',
        };
      const { key, source } = this.key(id);
      // A local server (Ollama, LM Studio) needs no key; a base URL on localhost counts as configured.
      const local = id === 'openai_compatible' && isLocalUrl(this.baseUrl(id));
      return {
        id,
        kind: 'api',
        label: LABELS[id],
        configured: Boolean(key) || local,
        keyHint: key ? (key.length <= 10 ? '••••' : `${key.slice(0, 3)}…${key.slice(-4)}`) : null,
        keySource: source,
        baseUrl: this.baseUrl(id),
        defaultModel: this.defaultModel(id),
      };
    });
    return { providers, prices: this.prices(), dataDir: this.dataDir };
  }

  updateProvider(id: ProviderKey, update: ProviderUpdate): void {
    // Validate settings fields before writing secrets or mutating state.
    const trimmedBaseUrl = update.baseUrl !== undefined ? update.baseUrl.trim() : undefined;
    if (trimmedBaseUrl !== undefined && id === 'openai' && trimmedBaseUrl) {
      throw new ValidationError(
        'Custom base URL is not allowed for OpenAI; use OpenAI-compatible for custom endpoints.',
      );
    }
    const trimmedCliPath = update.cliPath !== undefined ? update.cliPath.trim() : undefined;
    if (trimmedCliPath !== undefined) {
      if (id !== 'claude_plan') {
        throw new ValidationError('CLI path can only be set for the Claude subscription provider.');
      }
      if (trimmedCliPath) validateClaudeCliPath(trimmedCliPath);
    }

    // The Claude subscription uses Claude Code's own login, never a key.
    if (update.apiKey !== undefined && id !== 'claude_plan') {
      if (update.apiKey.trim()) this.secrets.apiKeys[id] = update.apiKey.trim();
      else delete this.secrets.apiKeys[id];
      writeJsonAtomic(this.secretsPath, this.secrets, 0o600);
    }
    if (trimmedBaseUrl !== undefined) {
      if (trimmedBaseUrl) this.settings.baseUrls[id] = trimmedBaseUrl;
      else delete this.settings.baseUrls[id];
    }
    if (update.defaultModel !== undefined)
      this.settings.defaultModels[id] = update.defaultModel.trim();
    if (trimmedCliPath !== undefined) {
      if (trimmedCliPath) this.settings.claudeCliPath = trimmedCliPath;
      else delete this.settings.claudeCliPath;
    }
    this.saveSettings();
  }

  updatePrices(update: Record<string, ModelPrice | null>): void {
    for (const [model, price] of Object.entries(update)) {
      if (price) this.settings.prices[model] = price;
      else delete this.settings.prices[model];
    }
    this.saveSettings();
  }

  /** Providers that can be used right now (with keys, or a local endpoint). */
  buildProviders(): BrainProvider[] {
    const out: BrainProvider[] = [];
    const prices = () => this.prices();
    for (const status of this.view().providers) {
      if (!status.configured) continue;
      const { key } = this.key(status.id);
      if (status.id === 'claude_plan')
        out.push(new ClaudePlanProvider(this.plan!.path!, status.defaultModel, this.env));
      else if (status.id === 'anthropic')
        out.push(new AnthropicProvider(key!, status.defaultModel, prices));
      else
        out.push(
          new OpenAIProvider(
            status.id,
            key ?? '',
            status.baseUrl ?? undefined,
            status.defaultModel,
            prices,
          ),
        );
    }
    return out;
  }

  private saveSettings(): void {
    writeJsonAtomic(this.settingsPath, this.settings);
  }
}

function writeJsonAtomic(path: string, data: unknown, mode?: number): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), mode !== undefined ? { mode } : undefined);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(path, 'utf8')) as T) };
  } catch {
    return fallback;
  }
}
