import { useState } from 'react';
import type { PersonInput } from '@aw/shared';

export const STARTER_CAST: PersonInput[] = [
  {
    name: 'Anna',
    familyName: 'Berg',
    sex: 'female',
    age: 32,
    occupation: 'farmer',
    household: 0,
    partner: 'Erik',
    traits: 'Warm, practical, worries about money.',
  },
  {
    name: 'Erik',
    familyName: 'Berg',
    sex: 'male',
    age: 35,
    occupation: 'fisherman',
    household: 0,
    partner: 'Anna',
    traits: 'Quiet and stubborn; loves the river.',
  },
  {
    name: 'Lotta',
    familyName: 'Berg',
    sex: 'female',
    age: 0.5,
    household: 0,
    parents: ['Anna', 'Erik'],
  },
  {
    name: 'Greta',
    familyName: 'Holm',
    sex: 'female',
    age: 58,
    occupation: 'baker',
    household: 1,
    traits: 'Sharp-tongued, generous, knows everyone’s business.',
  },
  {
    name: 'Nils',
    familyName: 'Holm',
    sex: 'male',
    age: 20,
    occupation: 'carpenter',
    household: 1,
    parents: ['Greta'],
    traits: 'Restless and ambitious.',
  },
];

/** Stable React keys for cast cards, so removing a card keeps the others' identity. */
let nextRowId = 1;

