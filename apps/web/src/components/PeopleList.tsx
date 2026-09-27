import { useWorld } from '../worldStore.ts';
import { Portrait } from './Portrait.tsx';

export function PeopleList({ onPick }: { onPick: (id: string) => void }) {
  const agents = useWorld((s) => s.agents);
  const selection = useWorld((s) => s.selection);
  const alive = agents.filter((a) => a.alive);
  const dead = agents.filter((a) => !a.alive);
  const row = (a: (typeof agents)[number]) => (
    <li key={a.id}>
      <button
        className={`person-row ${selection?.kind === 'agent' && selection.id === a.id ? 'is-selected' : ''}`}
        onClick={() => onPick(a.id)}
      >
        <Portrait appearance={a.appearance} size={28} dead={!a.alive} />
        <span className="person-name">{a.name}</span>
        <span className="muted small">
          {a.alive
            ? `${a.age} · ${a.indoors && a.activity === 'sleeping' ? 'asleep at home' : a.activity}`
            : 'dead'}
        </span>
      </button>
    </li>
  );
  return (
    <div>
      <p className="muted small">
        {alive.length} living{dead.length ? ` · ${dead.length} dead` : ''}
      </p>
      <ul className="people">{alive.map(row)}</ul>
      {dead.length > 0 && (
        <>
          <h3>Remembered</h3>
          <ul className="people">{dead.map(row)}</ul>
        </>
      )}
    </div>
  );
}
