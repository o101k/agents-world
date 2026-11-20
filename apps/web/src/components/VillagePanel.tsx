import { useEffect, useState } from 'react';
import { ITEM_LABELS, tickToClock, type ItemName, type VillageResponse } from '@aw/shared';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

/** The village's shared life (leader, purse, rules, meetings, stalls, pens, fields, work), refreshed each in-game hour. */
export function useVillage(worldId: string): {
  data: VillageResponse | null;
  error: string | null;
} {
  const [village, setVillage] = useState<VillageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hour = useWorld((s) => Math.floor(s.tick / 60));
  useEffect(() => {
    const ac = new AbortController();
    api
      .village(worldId, ac.signal)
      .then((v) => {
        if (ac.signal.aborted) return;
        setVillage(v);
        setError(null);
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [worldId, hour]);
  return { data: village, error };
}

const itemLabel = (item: string) => ITEM_LABELS[item as ItemName] ?? item;
const dayOf = (tick: number) => `day ${tickToClock(tick).day}`;

/** Everything the village has built up together, as the observer sees it. */
export function VillagePanel({ worldId }: { worldId: string }) {
  const { data: village, error } = useVillage(worldId);
  if (!village) {
    return error ? (
      <p className="warn small" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted small">Loading village…</p>
    );
  }
  return (
    <div className="village">
      <p>
        <strong>Leader:</strong> {village.leader ? village.leader.name : 'None yet.'}
      </p>
      <p>
        <strong>Village purse:</strong> {village.treasury} coins ·{' '}
        {village.taxPerDay > 0
          ? `levy of ${village.taxPerDay} coins a day from each grown-up`
          : 'no levy'}
      </p>

      <h4 className="village-sub">Rules</h4>
      {village.rules.length === 0 ? (
        <p className="muted small">No rules yet.</p>
      ) : (
        <ul className="village-list">
          {village.rules.map((r) => (
            <li key={r.id}>
              {r.text}
              <div className="muted small">
                Passed {dayOf(r.passedTick)}, proposed by {r.proposerName}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="village-sub">Meetings</h4>
      {village.meetings.length === 0 ? (
        <p className="muted small">No meetings.</p>
      ) : (
        village.meetings.map((m) => (
          <div key={m.id} className="village-item">
            <div>
              <strong>{m.topic}</strong>
              <div className="muted small">
                Called by {m.callerName} at {m.placeName}, until {dayOf(m.endTick)}
              </div>
            </div>
            {m.proposals.length === 0 ? (
              <p className="muted small">No proposals yet.</p>
            ) : (
              <ul className="village-list">
                {m.proposals.map((p) => (
                  <li key={p.id}>
                    {p.text} <span className="muted small">— {p.byName}</span>
                    <div className="small">
                      <span className="tag tag-ok">{p.yes} yes</span>{' '}
                      <span className="tag">{p.no} no</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      <h4 className="village-sub">Stalls</h4>
      {village.stalls.length === 0 ? (
        <p className="muted small">No stalls yet.</p>
      ) : (
        village.stalls.map((s) => (
          <div key={s.id} className="village-item">
            <div>
              <strong>{s.name}</strong>
              <div className="muted small">{s.owners.join(', ') || 'No owner'}</div>
            </div>
            <StallStock stock={s.stock} />
          </div>
        ))
      )}

      <h4 className="village-sub">Pens</h4>
      {village.pens.length === 0 ? (
        <p className="muted small">No pens yet.</p>
      ) : (
        village.pens.map((p) => (
          <div key={p.id} className="village-item">
            <div>
              <strong>{p.name}</strong>
              <div className="muted small">{p.owners.join(', ') || 'No owner'}</div>
            </div>
            <PenFacts hens={p.hens} sheep={p.sheep} wool={p.wool} />
          </div>
        ))
      )}

      <h4 className="village-sub">Fields</h4>
      {village.fields.length === 0 ? (
        <p className="muted small">No cleared fields yet.</p>
      ) : (
        <ul className="village-list">
          {village.fields.map((f) => (
            <li key={f.id}>
              <strong>{f.name}</strong> · {f.owners.join(', ') || 'No owner'} ·{' '}
              {f.crop ? `${itemLabel(f.crop)} ready: ${f.amount}` : 'nothing growing'}
            </li>
          ))}
        </ul>
      )}

      <h4 className="village-sub">Work agreements</h4>
      {village.jobs.length === 0 ? (
        <p className="muted small">No work agreements.</p>
      ) : (
        <ul className="village-list">
          {village.jobs.map((j) => (
            <li key={j.id}>
              {j.employerName} → {j.workerName}: {j.wage} coins, until {dayOf(j.endTick)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Animals and wool in a pen (also used in the details pane). */
export function PenFacts({ hens, sheep, wool }: { hens: number; sheep: number; wool: number }) {
  return (
    <p className="small">
      {hens} hen{hens === 1 ? '' : 's'} · {sheep} sheep · {wool} wool
    </p>
  );
}

/** A stall's goods and prices (also used in the details pane). */
export function StallStock({ stock }: { stock: VillageResponse['stalls'][number]['stock'] }) {
  if (stock.length === 0) return <p className="muted small">Nothing for sale.</p>;
  return (
    <table className="price-table">
      <thead>
        <tr>
          <th>Good</th>
          <th>Price</th>
          <th>Left</th>
        </tr>
      </thead>
      <tbody>
        {stock.map((g) => (
          <tr key={g.item}>
            <td>{itemLabel(g.item)}</td>
            <td>{g.price}</td>
            <td className="muted">{g.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
