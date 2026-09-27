import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANTHROPIC_DEFAULT_MODEL,
  AnthropicProvider,
  DEFAULT_PRICES,
  OpenAIProvider,
  type BrainProvider,
} from '@aw/brain';
import type { ModelPrice, ProviderStatus, ProviderUpdate, SettingsResponse } from '@aw/shared';

type ProviderKey = ProviderStatus['id'];

interface Secrets {
  apiKeys: Partial<Record<ProviderKey, string>>;
}

interface Settings {
  baseUrls: Partial<Record<ProviderKey, string>>;
  defaultModels: Partial<Record<ProviderKey, string>>;
  prices: Record<string, ModelPrice>;
}

const LABELS: Record<ProviderKey, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible (OpenRouter, Ollama, LM Studio, …)',
};
const ENV_KEYS: Record<ProviderKey, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openai_compatible: 'OPENAI_COMPATIBLE_API_KEY',
};
const DEFAULT_MODELS: Record<ProviderKey, string> = {
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  openai: '',
  openai_compatible: '',
};
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * API keys live in <dataDir>/secrets.json (readable only by you) or environment variables; they are
 * never sent to the browser. Other settings (base URLs, default models, prices) live in settings.json.
 */
export class SettingsStore {
  private readonly secretsPath: string;
  private readonly settingsPath: string;
  private secrets: Secrets;
  private settings: Settings;

  constructor(
    readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
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
    const fromEnv = this.env[ENV_KEYS[id]];
    if (fromEnv) return { key: fromEnv, source: 'environment' };
    return { key: null, source: null };
  }

  private baseUrl(id: ProviderKey): string | null {
    if (id === 'openai_compatible') return this.settings.baseUrls[id] || DEFAULT_BASE_URL;
    return this.settings.baseUrls[id] || null;
  }

  defaultModel(id: ProviderKey): string {
    return this.settings.defaultModels[id] ?? DEFAULT_MODELS[id];
  }

  view(): SettingsResponse {
    const providers = (Object.keys(LABELS) as ProviderKey[]).map((id): ProviderStatus => {
      const { key, source } = this.key(id);
      // A local server (Ollama, LM Studio) needs no key; a base URL on localhost counts as configured.
      const local =
        id === 'openai_compatible' && /\/\/(localhost|127\.0\.0\.1)/.test(this.baseUrl(id) ?? '');
      return {
        id,
        label: LABELS[id],
        configured: Boolean(key) || local,
        keyHint: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : null,
        keySource: source,
        baseUrl: this.baseUrl(id),
        defaultModel: this.defaultModel(id),
      };
    });
    return { providers, prices: this.prices(), dataDir: this.dataDir };
  }

  updateProvider(id: ProviderKey, update: ProviderUpdate): void {
    if (update.apiKey !== undefined) {
      if (update.apiKey.trim()) this.secrets.apiKeys[id] = update.apiKey.trim();
      else delete this.secrets.apiKeys[id];
      writeFileSync(this.secretsPath, JSON.stringify(this.secrets, null, 2), { mode: 0o600 });
      chmodSync(this.secretsPath, 0o600);
    }
    if (update.baseUrl !== undefined) {
      if (update.baseUrl.trim()) this.settings.baseUrls[id] = update.baseUrl.trim();
      else delete this.settings.baseUrls[id];
    }
    if (update.defaultModel !== undefined)
      this.settings.defaultModels[id] = update.defaultModel.trim();
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
      if (status.id === 'anthropic')
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
    writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
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
