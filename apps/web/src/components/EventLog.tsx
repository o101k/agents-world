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
  // Search the whole history (debounced).
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Which filters the fetched history belongs to (so we know when a search is still running).
  const historyKey = JSON.stringify([importantOnly, agentFilter, q]);
  const [loadedKey, setLoadedKey] = useState('');
  const searching = loadedKey !== historyKey;
  useEffect(() => {
    if (!worldId || (!importantOnly && !agentFilter && !q)) return;
    let cancelled = false;
    api
      .events(worldId, {
        limit: 300,
        minImportance: importantOnly ? 3 : 1,
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(q ? { q } : {}),
      })
      .then((r) => {
        if (cancelled) return;
        setHistory(r.events);
        setLoadedKey(JSON.stringify([importantOnly, agentFilter, q]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worldId, importantOnly, agentFilter, q]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return mergeEvents(events, importantOnly || agentFilter || q ? history : []).filter(
      (e) =>
        (!importantOnly || e.importance >= 3) &&
        (!selectedOnly || !selectedAgent || e.actors.includes(selectedAgent)) &&
        words.every((w) => e.text.toLowerCase().includes(w)) &&
        (importantOnly || q || e.kind !== 'decided' || (selectedOnly && selectedAgent)),
    );
  }, [events, history, importantOnly, selectedOnly, selectedAgent, agentFilter, q]);

  return (
    <section className="event-log" aria-label="Event log">
      <div className="event-log-head">
        <h2>Timeline</h2>
        <input
          type="search"
          className="event-search"
          placeholder="Search history…"
          aria-label="Search the timeline"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        {shown.length === 0 && (
          <li className="muted">
            {q
              ? searching
                ? 'Searching…'
                : `Nothing in the history matches “${q}”.`
              : 'Nothing has happened yet. Press Play.'}
          </li>
        )}
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
