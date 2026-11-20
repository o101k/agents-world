import { useState } from 'react';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

export function formatUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** AI spending so far vs the world's cap, with an inline editor for the cap. */
export function SpendMeter({ worldId }: { worldId: string }) {
  const spentUsd = useWorld((s) => s.runner.spentUsd);
  const capUsd = useWorld((s) => s.runner.capUsd);
  const planUsd = useWorld((s) => s.runner.planUsd);
  const capReached = useWorld((s) => s.runner.capReached);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pct = capUsd > 0 ? Math.min(100, (spentUsd / capUsd) * 100) : 100;

  if (editing) {
    return (
      <form
        className="spend-meter"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          const cap = trimmed === '' ? Number.NaN : Number(trimmed);
          if (!Number.isFinite(cap) || cap < 0 || cap > 10_000) {
            setError('Enter 0–10000');
            return;
          }
          setBusy(true);
          setError(null);
          api
            .setCap(worldId, cap)
            .then(() => setEditing(false))
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <span className="muted small">Cap $</span>
        <input
          className="cap-input"
          aria-label="Spending cap in USD"
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
              setError(null);
            }
          }}
          inputMode="decimal"
        />
        <button className="btn btn-small btn-primary" type="submit" disabled={busy}>
          Set
        </button>
        <button
          className="btn btn-small"
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        {error && (
          <span className="warn small" role="alert">
            {error}
          </span>
        )}
      </form>
    );
  }
  const planned = planUsd > 0;
  return (
    <button
      type="button"
      className={`spend-meter linkish ${capReached ? 'is-capped' : ''}`}
      title={
        planned
          ? `AI spending in this world vs its cap, including ${formatUsd(planUsd)} of Claude plan use priced at API rates (your plan covers it, so it isn’t billed). Click to change the cap.`
          : 'AI spending in this world vs its cap. Click to change the cap.'
      }
      onClick={() => {
        setValue(String(capUsd));
        setError(null);
        setEditing(true);
      }}
    >
      <span
        className="spend-bar"
        role="meter"
        aria-label="AI spending against cap"
        aria-valuemin={0}
        aria-valuemax={capUsd}
        aria-valuenow={spentUsd}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="small">
        {formatUsd(spentUsd)} / {formatUsd(capUsd)}
      </span>
    </button>
  );
}
