import { useEffect, useState } from 'react';
import { formatClock, type ObjectHistoryResponse, type WorldEvent } from '@aw/shared';
import { api } from '../api.ts';
import { usageLine } from '../objectHistory.ts';
import { useWorld } from '../worldStore.ts';

/**
 * What the village's history knows about one object: when it was made, what happened to it and
 * who uses it. Times jump the map to that moment; names select the person.
 */
export function ObjectHistory({
  worldId,
  objectId,
  atTick,
  onPick,
}: {
  worldId: string;
  objectId: string;
  atTick?: number;
  onPick: (id: string) => void;
}) {
  // While live, refetch when a new event names this object.
  const liveEventId = useWorld((s) =>
    atTick === undefined ? s.events.find((e) => e.objects?.includes(objectId))?.id : undefined,
  );
  const [data, setData] = useState<ObjectHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .objectHistory(worldId, objectId, atTick)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [worldId, objectId, atTick, liveEventId]);

  if (error) return <p className="warn">{error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;

  const usage = usageLine(data.uses, data.regulars);
  return (
    <div className="object-history-section">
      {data.residents.length > 0 && (
        <p>
          <strong>Home of:</strong>{' '}
          {data.residents.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              <button className="linkish inline" onClick={() => onPick(r.id)}>
                {r.name}
              </button>
            </span>
          ))}
        </p>
      )}
      <h3>History</h3>
      <ol className="object-history">
        {data.founded && (
          <HistoryRow
            tick={data.foundedTick}
            text="Part of the village since it was founded."
            onPick={onPick}
          />
        )}
        {!data.founded && data.milestones.length === 0 && (
          <li className="muted">Made after the village was founded.</li>
        )}
        {data.milestones.map((e) => (
          <HistoryRow key={e.id ?? `${e.tick}-${e.text}`} event={e} onPick={onPick} />
        ))}
      </ol>
      {usage && <p className="muted small">{usage}</p>}
      {data.recent.length > 0 && (
        <>
          <h3>Latest use</h3>
          <ol className="object-history">
            {data.recent.map((e) => (
              <HistoryRow key={e.id ?? `${e.tick}-${e.text}`} event={e} onPick={onPick} />
            ))}
          </ol>
        </>
      )}
      {data.recordedSince > data.foundedTick && (
        <p className="muted small">
          Day-to-day use is recorded from {formatClock(data.recordedSince)}.
        </p>
      )}
    </div>
  );
}

function HistoryRow({
  event,
  tick,
  text,
  onPick,
}: {
  event?: WorldEvent;
  tick?: number;
  text?: string;
  onPick: (id: string) => void;
}) {
  const when = event?.tick ?? tick ?? 0;
  const body = event?.text ?? text ?? '';
  const actor = event?.actors[0];
  return (
    <li className={`event imp-${event?.importance ?? 3}`}>
      <button
        className="event-time linkish"
        title="Replay this moment on the map"
        onClick={() => useWorld.getState().setReplayTarget(when)}
      >
        {formatClock(when)}
      </button>
      {actor ? (
        <button className="event-text linkish" onClick={() => onPick(actor)}>
          {body}
        </button>
      ) : (
        <span className="event-text">{body}</span>
      )}
    </li>
  );
}
