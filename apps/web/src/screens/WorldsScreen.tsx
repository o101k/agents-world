import { useRef, useState, type FormEvent } from 'react';
import {
  MAP_SIZES,
  STAGE_LABELS,
  formatClock,
  stageOf,
  type BrainConfig,
  type CastOption,
  type CastPreviewPerson,
  type MapSize,
  type PersonInput,
  type WorldMeta,
} from '@aw/shared';
import { BrainsModal, type BrainsModalRow } from '../components/BrainsModal.tsx';
import { CastEditor, STARTER_CAST } from '../components/CastEditor.tsx';
import { useDialog } from '../components/useDialog.ts';
import { api } from '../api.ts';
import { defaultBrainFor } from '../brainLabels.ts';
import { formatDate } from '../format.ts';
import { useSettings } from '../settingsStore.ts';
import { useApp } from '../store.ts';

const SIZE_LABELS: Record<MapSize, string> = {
  small: `Small (${MAP_SIZES.small}×${MAP_SIZES.small})`,
  medium: `Medium (${MAP_SIZES.medium}×${MAP_SIZES.medium})`,
  large: `Large (${MAP_SIZES.large}×${MAP_SIZES.large})`,
  huge: `Huge (${MAP_SIZES.huge}×${MAP_SIZES.huge}) — for 100+ people`,
};

