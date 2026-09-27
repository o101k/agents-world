import { useState, type FormEvent } from 'react';
import {
  MAP_SIZES,
  formatClock,
  type CastOption,
  type MapSize,
  type PersonInput,
  type WorldMeta,
} from '@aw/shared';
import { CastEditor, STARTER_CAST } from '../components/CastEditor.tsx';
import { api } from '../api.ts';
import { formatDate } from '../format.ts';
import { useSettings } from '../settingsStore.ts';
import { useApp } from '../store.ts';

const SIZE_LABELS: Record<MapSize, string> = {
  small: `Small (${MAP_SIZES.small}×${MAP_SIZES.small})`,
  medium: `Medium (${MAP_SIZES.medium}×${MAP_SIZES.medium})`,
  large: `Large (${MAP_SIZES.large}×${MAP_SIZES.large})`,
};

export function WorldsScreen() {
  const { worlds, activeWorldId, setShowWorldsScreen } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorldMeta | null>(null);

  const openWorld = async (id: string) => {
    setError(null);
    try {
      await api.activateWorld(id);
      setShowWorldsScreen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteWorld = async (world: WorldMeta) => {
    setError(null);
    try {
      await api.deleteWorld(world.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div className="worlds-screen">
      <header className="worlds-header">
        <div className="row-between">
          <h1>Agents World</h1>
          <button className="btn" onClick={() => useSettings.getState().setOpen(true)}>
            ⚙ AI settings
          </button>
        </div>
        <p className="muted">
          Each world is a separate village, saved on this computer. Only the open world runs; it
          keeps living while the helper is running, even with this tab closed.
        </p>
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="worlds-layout">
        <CreateWorldForm onCreated={(id) => void openWorld(id)} onError={setError} />

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
                    <button className="btn btn-primary" onClick={() => void openWorld(w.id)}>
                      Open
                    </button>
                    <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(w)}>
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
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div
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
              <button className="btn" autoFocus onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void deleteWorld(confirmDelete)}>
                Delete world
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CastMode = 'sample' | 'custom' | 'generated';

function CreateWorldForm({
  onCreated,
  onError,
}: {
  onCreated: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [mapSize, setMapSize] = useState<MapSize>('medium');
  const [mode, setMode] = useState<CastMode>('sample');
  const [people, setPeople] = useState<PersonInput[]>(STARTER_CAST);
  const [adults, setAdults] = useState(10);
  const [children, setChildren] = useState(5);
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const cast: CastOption =
        mode === 'custom'
          ? { mode, people: people.filter((p) => p.name.trim()) }
          : mode === 'generated'
            ? { mode, adults, children, useAi }
            : { mode: 'sample' };
      const { world } = await api.createWorld({ name, seed: seed || undefined, mapSize, cast });
      setName('');
      setSeed('');
      onCreated(world.id);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
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
              value={adults}
              inputMode="numeric"
              onChange={(e) => setAdults(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Children
            <input
              value={children}
              inputMode="numeric"
              onChange={(e) => setChildren(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />{' '}
            Flesh out with AI
          </label>
        </div>
      )}
      {mode === 'custom' && <CastEditor people={people} onChange={setPeople} />}
      <p className="muted small">
        Everyone starts on the free Mock brain; give them AI brains in the world’s World tab.
      </p>
      <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create world'}
      </button>
    </form>
  );
}
