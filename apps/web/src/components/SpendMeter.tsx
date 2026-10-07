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
  const runner = useWorld((s) => s.runner);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const pct = runner.capUsd > 0 ? Math.min(100, (runner.spentUsd / runner.capUsd) * 100) : 100;

  if (editing) {
    return (
      <form
        className="spend-meter"
        onSubmit={(e) => {
          e.preventDefault();
          const cap = Number(value);
          if (Number.isFinite(cap) && cap >= 0)
            void api.setCap(worldId, cap).then(() => setEditing(false));
        }}
      >
        <span className="muted small">Cap $</span>
        <input
          className="cap-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
        />
        <button className="btn btn-small btn-primary" type="submit">
          Set
        </button>
        <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }
  const planned = runner.planUsd > 0;
  return (
    <button
      className={`spend-meter linkish ${runner.capReached ? 'is-capped' : ''}`}
      title={
        planned
          ? `AI spending in this world vs its cap, including ${formatUsd(runner.planUsd)} of Claude plan use priced at API rates (your plan covers it, so it isn’t billed). Click to change the cap.`
          : 'AI spending in this world vs its cap. Click to change the cap.'
      }
      onClick={() => {
        setValue(String(runner.capUsd));
        setEditing(true);
      }}
    >
      <span className="spend-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="small">
        {formatUsd(runner.spentUsd)} / {formatUsd(runner.capUsd)}
      </span>
    </button>
  );
}
