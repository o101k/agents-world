import { useEffect, useState, type ReactNode } from 'react';
import type { BrainConfig, EffortLevel, ProviderId } from '@aw/shared';
import { api } from '../api.ts';
import { useSettings } from '../settingsStore.ts';

const EFFORT_HELP: Record<EffortLevel, string> = {
  frugal: 'Cheapest: short prompts, routine needs handled by instinct, check-ins every 8 h.',
  standard: 'More memories in each prompt, AI handles everything, check-ins every 4 h.',
  deep: 'Most memories and deeper thinking, check-ins every 3 h. Costs the most.',
};

/** Pick provider, model and effort for a person (or the world default). Remount with a new key to reset. */
export function BrainEditor({
  value,
  onSave,
  saveLabel = 'Save',
  extra,
}: {
  value: BrainConfig;
  onSave: (b: BrainConfig) => Promise<void>;
  saveLabel?: string;
  extra?: ReactNode;
}) {
  const { settings, load, setOpen } = useSettings();
  const [brain, setBrain] = useState(value);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const key = JSON.stringify(value);

  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  useEffect(() => {
    if (brain.provider === 'mock') return;
    let cancelled = false;
    api
      .providerModels(brain.provider)
      .then((r) => !cancelled && setModels(r.models))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [brain.provider]);

  const providers = settings?.providers ?? [];
  const configured = (id: ProviderId) =>
    id === 'mock' || providers.some((p) => p.id === id && p.configured);
  const current = providers.find((p) => p.id === brain.provider);
  const dirty = JSON.stringify(brain) !== key;

  return (
    <div className="brain-editor">
      <label>
        Provider
        <select
          value={brain.provider}
          onChange={(e) =>
            setBrain({ ...brain, provider: e.target.value as ProviderId, model: '' })
          }
        >
          <option value="mock">Mock — free rulebook, no AI</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.configured ? '' : ' — not set up'}
            </option>
          ))}
        </select>
      </label>
      {brain.provider !== 'mock' && (
        <>
          {!configured(brain.provider) && (
            <p className="warn small">
              This provider has no key yet, so the free mock brain will stand in.{' '}
              <button className="linkish" onClick={() => setOpen(true)}>
                Open settings
              </button>
            </p>
          )}
          <label>
            Model
            <input
              list={`models-${brain.provider}`}
              value={brain.model}
              placeholder={current?.defaultModel ? `default: ${current.defaultModel}` : 'model id'}
              onChange={(e) => setBrain({ ...brain, model: e.target.value })}
            />
            <datalist id={`models-${brain.provider}`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            Effort
            <select
              value={brain.effort}
              onChange={(e) => setBrain({ ...brain, effort: e.target.value as EffortLevel })}
            >
              <option value="frugal">Frugal</option>
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <p className="muted small">{EFFORT_HELP[brain.effort]}</p>
        </>
      )}
      {extra}
      <div className="row">
        <button
          className="btn btn-primary btn-small"
          disabled={!dirty && !extra}
          onClick={() =>
            void onSave(brain)
              .then(() => setStatus('Saved.'))
              .catch((e: Error) => setStatus(e.message))
          }
        >
          {saveLabel}
        </button>
        {status && <span className="muted small">{status}</span>}
      </div>
    </div>
  );
}
