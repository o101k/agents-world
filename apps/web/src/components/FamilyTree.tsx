import { useEffect, useRef, useState } from 'react';
import type { FamilyNode } from '@aw/shared';
import { api } from '../api.ts';
import { useDialog } from './useDialog.ts';

/** Grandparents → parents → the person (and partner) → children → grandchildren. */
export function FamilyTree({
  worldId,
  agentId,
  onPick,
  onClose,
}: {
  worldId: string;
  agentId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState<FamilyNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDialog(dialogRef, onClose);

  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/loading state when the fetch key changes
    setTree(null);
    setError(null);
    api
      .familyTree(worldId, agentId, ac.signal)
      .then((t) => !ac.signal.aborted && setTree(t))
      .catch((e: Error) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [worldId, agentId]);

  const person = (
    n: { id: string; name: string; alive: boolean; age?: number } | null | undefined,
    cls = '',
  ) =>
    n ? (
      <button
        type="button"
        key={n.id}
        className={`tree-person ${n.alive ? '' : 'is-dead'} ${cls}`}
        onClick={() => onPick(n.id)}
      >
        <span>{n.name}</span>
        {'age' in n && n.age !== undefined && (
          <span className="muted small">{n.alive ? `${n.age}` : '†'}</span>
        )}
      </button>
    ) : (
      <span className="tree-person is-unknown">unknown</span>
    );

  const grandparents = tree
    ? [tree.mother?.mother, tree.mother?.father, tree.father?.mother, tree.father?.father]
    : [];
  const grandchildren = tree?.children?.flatMap((c) => c.children ?? []) ?? [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal panel family-tree"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tree-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="tree-title">Family tree{tree ? ` — ${tree.name}` : ''}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        {!tree && !error && <p className="muted">Loading family tree…</p>}
        {tree && (
          <div className="tree">
            {grandparents.some(Boolean) && (
              <div className="tree-row">
                <span className="tree-label muted small">Grandparents</span>
                <div className="tree-people">
                  {grandparents.map((g, i) =>
                    g ? (
                      person(g)
                    ) : (
                      <span key={i} className="tree-person is-unknown">
                        —
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}
            <div className="tree-row">
              <span className="tree-label muted small">Parents</span>
              <div className="tree-people">
                {person(tree.mother)}
                {person(tree.father)}
              </div>
            </div>
            <div className="tree-row">
              <span className="tree-label muted small">{tree.partner ? 'Couple' : 'Person'}</span>
              <div className="tree-people">
                {person(tree, 'is-root')}
                {tree.partner && person(tree.partner)}
              </div>
            </div>
            <div className="tree-row">
              <span className="tree-label muted small">Children</span>
              <div className="tree-people">
                {tree.children?.length ? (
                  tree.children.map((c) => person(c))
                ) : (
                  <span className="muted small">none</span>
                )}
              </div>
            </div>
            {grandchildren.length > 0 && (
              <div className="tree-row">
                <span className="tree-label muted small">Grandchildren</span>
                <div className="tree-people">{grandchildren.map((c) => person(c))}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
