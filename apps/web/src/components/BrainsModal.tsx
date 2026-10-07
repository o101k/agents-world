import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BrainConfig, BrainUsage, LifeStage } from '@aw/shared';
import { describeBrain, formatCount } from '../brainLabels.ts';
import { useSettings } from '../settingsStore.ts';
import { BrainFields } from './BrainEditor.tsx';
import { formatUsd } from './SpendMeter.tsx';

/** One person in the dialog. */
export interface BrainsModalRow {
  id: string;
  name: string;
  /** Small print under the name, e.g. "Adult, 34 · Baker". */
  detail: string;
  stage: LifeStage;
  alive: boolean;
  brain: BrainConfig;
  /** What their AI has used so far (shown when `showUsage`). */
  usage?: BrainUsage;
}

const YOUNG: LifeStage[] = ['infant', 'toddler', 'child', 'teen'];
const NO_USAGE: BrainUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, planUsd: 0 };

/** Tooltip for a cost that includes Claude plan use priced at API rates. */
const planTitle = (planUsd: number) =>
  `Includes ${formatUsd(planUsd)} of Claude plan use at API prices (not billed)`;

const plural = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Who thinks with which AI. The one dialog used both when setting up a new world (nothing has
 * run yet, so no usage) and inside a running world (with what each person has spent). It holds
 * only the selection and the pickers; the caller decides what applying a change means.
 */
