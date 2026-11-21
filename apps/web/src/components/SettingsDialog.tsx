import { useEffect, useRef, useState } from 'react';
import type { ModelPrice, ProviderStatus } from '@aw/shared';
import { api } from '../api.ts';
import { planModelsFor } from '../planModels.ts';
import { useSettings } from '../settingsStore.ts';
import { useDialog } from './useDialog.ts';

/** API keys, endpoints and the price table. Keys go to the local helper only and are never shown again. */
export function SettingsDialog() {
  const settings = useSettings((s) => s.settings);
  const loading = useSettings((s) => s.loading);
  const error = useSettings((s) => s.error);
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
  const load = useSettings((s) => s.load);
  const set = useSettings((s) => s.set);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useDialog(dialogRef, () => setOpen(false), { open });

  if (!open) return null;
  return (
    <div className="modal-backdrop is-global" onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal panel settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="muted small">
          Use your Claude or Gemini (<code>agy</code>) subscription, or API keys. Keys are stored
          only on this computer{settings?.dataDir ? ` (${settings.dataDir}/secrets.json)` : ''} and
          are never sent to the browser. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY,
          OPENAI_COMPATIBLE_API_KEY) also work.
        </p>
        {error && (
          <div className="banner banner-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-small" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {loading && !settings && <p className="muted">Loading settings…</p>}
        {settings?.providers
          .filter((p) => p.kind === 'plan')
          .map((p) => (
            <PlanCard key={p.id} provider={p} onSaved={set} />
          ))}
        {settings?.providers
          .filter((p) => p.kind === 'api')
          .map((p) => (
            <ProviderCard key={p.id} provider={p} onSaved={set} />
          ))}
        {settings && <PriceTable prices={settings.prices} onSaved={set} />}
      </div>
    </div>
  );
}

/** Subscription plans: set up by signing in to the local CLI (`claude` or `agy`), so there's no key here. */
function PlanCard({
  provider,
  onSaved,
}: {
  provider: ProviderStatus;
  onSaved: (s: Awaited<ReturnType<typeof api.settings>>) => void;
}) {
  const isAgy = provider.id === 'agy_plan';
  const cliName = isAgy ? 'Antigravity CLI' : 'Claude Code';
  const models = planModelsFor(provider);
  const [model, setModel] = useState(provider.defaultModel);
  const [cliPath, setCliPath] = useState(provider.cliPath ?? '');
  const [howOpen, setHowOpen] = useState(!provider.configured);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/loading state when the fetch key changes
    setModel(provider.defaultModel);
  }, [provider.defaultModel]);

  const act = async (fn: () => ReturnType<typeof api.settings>, done: string) => {
    setBusy(true);
    setIsError(false);
    setStatus(`Checking ${cliName}…`);
    try {
      const next = await fn();
      onSaved(next);
      const plan = next.providers.find((p) => p.id === provider.id);
      setStatus(plan?.configured ? done : null);
    } catch (e) {
      setIsError(true);
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="provider-card">
      <div className="provider-head">
        <strong>{provider.label}</strong>
        <span className={`tag ${provider.configured ? 'tag-ok' : ''}`}>
          {provider.configured ? 'Ready' : 'Not set up'}
        </span>
      </div>
      <p className={`small ${provider.configured ? 'muted' : 'warn'}`}>{provider.message}</p>
      <details
        className="plan-howto"
        open={howOpen}
        onToggle={(e) => setHowOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          {isAgy ? 'How to use your Gemini subscription (agy)' : 'How to use your Claude subscription'}
        </summary>
        {isAgy ? (
          <>
            <ol>
              <li>
                Install the Antigravity CLI (<code>agy</code>) on this Mac so the <code>agy</code>{' '}
                command is available.
              </li>
              <li>
                Run <code>agy</code> in Terminal once and log in with your Google account. Then you
                can close it.
              </li>
              <li>
                Press <strong>Check</strong> below. It should say Ready.
              </li>
              <li>
                Choose <strong>Gemini subscription (agy)</strong> as the provider when you pick
                brains for a new world, or later with the <strong>🧠 Brains</strong> button (one
                person or the whole village at once), then pick a model and an effort.
              </li>
            </ol>
            <ul className="muted small">
              <li>
                Villagers use your Antigravity subscription quota, the same allowance as your own
                Antigravity sessions. It costs no extra money, but each call’s estimated API-price
                value counts toward the world’s spending cap, so raise the cap to let plan
                villagers run longer.
              </li>
              <li>
                When a limit runs out, time pauses and resumes by itself when the limit resets.
              </li>
              <li>
                Effort: Frugal, Standard and Deep set how much each villager thinks (and{' '}
                <code>agy</code> effort low, medium or high). Gemini 3.8 Flash (Low) with Frugal
                stretches limits furthest.
              </li>
              <li>
                Agents World never sees your Google login: it only runs the <code>agy</code> command
                you signed in to yourself. API keys below remain a separate option.
              </li>
            </ul>
          </>
        ) : (
          <>
            <ol>
              <li>
                Install Claude Code on this Mac. In Terminal, run{' '}
                <code>curl -fsSL https://claude.ai/install.sh | bash</code>
              </li>
              <li>
                Run <code>claude</code> in Terminal once and log in with the Claude account that has
                your Pro or Max plan. Then you can close it.
              </li>
              <li>
                Press <strong>Check</strong> below. It should say Ready.
              </li>
              <li>
                Choose <strong>Claude subscription</strong> as the provider when you pick brains for
                a new world, or later with the <strong>🧠 Brains</strong> button (one person or the
                whole village at once), then pick a model and an effort.
              </li>
            </ol>
            <ul className="muted small">
              <li>
                Villagers use your plan’s 5-hour and weekly limits, the same allowance as your own
                Claude chats and Claude Code. It costs no extra money, but each call’s API-price
                value (Claude Code’s own estimate) counts toward the world’s spending cap, so raise
                the cap to let plan villagers run longer.
              </li>
              <li>
                When the limit runs out, time pauses and resumes by itself when the limit resets.
              </li>
              <li>
                Effort: Frugal, Standard and Deep set how much each villager thinks (and Claude’s
                effort low, medium or high). Haiku with Frugal makes the limits last longest.
              </li>
              <li>
                Agents World never sees your Claude login: it only runs the <code>claude</code>{' '}
                command, which Anthropic allows for your own projects. API keys below remain a
                separate option.
              </li>
            </ul>
          </>
        )}
      </details>
      <div className="provider-grid">
        <label>
          Default model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!models.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>
        <label>
          {cliName} location (optional)
          <input
            value={cliPath}
            onChange={(e) => setCliPath(e.target.value)}
            placeholder={
              provider.cliPath ??
              (isAgy
                ? 'Found automatically, e.g. ~/.local/bin/agy'
                : 'Found automatically, e.g. ~/.local/bin/claude')
            }
          />
        </label>
      </div>
      <div className="provider-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                api.updateProvider(provider.id, {
                  defaultModel: model,
                  cliPath: cliPath.trim(),
                }),
              'Saved.',
            )
          }
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => void act(() => api.checkPlan(provider.id as 'claude_plan' | 'agy_plan'), 'Ready.')}
        >
          Check
        </button>
        {status && (
          <span
            className={`${isError ? 'warn' : 'muted'} small`}
            role={isError ? 'alert' : undefined}
          >
            {status}
          </span>
        )}
      </div>
    </section>
  );
}

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: ProviderStatus;
  onSaved: (s: Awaited<ReturnType<typeof api.settings>>) => void;
}) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [model, setModel] = useState(provider.defaultModel);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/loading state when the fetch key changes
    setBaseUrl(provider.baseUrl ?? '');
    setModel(provider.defaultModel);
  }, [provider.baseUrl, provider.defaultModel]);

  const save = async (update: Parameters<typeof api.updateProvider>[1]) => {
    setBusy(true);
    setStatus(null);
    setIsError(false);
    try {
      onSaved(await api.updateProvider(provider.id, update));
      setKey('');
      setStatus('Saved.');
    } catch (e) {
      setIsError(true);
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setIsError(false);
    setStatus('Testing…');
    try {
      const { models } = await api.providerModels(provider.id);
      setStatus(`Connected — ${models.length} models available.`);
    } catch (e) {
      setIsError(true);
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="provider-card">
      <div className="provider-head">
        <strong>{provider.label}</strong>
        <span className={`tag ${provider.configured ? 'tag-ok' : ''}`}>
          {provider.configured
            ? provider.keyHint
              ? `Key ${provider.keyHint}${provider.keySource === 'environment' ? ' (env)' : ''}`
              : 'Ready'
            : 'Not set up'}
        </span>
      </div>
      <div className="provider-grid">
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={
              provider.keyHint
                ? 'Enter a new key to replace'
                : provider.id === 'openai_compatible'
                  ? 'Not needed for local servers'
                  : 'Paste your key'
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        {provider.id === 'openai_compatible' && (
          <label>
            Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
            />
          </label>
        )}
        <label>
          Default model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider.id === 'anthropic' ? 'claude-haiku-4-5' : 'e.g. gpt-5-mini'}
          />
        </label>
      </div>
      <div className="provider-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy}
          onClick={() =>
            void save({
              ...(key ? { apiKey: key } : {}),
              ...(provider.id === 'openai_compatible' ? { baseUrl } : {}),
              defaultModel: model,
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy || !provider.configured}
          onClick={() => void test()}
        >
          Test connection
        </button>
        {provider.keySource === 'settings' && (
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            disabled={busy}
            onClick={() => void save({ apiKey: '' })}
          >
            Remove key
          </button>
        )}
        {status && (
          <span
            className={`${isError ? 'warn' : 'muted'} small`}
            role={isError ? 'alert' : undefined}
          >
            {status}
          </span>
        )}
      </div>
    </section>
  );
}

function PriceTable({
  prices,
  onSaved,
}: {
  prices: Record<string, ModelPrice>;
  onSaved: (s: Awaited<ReturnType<typeof api.settings>>) => void;
}) {
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const trimmedModel = model.trim();
    const trimmedIn = input.trim();
    const trimmedOut = output.trim();
    const i = trimmedIn === '' ? Number.NaN : Number(trimmedIn);
    const o = trimmedOut === '' ? Number.NaN : Number(trimmedOut);
    if (!trimmedModel || !Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) {
      setError('Enter a model id and non-negative input and output prices.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updatePrices({ [trimmedModel]: { input: i, output: o } }));
      setModel('');
      setInput('');
      setOutput('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPrice = async (m: string) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updatePrices({ [m]: null }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="provider-card">
      <strong>Prices (USD per million tokens)</strong>
      <p className="muted small">
        Used for the spending meter and cap. Models not listed are costed at a pessimistic $3 / $15
        so they can’t slip past your cap — add your models here for accurate numbers.
      </p>
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}
      <table className="price-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Input</th>
            <th>Output</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Object.entries(prices).map(([m, p]) => (
            <tr key={m}>
              <td>
                <code>{m}</code>
              </td>
              <td>${p.input}</td>
              <td>${p.output}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  disabled={busy}
                  aria-label={`Reset price for ${m}`}
                  onClick={() => void resetPrice(m)}
                >
                  Reset
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td>
              <input
                aria-label="Model id"
                value={model}
                disabled={busy}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
              />
            </td>
            <td>
              <input
                aria-label="Input price per million tokens"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                placeholder="0.15"
                inputMode="decimal"
              />
            </td>
            <td>
              <input
                aria-label="Output price per million tokens"
                value={output}
                disabled={busy}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="0.60"
                inputMode="decimal"
              />
            </td>
            <td>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => void add()}
              >
                Add
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
