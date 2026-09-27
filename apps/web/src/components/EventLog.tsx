import { useMemo, useState } from 'react';
import { formatClock } from '@aw/shared';
import { useWorld } from '../worldStore.ts';

/** Live timeline of what's happening. Newest first. */
export function EventLog({ onPickAgent }: { onPickAgent: (id: string) => void }) {
  const events = useWorld((s) => s.events);
  const selection = useWorld((s) => s.selection);
  const [importantOnly, setImportantOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const selectedAgent = selection?.kind === 'agent' ? selection.id : null;

  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (!importantOnly || e.importance >= 3) &&
          (!selectedOnly || !selectedAgent || e.actors.includes(selectedAgent)) &&
          (importantOnly || e.kind !== 'decided' || (selectedOnly && selectedAgent)),
      ),
    [events, importantOnly, selectedOnly, selectedAgent],
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
