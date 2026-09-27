import { useEffect, useMemo, useState } from 'react';
import { formatClock, type WorldEvent } from '@aw/shared';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

/** Live timeline of what's happening. Newest first. */
export function EventLog({ onPickAgent }: { onPickAgent: (id: string) => void }) {
  const events = useWorld((s) => s.events);
  const selection = useWorld((s) => s.selection);
  const [importantOnly, setImportantOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const selectedAgent = selection?.kind === 'agent' ? selection.id : null;
  const worldId = useWorld((s) => s.worldId);
  // Older history lives on the helper: when filtering, fetch matching events from the saved log.
  const [history, setHistory] = useState<WorldEvent[]>([]);
  const agentFilter = selectedOnly ? selectedAgent : null;
  useEffect(() => {
    if (!worldId || (!importantOnly && !agentFilter)) return;
    let cancelled = false;
    api
      .events(worldId, {
        limit: 300,
        minImportance: importantOnly ? 3 : 1,
        ...(agentFilter ? { agentId: agentFilter } : {}),
      })
      .then((r) => !cancelled && setHistory(r.events))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worldId, importantOnly, agentFilter]);

  const shown = useMemo(
    () =>
      mergeEvents(events, importantOnly || agentFilter ? history : []).filter(
        (e) =>
          (!importantOnly || e.importance >= 3) &&
          (!selectedOnly || !selectedAgent || e.actors.includes(selectedAgent)) &&
          (importantOnly || e.kind !== 'decided' || (selectedOnly && selectedAgent)),
      ),
    [events, history, importantOnly, selectedOnly, selectedAgent, agentFilter],
  );

  return (
    <section className="event-log" aria-label="Event log">
      <div className="event-log-head">
        <h2>Timeline</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={importantOnly}
            onChange={(e) => setImportantOnly(e.target.checked)}
          />{' '}
          Important only
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={selectedOnly}
            disabled={!selectedAgent}
            onChange={(e) => setSelectedOnly(e.target.checked)}
          />{' '}
          Selected person only
        </label>
      </div>
      <ol className="event-list">
        {shown.length === 0 && <li className="muted">Nothing has happened yet. Press Play.</li>}
        {shown.slice(0, 300).map((e) => (
          <li key={e.id ?? `${e.tick}-${e.text}`} className={`event imp-${e.importance}`}>
            <span className="event-time">{formatClock(e.tick)}</span>
            {e.actors[0] ? (
              <button className="event-text linkish" onClick={() => onPickAgent(e.actors[0]!)}>
                {e.text}
              </button>
            ) : (
              <span className="event-text">{e.text}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Live events plus fetched history, newest first, without duplicates. */
function mergeEvents(live: WorldEvent[], history: WorldEvent[]): WorldEvent[] {
  if (history.length === 0) return live;
  const seen = new Set(live.map((e) => e.id));
  return [...live, ...history.filter((e) => !seen.has(e.id))].sort(
    (a, b) => (b.id ?? 0) - (a.id ?? 0),
  );
}
