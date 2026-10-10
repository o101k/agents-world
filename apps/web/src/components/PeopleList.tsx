import { memo } from 'react';
import { useThrottledWorld } from '../useThrottledWorld.ts';
import { useWorld } from '../worldStore.ts';
import { Portrait } from './Portrait.tsx';

/**
 * One person in the list. Only primitives come in, so a row re-renders only when its own text,
 * look or selection changes (the store hands out new agent objects on every frame).
 */
const PersonRow = memo(function PersonRow({
  id,
  name,
  status,
  alive,
  selected,
  skin,
  hair,
  shirt,
  pants,
  hairStyle,
  onPick,
}: {
  id: string;
  name: string;
  status: string;
  alive: boolean;
  selected: boolean;
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hairStyle: number;
  onPick: (id: string) => void;
}) {
  return (
    <li>
      <button className={`person-row ${selected ? 'is-selected' : ''}`} onClick={() => onPick(id)}>
        <Portrait appearance={{ skin, hair, shirt, pants, hairStyle }} size={28} dead={!alive} />
        <span className="person-name">{name}</span>
        <span className="muted small">{status}</span>
      </button>
    </li>
  );
});

export function PeopleList({ onPick }: { onPick: (id: string) => void }) {
  // In replay, the people as they were then.
  // Throttled to 4 updates a second: no one can read this list changing every frame.
  const live = useThrottledWorld((s) => s.agents);
  const past = useWorld((s) => s.replay?.view?.agents);
  const agents = past ?? live;
  const selection = useWorld((s) => s.selection);
  const alive = agents.filter((a) => a.alive);
  const dead = agents.filter((a) => !a.alive);
  const row = (a: (typeof agents)[number]) => (
    <PersonRow
      key={a.id}
      id={a.id}
      name={a.name}
      status={
        a.alive
          ? `${a.age} · ${a.indoors && a.activity === 'sleeping' ? 'asleep at home' : a.activity}`
          : 'dead'
      }
      alive={a.alive}
      selected={selection?.kind === 'agent' && selection.id === a.id}
      skin={a.appearance.skin}
      hair={a.appearance.hair}
      shirt={a.appearance.shirt}
      pants={a.appearance.pants}
      hairStyle={a.appearance.hairStyle}
      onPick={onPick}
    />
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
