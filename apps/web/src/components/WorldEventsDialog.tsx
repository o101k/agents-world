import { useState, type FormEvent } from 'react';
import { OBJECT_LABELS, type ActiveCondition, type WorldMap } from '@aw/shared';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

type Kind = ActiveCondition['kind'];

export const CONDITION_INFO: Record<Kind, { icon: string; label: string; blurb: string }> = {
  drought: {
    icon: '☀',
    label: 'Drought',
    blurb:
      'No rain. Crops and berries barely regrow and people thirst faster in the heat; when severe, the river dries up and only the well has water.',
  },
  storm: {
    icon: '⛈',
    label: 'Storm',
    blurb:
      'Wind and cold rain. Anyone outside gets chilled and tired, sight is short, and fishing is impossible. Homes give shelter.',
  },
  disease: {
    icon: '🤒',
    label: 'Sickness',
    blurb:
      'A few people fall ill; it spreads to those who stay close (households especially). The sick weaken; rest and nursing help. The young and old suffer most.',
  },
  fire: {
    icon: '🔥',
    label: 'Fire',
    blurb:
      'A building catches fire and burns down within the hour; people inside flee. It may spread to neighbours (not in a storm). Owners can rebuild it.',
  },
  bumper_harvest: {
    icon: '🌾',
    label: 'Bumper harvest',
    blurb: 'Every field and bush is full at once, and everything regrows twice as fast.',
  },
};

const KINDS: Kind[] = ['storm', 'drought', 'disease', 'fire', 'bumper_harvest'];

/** Observer power: trigger a world event. Nobody is commanded; people react as they will. */
export function WorldEventsDialog({
  worldId,
  map,
  onClose,
}: {
  worldId: string;
  map: WorldMap | null;
  onClose: () => void;
}) {
  const agents = useWorld((s) => s.agents);
  const [kind, setKind] = useState<Kind>('storm');
  const [intensity, setIntensity] = useState(0.6);
  const [hours, setHours] = useState(12);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildings = (map?.objects ?? []).filter(
    (o) =>
      ['house', 'bakery', 'workshop'].includes(o.kind) &&
      (o.progress ?? 1) >= 1 &&
      o.burntTick === undefined,
  );
  const people = agents.filter((a) => a.alive);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.worldEvent(worldId, {
        kind,
        intensity,
        hours,
        ...(targetId ? { targetId } : {}),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const severity = intensity >= 0.8 ? 'Severe' : intensity <= 0.3 ? 'Mild' : 'Moderate';
  const duration =
    hours >= 48
      ? `${Math.round((hours / 24) * 10) / 10} days`
      : `${hours} hour${hours === 1 ? '' : 's'}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="events-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="events-title">Trigger a world event</h2>
        <p className="muted small">
          You can change the world, not the people: they notice what they can see and feel, and
          decide for themselves what to do about it.
        </p>
        <div className="event-kinds" role="radiogroup" aria-label="Kind of event">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={`event-kind ${kind === k ? 'is-on' : ''}`}
              onClick={() => {
                setKind(k);
                setTargetId('');
              }}
            >
              <span className="event-kind-icon" aria-hidden>
                {CONDITION_INFO[k].icon}
              </span>
              {CONDITION_INFO[k].label}
            </button>
          ))}
        </div>
        <p className="small">{CONDITION_INFO[kind].blurb}</p>
        <label>
          Intensity: <strong>{severity}</strong>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.1}
            value={intensity}
            aria-label="Intensity"
            onChange={(e) => setIntensity(Number(e.target.value))}
          />
        </label>
        {kind !== 'fire' && (
          <label>
            Lasts: <strong>{duration}</strong> (in-game)
            <input
              type="range"
              min={1}
              max={240}
              step={1}
              value={hours}
              aria-label="Duration in hours"
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
        )}
        {kind === 'fire' && (
          <label>
            Building
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">A random house</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? OBJECT_LABELS[b.kind]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'disease' && (
          <label>
            First to fall ill
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">A few people at random</option>
              {people.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="warn small">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Starting…' : `Start ${CONDITION_INFO[kind].label.toLowerCase()}`}
          </button>
        </div>
      </form>
    </div>
  );
}

/** What's going on in the world right now, with time left. */
export function ConditionsBar({
  map,
  onPickObject,
}: {
  map: WorldMap | null;
  /** Clicking a fire shows the burning building. */
  onPickObject: (id: string) => void;
}) {
  const past = useWorld((s) => s.replay?.view);
  const liveConditions = useWorld((s) => s.conditions);
  const liveTick = useWorld((s) => s.tick);
  const conditions = past?.conditions ?? liveConditions;
  const tick = past?.tick ?? liveTick;
  if (conditions.length === 0) return null;
  const left = (c: ActiveCondition) => {
    const m = Math.max(0, c.endTick - tick);
    if (m < 60) return `${m} min left`;
    if (m < 48 * 60) return `${Math.round(m / 60)} h left`;
    return `${Math.round(m / 1440)} days left`;
  };
  return (
    <div className="conditions-bar" aria-label="World events in progress">
      {conditions.map((c) => {
        const info = CONDITION_INFO[c.kind];
        const target = c.targetId ? map?.objects.find((o) => o.id === c.targetId) : undefined;
        const label =
          c.kind === 'fire'
            ? `${target?.name ?? 'A building'} is burning`
            : `${c.intensity >= 0.8 ? 'Severe ' : c.intensity <= 0.3 ? 'Mild ' : ''}${info.label.toLowerCase()}`;
        const body = (
          <>
            <span aria-hidden>{info.icon}</span> {label[0]!.toUpperCase() + label.slice(1)} ·{' '}
            <span className="muted">{left(c)}</span>
          </>
        );
        return target ? (
          <button
            key={c.id}
            className={`condition condition-${c.kind} linkish`}
            title={`${info.blurb} Click to see ${target.name ?? 'the building'}.`}
            onClick={() => onPickObject(target.id)}
          >
            {body}
          </button>
        ) : (
          <span key={c.id} className={`condition condition-${c.kind}`} title={info.blurb}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
