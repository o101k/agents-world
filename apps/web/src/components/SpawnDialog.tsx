import { useState, type FormEvent } from 'react';
import type { Sex } from '@aw/shared';
import { api } from '../api.ts';

/** Observer power: bring a new person into the world from a description. */
export function SpawnDialog({
  worldId,
  onClose,
  onSpawned,
}: {
  worldId: string;
  onClose: () => void;
  onSpawned: (id: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'' | Sex>('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.spawn(worldId, {
        description,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(sex ? { sex } : {}),
        ...(age ? { age: Number(age) } : {}),
      });
      if (res.note) alert(res.note);
      onSpawned(res.agentId);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spawn-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="spawn-title">Bring someone new into the world</h2>
        <p className="muted small">
          Describe them in your own words. The world's default AI fleshes out the rest (without an
          AI, your description becomes their story). They arrive on the road into the village,
          knowing no one.
        </p>
        <label>
          Description
          <textarea
            required
            rows={5}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A widowed blacksmith from the hills, gruff but fair, looking for a fresh start and a new forge."
          />
        </label>
        <div className="provider-grid">
          <label>
            Name <span className="muted">(optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <label>
            Sex <span className="muted">(optional)</span>
            <select value={sex} onChange={(e) => setSex(e.target.value as '' | Sex)}>
              <option value="">Any</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <label>
            Age <span className="muted">(optional)</span>
            <input
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="16–90"
            />
          </label>
        </div>
        {error && <p className="warn small">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !description.trim()}>
            {busy ? 'Creating…' : 'Spawn'}
          </button>
        </div>
      </form>
    </div>
  );
}
