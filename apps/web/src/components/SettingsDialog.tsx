import { useEffect, useState } from 'react';
import type { ModelPrice, ProviderStatus } from '@aw/shared';
import { api } from '../api.ts';
import { PLAN_MODELS } from '../planModels.ts';
import { useSettings } from '../settingsStore.ts';

/** API keys, endpoints and the price table. Keys go to the local helper only and are never shown again. */
export function SettingsDialog() {
  const { settings, open, setOpen, load, set } = useSettings();
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal panel settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button className="btn btn-ghost" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">
          Use your Claude subscription, or API keys. Keys are stored only on this computer (
          {settings?.dataDir}/secrets.json) and are never sent to the browser. Environment variables
          (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_COMPATIBLE_API_KEY) also work.
        </p>
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

/** The Claude subscription: set up by signing in to Claude Code, so there's no key here. */
function PlanCard({
  provider,
  onSaved,
}: {
  provider: ProviderStatus;
  onSaved: (s: Awaited<ReturnType<typeof api.settings>>) => void;
}) {
  const [model, setModel] = useState(provider.defaultModel);
  const [cliPath, setCliPath] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => ReturnType<typeof api.settings>, done: string) => {
    setBusy(true);
    setStatus('Checking Claude Code…');
    try {
      const next = await fn();
      onSaved(next);
      const plan = next.providers.find((p) => p.id === provider.id);
      setStatus(plan?.configured ? done : null);
    } catch (e) {
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
      <details className="plan-howto" open={!provider.configured}>
        <summary>How to use your Claude subscription</summary>
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
            Choose <strong>Claude subscription</strong> as the provider in the World tab (Default
            brain, with “Also switch everyone alive” to move the whole village) or in a person’s
            Brain section, then pick a model and an effort.
          </li>
        </ol>
        <ul className="muted small">
          <li>
            Villagers use your plan’s 5-hour and weekly limits, the same allowance as your own
            Claude chats and Claude Code. It costs no extra money, and the spending cap doesn’t
            apply.
          </li>
          <li>When the limit runs out, time pauses and resumes by itself when the limit resets.</li>
          <li>
            Effort: Frugal, Standard and Deep set how much each villager thinks (and Claude’s effort
            low, medium or high). Haiku with Frugal makes the limits last longest.
          </li>
          <li>
            Agents World never sees your Claude login: it only runs the <code>claude</code> command,
            which Anthropic allows for your own projects. API keys below remain a separate option.
          </li>
        </ul>
      </details>
      <div className="provider-grid">
        <label>
          Default model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {PLAN_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!PLAN_MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>
        <label>
          Claude Code location (optional)
          <input
            value={cliPath}
            onChange={(e) => setCliPath(e.target.value)}
            placeholder={provider.cliPath ?? 'Found automatically, e.g. ~/.local/bin/claude'}
          />
        </label>
      </div>
      <div className="provider-actions">
        <button
          className="btn btn-primary btn-small"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                api.updateProvider(provider.id, {
                  defaultModel: model,
                  ...(cliPath.trim() ? { cliPath: cliPath.trim() } : {}),
                }),
              'Saved.',
            )
          }
        >
          Save
        </button>
        <button
          className="btn btn-small"
          disabled={busy}
          onClick={() => void act(api.checkClaudePlan, 'Ready.')}
        >
          Check
        </button>
        {status && <span className="muted small">{status}</span>}
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
  const [busy, setBusy] = useState(false);

  const save = async (update: Parameters<typeof api.updateProvider>[1]) => {
    setBusy(true);
    setStatus(null);
    try {
      onSaved(await api.updateProvider(provider.id, update));
      setKey('');
      setStatus('Saved.');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setStatus('Testing…');
    try {
      const { models } = await api.providerModels(provider.id);
      setStatus(`Connected — ${models.length} models available.`);
    } catch (e) {
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
          className="btn btn-small"
          disabled={busy || !provider.configured}
          onClick={() => void test()}
        >
          Test connection
        </button>
        {provider.keySource === 'settings' && (
          <button
            className="btn btn-small btn-danger-ghost"
            disabled={busy}
            onClick={() => void save({ apiKey: '' })}
          >
            Remove key
          </button>
        )}
        {status && <span className="muted small">{status}</span>}
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
  const add = async () => {
    const i = Number(input);
    const o = Number(output);
    if (!model.trim() || !Number.isFinite(i) || !Number.isFinite(o)) return;
    onSaved(await api.updatePrices({ [model.trim()]: { input: i, output: o } }));
    setModel('');
    setInput('');
    setOutput('');
  };
  return (
    <section className="provider-card">
      <strong>Prices (USD per million tokens)</strong>
      <p className="muted small">
        Used for the spending meter and cap. Models not listed are costed at a pessimistic $3 / $15
        so they can't slip past your cap — add your models here for accurate numbers.
      </p>
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
                  className="btn btn-small btn-danger-ghost"
                  onClick={() => void api.updatePrices({ [m]: null }).then(onSaved)}
                >
                  Reset
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
              />
            </td>
            <td>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="0.15"
                inputMode="decimal"
              />
            </td>
            <td>
              <input
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="0.60"
                inputMode="decimal"
              />
            </td>
            <td>
              <button className="btn btn-small" onClick={() => void add()}>
                Add
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
