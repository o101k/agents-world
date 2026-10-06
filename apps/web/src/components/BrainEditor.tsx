import { useEffect, useId, useState, type ReactNode } from 'react';
import type { BrainConfig, EffortLevel, ProviderId } from '@aw/shared';
import { api } from '../api.ts';
import { PLAN_MODELS } from '../planModels.ts';
import { useSettings } from '../settingsStore.ts';

const EFFORT_HELP: Record<EffortLevel, string> = {
  frugal: 'Cheapest: short prompts, routine needs handled by instinct, check-ins every 8 h.',
  standard: 'More memories in each prompt, AI handles everything, check-ins every 4 h.',
  deep: 'Most memories and deeper thinking, check-ins every 3 h. Costs the most.',
};

const PLAN_EFFORT: Record<EffortLevel, string> = {
  frugal: 'low',
  standard: 'medium',
  deep: 'high',
};

/**
 * Provider, model and effort pickers for one brain, with the "not set up" warning and what the
 * effort level means. Controlled: the parent holds the value (used by the save wrapper below and
 * by the brains dialog).
 */
export function BrainFields({
  value,
  onChange,
}: {
  value: BrainConfig;
  onChange: (b: BrainConfig) => void;
}) {
  const { settings, load, setOpen } = useSettings();
  const [models, setModels] = useState<string[]>([]);
  const listId = useId();

  useEffect(() => {
    if (!settings) void load();
  }, [settings, load]);
  useEffect(() => {
    if (value.provider === 'mock' || value.provider === 'claude_plan') return;
    let cancelled = false;
    api
      .providerModels(value.provider)
      .then((r) => !cancelled && setModels(r.models))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [value.provider]);

  const providers = settings?.providers ?? [];
  const configured = (id: ProviderId) =>
    id === 'mock' || providers.some((p) => p.id === id && p.configured);
  const current = providers.find((p) => p.id === value.provider);

  return (
    <div className="brain-fields">
      <label>
        Provider
        <select
          value={value.provider}
          onChange={(e) =>
            onChange({ ...value, provider: e.target.value as ProviderId, model: '' })
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
      {value.provider !== 'mock' && (
        <>
          {!configured(value.provider) && (
            <p className="warn small brain-note">
              {current?.kind === 'plan'
                ? 'Claude Code isn’t set up yet, so the free mock brain will stand in.'
                : 'This provider has no key yet, so the free mock brain will stand in.'}{' '}
              <button type="button" className="linkish" onClick={() => setOpen(true)}>
                Open settings
              </button>
            </p>
          )}
          {current?.kind === 'plan' ? (
            <label>
              Model
              <select
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
              >
                <option value="">Default ({current.defaultModel})</option>
                {PLAN_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {value.model && !PLAN_MODELS.some((m) => m.id === value.model) && (
                  <option value={value.model}>{value.model}</option>
                )}
              </select>
            </label>
          ) : (
            <label>
              Model
              <input
                list={listId}
                value={value.model}
                placeholder={
                  current?.defaultModel ? `default: ${current.defaultModel}` : 'model id'
                }
                onChange={(e) => onChange({ ...value, model: e.target.value })}
              />
              <datalist id={listId}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
          <label>
            Effort
            <select
              value={value.effort}
              onChange={(e) => onChange({ ...value, effort: e.target.value as EffortLevel })}
            >
              <option value="frugal">Frugal</option>
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <p className="muted small brain-note">
            {EFFORT_HELP[value.effort]}
            {current?.kind === 'plan' &&
              ` Uses your Claude plan’s limits (Claude effort: ${PLAN_EFFORT[value.effort]}).`}
          </p>
        </>
      )}
    </div>
  );
}

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
  const [brain, setBrain] = useState(value);
  const [status, setStatus] = useState<string | null>(null);
  const key = JSON.stringify(value);
  const dirty = JSON.stringify(brain) !== key;

  return (
    <div className="brain-editor">
      <BrainFields value={brain} onChange={setBrain} />
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