export function WorldsScreen() {
  const worlds = useApp((s) => s.worlds);
  const activeWorldId = useApp((s) => s.activeWorldId);
  const setShowWorldsScreen = useApp((s) => s.setShowWorldsScreen);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorldMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDialogRef = useRef<HTMLDivElement>(null);

  useDialog(deleteDialogRef, () => setConfirmDelete(null), {
    open: confirmDelete !== null,
    disabled: deleting,
  });

  const openWorld = async (id: string) => {
    setError(null);
    try {
      await api.activateWorld(id);
      setShowWorldsScreen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteWorld = async (world: WorldMeta) => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteWorld(world.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="worlds-screen">
      <header className="worlds-header">
        <div className="row-between">
          <div>
            <h1>Agents World</h1>
            <p className="muted worlds-subtitle">
              Each world is a separate village, saved on this computer. Only the open world runs; it
              keeps living while the helper is running, even with this tab closed.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => useSettings.getState().setOpen(true)}
          >
            ⚙ AI settings
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      <div className="worlds-layout">
        <CreateWorldForm
          onCreated={(id) => void openWorld(id)}
          onError={setError}
          onClearError={() => setError(null)}
        />

        <section className="panel worlds-list" aria-label="Saved worlds">
          <h2>Your worlds</h2>
          {worlds.length === 0 ? (
            <p className="muted">No worlds yet. Create your first one.</p>
          ) : (
            <ul>
              {worlds.map((w) => (
                <li
                  key={w.id}
                  className={`world-card ${w.id === activeWorldId ? 'is-active' : ''}`}
                >
                  <div className="world-card-main">
                    <div className="world-card-title">
                      {w.name}
                      {w.id === activeWorldId && (
                        <span className="tag">{w.running ? 'Running' : 'Active'}</span>
                      )}
                    </div>
                    <div className="world-card-meta">
                      {formatClock(w.tick)} · {w.mapWidth}×{w.mapHeight} tiles · seed{' '}
                      <code>{w.seed}</code>
                    </div>
                    <div className="world-card-meta muted">Created {formatDate(w.createdAt)}</div>
                  </div>
                  <div className="world-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      aria-label={`Open ${w.name}`}
                      onClick={() => void openWorld(w.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      aria-label={`Delete ${w.name}`}
                      onClick={() => setConfirmDelete(w)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirmDelete(null)}>
          <div
            ref={deleteDialogRef}
            tabIndex={-1}
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-title">Delete “{confirmDelete.name}”?</h2>
            <p>
              This permanently deletes the world and its entire history from this computer. It can’t
              be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                autoFocus
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={() => void deleteWorld(confirmDelete)}
              >
                {deleting ? 'Deleting…' : 'Delete world'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CastMode = 'sample' | 'custom' | 'generated';

/** The starting villagers as previewed, with the brain picked for each so far. */
interface BrainsDraft {
  /** The seed and cast this was previewed from; a different form means a new preview. */
  key: string;
  seed: string;
  cast: CastOption;
  people: CastPreviewPerson[];
  /** In cast order. */
  brains: BrainConfig[];
  defaultBrain: BrainConfig;
}

function previewRow(p: CastPreviewPerson, brain: BrainConfig): BrainsModalRow {
  const stage = stageOf(p.age);
  const trade =
    p.occupation.toLowerCase() === STAGE_LABELS[stage].toLowerCase() ? '' : p.occupation;
  return {
    id: String(p.index),
    name: [p.name, p.familyName].filter(Boolean).join(' '),
    detail: `${STAGE_LABELS[stage]}, ${p.age}${trade ? ` · ${trade}` : ''}`,
    stage,
    alive: true,
    brain,
  };
}

/** Providers for the starting brain, loading them first if the page hasn't yet. */
async function loadProviders() {
  try {
    if (!useSettings.getState().settings) await useSettings.getState().load();
  } catch {
    // No settings means no AI to offer: everyone starts on the free mock.
  }
  return useSettings.getState().settings?.providers;
}

function CreateWorldForm({
  onCreated,
  onError,
  onClearError,
}: {
  onCreated: (id: string) => void;
  onError: (e: string) => void;
  onClearError: () => void;
}) {
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [mapSize, setMapSize] = useState<MapSize>('medium');
  const [mode, setMode] = useState<CastMode>('sample');
  const [people, setPeople] = useState<PersonInput[]>(STARTER_CAST);
  const [adults, setAdults] = useState(10);
  const [adultsDraft, setAdultsDraft] = useState<string | null>(null);
  const [children, setChildren] = useState(5);
  const [childrenDraft, setChildrenDraft] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<BrainsDraft | null>(null);
  const [choosing, setChoosing] = useState(false);
  const providers = useSettings((s) => s.settings?.providers);

  const customHasPeople = mode !== 'custom' || people.some((p) => p.name.trim());

  // Step 1: work out who the villagers will be, then let the owner pick their brains.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !customHasPeople) return;
    onClearError();
    setBusy(true);
    try {
      const cast: CastOption =
        mode === 'custom'
          ? { mode, people: people.filter((p) => p.name.trim()) }
          : mode === 'generated'
            ? { mode, adults, children, useAi }
            : { mode: 'sample' };
      const key = JSON.stringify({ seed: seed.trim(), cast });
      // Coming back from the brains step to the same form keeps the choices already made.
      if (draft?.key !== key) {
        const start = defaultBrainFor(await loadProviders());
        const preview = await api.castPreview({ seed: seed.trim() || undefined, cast });
        setDraft({
          key,
          seed: preview.seed,
          cast,
          people: preview.people,
          brains: preview.people.map(() => ({ ...start })),
          defaultBrain: start,
        });
      }
      setChoosing(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Step 2: create the world with the villagers and brains that were previewed.
  const create = async (d: BrainsDraft) => {
    const { world } = await api.createWorld({
      name: name.trim(),
      seed: d.seed,
      mapSize,
      cast: d.cast,
      brains: d.brains,
      defaultBrain: d.defaultBrain,
    });
    setChoosing(false);
    setDraft(null);
    setName('');
    setSeed('');
    onCreated(world.id);
  };

  return (
    <>
      <form
        className={`panel create-form ${mode === 'custom' ? 'is-wide' : ''}`}
        onSubmit={(e) => void submit(e)}
      >
        <h2>New world</h2>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Millbrook"
            maxLength={60}
            required
          />
        </label>
        <label>
          Seed <span className="muted">(optional — same seed, same map)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="random"
            maxLength={64}
          />
        </label>
        <label>
          Map size
          <select value={mapSize} onChange={(e) => setMapSize(e.target.value as MapSize)}>
            {(Object.keys(SIZE_LABELS) as MapSize[]).map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="cast-mode">
          <legend>Starting villagers</legend>
          <label className="check">
            <input
              type="radio"
              name="cast"
              checked={mode === 'sample'}
              onChange={() => setMode('sample')}
            />{' '}
            Sample cast (11 people, five households)
          </label>
          <label className="check">
            <input
              type="radio"
              name="cast"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />{' '}
            Write your own
          </label>
          <label className="check">
            <input
              type="radio"
              name="cast"
              checked={mode === 'generated'}
              onChange={() => setMode('generated')}
            />{' '}
            Generate from the seed
          </label>
        </fieldset>
        {mode === 'generated' && (
          <div className="cast-row">
            <label>
              Adults
              <input
                value={adultsDraft ?? String(adults)}
                inputMode="numeric"
                onChange={(e) => {
                  const raw = e.target.value;
                  setAdultsDraft(raw);
                  const n = Number.parseInt(raw, 10);
                  if (raw.trim() !== '' && Number.isFinite(n)) {
                    setAdults(Math.max(1, Math.min(150, n)));
                  }
                }}
                onBlur={() => setAdultsDraft(null)}
              />
            </label>
            <label>
              Children
              <input
                value={childrenDraft ?? String(children)}
                inputMode="numeric"
                onChange={(e) => {
                  const raw = e.target.value;
                  setChildrenDraft(raw);
                  const n = Number.parseInt(raw, 10);
                  if (raw.trim() !== '' && Number.isFinite(n)) {
                    setChildren(Math.max(0, Math.min(100, n)));
                  }
                }}
                onBlur={() => setChildrenDraft(null)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />{' '}
              Flesh out with AI
            </label>
          </div>
        )}
        {mode === 'custom' && <CastEditor people={people} onChange={setPeople} />}
        {!customHasPeople && (
          <p className="warn small">Add at least one person with a first name to continue.</p>
        )}
        <p className="muted small">
          Next you’ll choose which AI each villager thinks with (or the free Mock brain). You can
          change it any time from the world’s 🧠 Brains button.
        </p>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || !name.trim() || !customHasPeople}
        >
          {busy ? 'Loading…' : 'Next: choose brains'}
        </button>
      </form>
      {choosing && draft && (
        <BrainsModal
          title="Choose their brains"
          intro="Pick the AI each starting villager thinks with, one by one or many at once. Real AIs spend money against this world’s cap; the Mock brain is free."
          notice={
            defaultBrainFor(providers).provider === 'mock' && providers ? (
              <>
                No AI is set up yet, so everyone starts on the free Mock brain.{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => useSettings.getState().setOpen(true)}
                >
                  Open settings
                </button>
              </>
            ) : undefined
          }
          people={draft.people.map((p, i) => previewRow(p, draft.brains[i]!))}
          defaultBrain={draft.defaultBrain}
          showUsage={false}
          onApply={async (ids, brain) => {
            const chosen = new Set(ids);
            setDraft({
              ...draft,
              brains: draft.brains.map((b, i) =>
                chosen.has(String(draft.people[i]!.index)) ? { ...brain } : b,
              ),
            });
          }}
          onApplyDefault={async (brain) => setDraft({ ...draft, defaultBrain: { ...brain } })}
          primaryLabel="Create world"
          primaryBusyLabel="Creating…"
          onPrimary={() => create(draft)}
          closeLabel="Back"
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  );
}