export function BrainsModal({
  title,
  intro,
  notice,
  people,
  defaultBrain,
  showUsage,
  totals,
  loading,
  loadError,
  onApply,
  onApplyDefault,
  primaryLabel,
  primaryBusyLabel = 'Working…',
  onPrimary,
  closeLabel,
  onClose,
}: {
  title: string;
  intro?: ReactNode;
  /** A warning line under the intro (e.g. no AI is set up yet). */
  notice?: ReactNode;
  people: BrainsModalRow[];
  defaultBrain: BrainConfig;
  showUsage: boolean;
  /** Whole-village usage, including the dead and calls not tied to anyone. */
  totals?: BrainUsage;
  loading?: boolean;
  loadError?: string | null;
  onApply: (ids: string[], brain: BrainConfig) => Promise<void>;
  onApplyDefault: (brain: BrainConfig) => Promise<void>;
  primaryLabel: string;
  primaryBusyLabel?: string;
  onPrimary: () => Promise<void> | void;
  /** A second button that closes the dialog (e.g. "Back"); the ✕ and Escape always close it. */
  closeLabel?: string;
  onClose: () => void;
}) {
  const providers = useSettings((s) => s.settings?.providers);
  const idPrefix = useId();
  const bulkRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDead, setShowDead] = useState(false);
  const [bulk, setBulk] = useState(defaultBrain);
  const [busy, setBusy] = useState<'apply' | 'default' | 'primary' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingDefault, setEditingDefault] = useState<BrainConfig | null>(null);

  // Escape closes, unless the settings dialog is open on top of this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useSettings.getState().open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dead = people.filter((p) => !p.alive).length;
  const visible = showUsage && !showDead ? people.filter((p) => p.alive) : people;
  // Only what is on screen can be selected, so a hidden row is never changed by accident.
  const selectedIds = visible.filter((p) => selected.has(p.id)).map((p) => p.id);
  const allOn = visible.length > 0 && selectedIds.length === visible.length;

  const select = (test: (p: BrainsModalRow) => boolean) =>
    setSelected(new Set(visible.filter(test).map((p) => p.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (what: 'apply' | 'default' | 'primary', fn: () => Promise<void> | void) => {
    setBusy(what);
    setStatus(null);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const apply = () =>
    void run('apply', async () => {
      await onApply(selectedIds, bulk);
      setStatus(`Updated ${plural(selectedIds.length)}.`);
    });

  const changeOne = (row: BrainsModalRow) => {
    setSelected(new Set([row.id]));
    setBulk(row.brain);
    setStatus(null);
    setError(null);
    bulkRef.current?.querySelector('select')?.focus();
  };

  const saveDefault = (brain: BrainConfig) =>
    void run('default', async () => {
      await onApplyDefault(brain);
      setEditingDefault(null);
      setStatus('Default saved.');
    });

  const defaultSummary = describeBrain(defaultBrain, providers);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal panel brains-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brains-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="brains-title">{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {intro && <p className="muted small">{intro}</p>}
        {notice && <p className="warn small">{notice}</p>}

        <div className="brains-toolbar">
          <span className="muted small">Select</span>
          <button className="btn btn-small" onClick={() => select(() => true)}>
            All
          </button>
          <button className="btn btn-small" onClick={() => setSelected(new Set())}>
            None
          </button>
          <button className="btn btn-small" onClick={() => select((p) => !YOUNG.includes(p.stage))}>
            Adults
          </button>
          <button className="btn btn-small" onClick={() => select((p) => YOUNG.includes(p.stage))}>
            Children
          </button>
          <span className="brains-count muted small">
            {selectedIds.length} of {visible.length} selected
          </span>
          {showUsage && dead > 0 && (
            <label className="check">
              <input
                type="checkbox"
                checked={showDead}
                onChange={(e) => setShowDead(e.target.checked)}
              />{' '}
              Show the dead ({dead})
            </label>
          )}
        </div>

        <div className="brains-scroll">
          {loading || loadError ? (
            <p className={`small brains-empty ${loadError ? 'warn' : 'muted'}`}>
              {loadError ?? 'Loading…'}
            </p>
          ) : (
            <table className="brains-table" data-testid="brains-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allOn}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.length > 0 && !allOn;
                      }}
                      onChange={() => select(() => !allOn)}
                    />
                  </th>
                  <th>Villager</th>
                  <th>Brain</th>
                  {showUsage && (
                    <>
                      <th className="num">Calls</th>
                      <th className="num">Tokens in</th>
                      <th className="num">Tokens out</th>
                      <th className="num">Cost</th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const brain = describeBrain(p.brain, providers);
                  const usage = p.usage ?? NO_USAGE;
                  const checkId = `${idPrefix}-${p.id}`;
                  return (
                    <tr
                      key={p.id}
                      className={`${selected.has(p.id) ? 'is-selected' : ''} ${p.alive ? '' : 'is-dead'}`}
                    >
                      <td className="col-check">
                        <input
                          id={checkId}
                          type="checkbox"
                          aria-label={`Select ${p.name}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
                      <td>
                        <label htmlFor={checkId} className="brains-name">
                          <span>{p.name}</span>
                          <span className="muted small">{p.detail}</span>
                        </label>
                      </td>
                      <td>
                        <div>{brain.title}</div>
                        <div className="muted small">
                          {brain.detail}
                          {brain.notSetUp && (
                            <span
                              className="warn"
                              title="No key or sign-in yet, so the free mock brain stands in."
                            >
                              {' '}
                              · not set up
                            </span>
                          )}
                        </div>
                      </td>
                      {showUsage && (
                        <>
                          <td className="num">{formatCount(usage.calls)}</td>
                          <td className="num">{formatCount(usage.inputTokens)}</td>
                          <td className="num">{formatCount(usage.outputTokens)}</td>
                          <td
                            className="num"
                            title={usage.planUsd > 0 ? planTitle(usage.planUsd) : undefined}
                          >
                            {formatUsd(usage.costUsd)}
                          </td>
                        </>
                      )}
                      <td className="col-action">
                        <button
                          className="btn btn-small"
                          aria-label={`Change the brain of ${p.name}`}
                          onClick={() => changeOne(p)}
                        >
                          Change
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {showUsage && totals && (
                <tfoot>
                  <tr data-testid="brains-totals">
                    <td />
                    <td colSpan={2}>
                      <strong>Whole village</strong>
                    </td>
                    <td className="num">{formatCount(totals.calls)}</td>
                    <td className="num">{formatCount(totals.inputTokens)}</td>
                    <td className="num">{formatCount(totals.outputTokens)}</td>
                    <td
                      className="num"
                      title={totals.planUsd > 0 ? planTitle(totals.planUsd) : undefined}
                    >
                      {formatUsd(totals.costUsd)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
        {showUsage && totals && totals.planUsd > 0 && (
          <p className="muted small brains-footnote" data-testid="brains-plan-note">
            Costs include {formatUsd(totals.planUsd)} of Claude plan use, priced at API rates by
            Claude Code. Your plan covers it, so it doesn’t count toward the spending cap.
          </p>
        )}
        {showUsage && !showDead && dead > 0 && (
          <p className="muted small brains-footnote">
            {plural(dead)} who died {dead === 1 ? 'is' : 'are'} hidden; what they spent is still in
            the village total.
          </p>
        )}

        <section className="brains-bulk" aria-label="Change brains" ref={bulkRef}>
          <div className="brains-bulk-head">
            <strong>
              {selectedIds.length === 0
                ? 'Pick people above, then choose their brain'
                : `Brain for ${plural(selectedIds.length)}`}
            </strong>
            {status && (
              <span className="muted small" role="status">
                {status}
              </span>
            )}
          </div>
          <div className="brains-bulk-body">
            <BrainFields value={bulk} onChange={setBulk} />
            <button
              className="btn btn-primary btn-small brains-apply"
              disabled={selectedIds.length === 0 || busy !== null}
              onClick={apply}
            >
              {selectedIds.length === 0
                ? 'Apply to selected'
                : `Apply to ${selectedIds.length} selected`}
            </button>
          </div>
        </section>

        <section className="brains-default" aria-label="Default brain">
          <div className="row-between">
            <div>
              <strong>Default for newborns and spawned people</strong>
              <div className="muted small">
                {defaultSummary.title} · {defaultSummary.detail}
              </div>
            </div>
            {!editingDefault && (
              <button
                className="btn btn-small"
                onClick={() => setEditingDefault({ ...defaultBrain })}
              >
                Change default
              </button>
            )}
          </div>
          {editingDefault && (
            <div className="brains-default-edit">
              <BrainFields value={editingDefault} onChange={setEditingDefault} />
              <div className="row">
                <button
                  className="btn btn-primary btn-small"
                  disabled={busy !== null}
                  onClick={() => saveDefault(editingDefault)}
                >
                  Save default
                </button>
                <button className="btn btn-small" onClick={() => setEditingDefault(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {closeLabel && (
            <button className="btn" onClick={onClose}>
              {closeLabel}
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={busy !== null || loading}
            onClick={() => void run('primary', onPrimary)}
          >
            {busy === 'primary' ? primaryBusyLabel : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
