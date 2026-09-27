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

/** Write your own starting cast: one row per person. Same household number = same house. */
export function CastEditor({
  people,
  onChange,
}: {
  people: PersonInput[];
  onChange: (p: PersonInput[]) => void;
}) {
  const set = (i: number, patch: Partial<PersonInput>) =>
    onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const names = people.map((p) => p.name).filter(Boolean);
  return (
    <div className="cast-editor">
      <p className="muted small">
        One card per person. People with the same household number share a house. Partner and
        parents refer to first names in this list. Ages below 1 are babies (e.g. 0.5 = six months).
      </p>
      <div className="cast-grid">
        {people.map((p, i) => (
          <div key={i} className="cast-card">
            <div className="cast-row">
              <label>
                First name
                <input
                  value={p.name}
                  onChange={(e) => set(i, { name: e.target.value })}
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
                  value={p.age}
                  inputMode="decimal"
                  onChange={(e) =>
                    set(i, { age: Math.max(0, Math.min(95, Number(e.target.value) || 0)) })
                  }
                />
              </label>
              <label>
                Household
                <input
                  value={p.household ?? i}
                  inputMode="numeric"
                  onChange={(e) =>
                    set(i, { household: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })
                  }
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
                  {names
                    .filter((n) => n !== p.name)
                    .map((n) => (
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
                      set(i, { parents: parents.filter(Boolean) });
                    }}
                  >
                    <option value="">—</option>
                    {names
                      .filter((n) => n !== p.name)
                      .map((n) => (
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
              onClick={() => onChange(people.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-small"
        onClick={() =>
          onChange([...people, { name: '', sex: 'female', age: 25, household: people.length }])
        }
      >
        + Add person
      </button>
    </div>
  );
}