/** Write your own starting cast: one row per person. Same household number = same house. */
export function CastEditor({
  people,
  onChange,
}: {
  people: PersonInput[];
  onChange: (p: PersonInput[]) => void;
}) {
  const [ids, setIds] = useState<number[]>(() => people.map(() => nextRowId++));
  const [ageDrafts, setAgeDrafts] = useState<Record<number, string>>({});
  const [houseDrafts, setHouseDrafts] = useState<Record<number, string>>({});

  // Keep local row IDs in sync if parent replaces the cast length externally.
  const rowIds =
    ids.length === people.length ? ids : people.map((_, idx) => ids[idx] ?? -(idx + 1));

  const set = (i: number, patch: Partial<PersonInput>) =>
    onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const renamePerson = (i: number, nextName: string) => {
    const prevName = people[i]?.name ?? '';
    onChange(
      people.map((p, j) => {
        if (j === i) return { ...p, name: nextName };
        if (!prevName) return p;
        const partner = p.partner === prevName ? nextName || undefined : p.partner;
        const parents = p.parents
          ? p.parents.map((par) => (par === prevName ? nextName : par)).filter(Boolean)
          : undefined;
        return {
          ...p,
          partner,
          parents: parents && parents.length > 0 ? parents : undefined,
        };
      }),
    );
  };

  const removePerson = (i: number) => {
    const removedName = people[i]?.name ?? '';
    const removedId = rowIds[i];
    setIds(rowIds.filter((_, j) => j !== i));
    if (removedId !== undefined) {
      setAgeDrafts((d) => {
        const next = { ...d };
        delete next[removedId];
        return next;
      });
      setHouseDrafts((d) => {
        const next = { ...d };
        delete next[removedId];
        return next;
      });
    }
    onChange(
      people
        .filter((_, j) => j !== i)
        .map((p) => {
          if (!removedName) return p;
          const partner = p.partner === removedName ? undefined : p.partner;
          const parents = p.parents?.filter((par) => par !== removedName);
          return {
            ...p,
            partner,
            parents: parents && parents.length > 0 ? parents : undefined,
          };
        }),
    );
  };

  const addPerson = () => {
    const newId = nextRowId++;
    setIds([...rowIds, newId]);
    onChange([...people, { name: '', sex: 'female', age: 25, household: people.length }]);
  };

  const uniqueNames = Array.from(new Set(people.map((p) => p.name).filter(Boolean)));

  return (
    <div className="cast-editor">
      <p className="muted small">
        One card per person. People with the same household number share a house. Partner and
        parents refer to first names in this list. Ages below 1 are babies (e.g. 0.5 = six months).
      </p>
      <div className="cast-grid">
        {people.map((p, i) => {
          const rowId = rowIds[i]!;
          const ageValue = ageDrafts[rowId] ?? String(p.age);
          const houseValue = houseDrafts[rowId] ?? String(p.household ?? i);
          const otherNames = uniqueNames.filter((n) => n !== p.name);
          return (
            <div key={rowId} className="cast-card">
              <div className="cast-row">
                <label>
                  First name
                  <input
                    value={p.name}
                    onChange={(e) => renamePerson(i, e.target.value)}
                    maxLength={40}
                  />
                </label>
                <label>
                  Family name
                  <input
                    value={p.familyName ?? ''}
                    onChange={(e) => set(i, { familyName: e.target.value })}
                    maxLength={40}
                  />
                </label>
              </div>
              <div className="cast-row">
                <label>
                  Sex
                  <select
                    value={p.sex}
                    onChange={(e) => set(i, { sex: e.target.value as PersonInput['sex'] })}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label>
                  Age
                  <input
                    value={ageValue}
                    inputMode="decimal"
                    onChange={(e) => {
                      const raw = e.target.value;
                      setAgeDrafts((d) => ({ ...d, [rowId]: raw }));
                      const parsed = Number(raw);
                      if (raw.trim() !== '' && Number.isFinite(parsed)) {
                        set(i, { age: Math.max(0, Math.min(95, parsed)) });
                      }
                    }}
                    onBlur={() => {
                      setAgeDrafts((d) => {
                        const next = { ...d };
                        delete next[rowId];
                        return next;
                      });
                    }}
                  />
                </label>
                <label>
                  Household
                  <input
                    value={houseValue}
                    inputMode="numeric"
                    onChange={(e) => {
                      const raw = e.target.value;
                      setHouseDrafts((d) => ({ ...d, [rowId]: raw }));
                      const parsed = Number.parseInt(raw, 10);
                      if (raw.trim() !== '' && Number.isFinite(parsed)) {
                        set(i, { household: Math.max(0, Math.min(40, parsed)) });
                      }
                    }}
                    onBlur={() => {
                      setHouseDrafts((d) => {
                        const next = { ...d };
                        delete next[rowId];
                        return next;
                      });
                    }}
                  />
                </label>
              </div>
              <div className="cast-row">
                <label>
                  Occupation
                  <input
                    value={p.occupation ?? ''}
                    onChange={(e) => set(i, { occupation: e.target.value })}
                    maxLength={60}
                  />
                </label>
                <label>
                  Partner
                  <select
                    value={p.partner ?? ''}
                    onChange={(e) => set(i, { partner: e.target.value || undefined })}
                  >
                    <option value="">None</option>
                    {otherNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="cast-row">
                {[0, 1].map((k) => (
                  <label key={k}>
                    Parent {k + 1}
                    <select
                      value={p.parents?.[k] ?? ''}
                      onChange={(e) => {
                        const parents = [...(p.parents ?? [])];
                        parents[k] = e.target.value;
                        const cleaned = parents.filter(Boolean);
                        set(i, { parents: cleaned.length > 0 ? cleaned : undefined });
                      }}
                    >
                      <option value="">—</option>
                      {otherNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label>
                Nature
                <input
                  value={p.traits ?? ''}
                  onChange={(e) => set(i, { traits: e.target.value })}
                  maxLength={400}
                  placeholder="e.g. Proud, kind to children"
                />
              </label>
              <label>
                Story
                <textarea
                  rows={2}
                  value={p.background ?? ''}
                  onChange={(e) => set(i, { background: e.target.value })}
                  maxLength={1500}
                />
              </label>
              <button
                type="button"
                className="btn btn-small btn-danger-ghost"
                aria-label={`Remove ${p.name.trim() || `person ${i + 1}`}`}
                onClick={() => removePerson(i)}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-small" onClick={addPerson}>
        + Add person
      </button>
    </div>
  );
}
