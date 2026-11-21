import { useRef, useState, type FormEvent } from 'react';
import type { Sex } from '@aw/shared';
import { api } from '../api.ts';
import { useDialog } from './useDialog.ts';

/** Observer power: bring a new person into the world from a description. */
export function SpawnDialog({
  worldId,
  onClose,
  onSpawned,
}: {
  worldId: string;
  onClose: () => void;
  onSpawned: (id: string, note?: string) => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'' | Sex>('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialog(dialogRef, onClose, { disabled: busy });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    let parsedAge: number | undefined;
    if (age.trim()) {
      parsedAge = Number(age.trim());
      if (!Number.isInteger(parsedAge) || parsedAge < 16 || parsedAge > 90) {
        setError('Age must be between 16 and 90 (or leave it blank).');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.spawn(worldId, {
        description,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(sex ? { sex } : {}),
        ...(parsedAge !== undefined ? { age: parsedAge } : {}),
      });
      onSpawned(res.agentId, res.note);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spawn-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="spawn-title">Bring someone new into the world</h2>
        <p className="muted small">
          Describe them in your own words. The world’s default AI fleshes out the rest (without an
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
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
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
        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
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
