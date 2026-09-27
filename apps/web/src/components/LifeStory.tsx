import { useEffect, useState } from 'react';
import { formatClock, type AgentDetail, type StoryEntry } from '@aw/shared';
import { api } from '../api.ts';

type Filter = 'all' | 'memory' | 'event';

/**
 * A person's life story: what happened to them (from the world's history, which forgets nothing)
 * interleaved with their own diary and life chapters (in their words, which may differ).
 */
export function LifeStory({
  worldId,
  agent,
  onClose,
}: {
  worldId: string;
  agent: AgentDetail;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    api
      .story(worldId, agent.id)
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [worldId, agent.id]);

  const shown = (entries ?? []).filter((e) => filter === 'all' || e.source === filter);
  const byDay = new Map<number, StoryEntry[]>();
  for (const e of shown) {
    const day = Math.floor(e.tick / 1440) + 1;
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal panel story"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="story-title">The life of {agent.name}</h2>
          <button className="btn btn-small btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">
          {agent.alive ? `${agent.age} years old` : `Died aged ${agent.age}`}. What happened to
          them, from the village’s history, alongside their own diary{' '}
          <span className="story-mine">in their words</span>.
        </p>
        <div className="segmented" role="tablist" aria-label="Show">
          {(
            [
              ['all', 'Everything'],
              ['memory', 'In their words'],
              ['event', 'What happened'],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`seg ${filter === f ? 'is-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="story-body">
          {error && <p className="warn">{error}</p>}
          {!entries && !error && <p className="muted">Loading…</p>}
          {entries && shown.length === 0 && <p className="muted">Nothing recorded yet.</p>}
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day} className="story-day">
              <h4>Day {day}</h4>
              <ul>
                {list.map((e, i) => (
                  <li key={i} className={e.source === 'memory' ? 'story-mine' : ''}>
                    <span className="muted small">
                      {formatClock(e.tick).replace(/^Day \d+,?\s*/, '')}
                    </span>{' '}
                    {e.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
