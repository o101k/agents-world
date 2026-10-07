import { useEffect, useState } from 'react';
import {
  NEED_LABELS,
  STAGE_LABELS,
  formatClock,
  type AgentDetail,
  type LlmCallView,
  type NeedName,
  type RelationshipView,
} from '@aw/shared';
import { FamilyTree } from './FamilyTree.tsx';
import { api } from '../api.ts';
import { BrainEditor } from './BrainEditor.tsx';
import { formatUsd } from './SpendMeter.tsx';
import { useWorld } from '../worldStore.ts';
import { Bar } from './Bars.tsx';
import { Portrait } from './Portrait.tsx';
import { LifeStory } from './LifeStory.tsx';

const ACTIVITY_LABEL: Record<string, string> = {
  idle: 'Idle',
  walking: 'Walking',
  sleeping: 'Sleeping',
  eating: 'Eating',
  drinking: 'Drinking',
  gathering: 'Gathering',
  resting: 'Resting',
  working: 'Working',
  thinking: 'Thinking…',
  sick: 'Ill',
  dead: 'Dead',
};

const BIG_FIVE: [keyof AgentDetail['personality'], string][] = [
  ['openness', 'Openness'],
  ['conscientiousness', 'Conscientiousness'],
  ['extraversion', 'Extraversion'],
  ['agreeableness', 'Agreeableness'],
  ['neuroticism', 'Neuroticism'],
];

export function AgentInspector({
  worldId,
  agentId,
  onPick,
  atTick,
}: {
  worldId: string;
  agentId: string;
  onPick?: (id: string) => void;
  /** Replay: show the person as they were at this tick. */
  atTick?: number;
}) {
  const [treeOpen, setTreeOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followId = useWorld((s) => s.followId);
  const setFollow = useWorld((s) => s.setFollow);
  const following = followId === agentId;

  // Poll while shown: cheap on localhost and keeps the mind view live. In replay, load the past.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      (atTick === undefined
        ? api.agent(worldId, agentId)
        : api.replayAgent(worldId, atTick, agentId)
      )
        .then((r) => {
          if (cancelled) return;
          setAgent(r.agent);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    const first = setTimeout(() => void load(), atTick === undefined ? 0 : 150);
    const t = atTick === undefined ? setInterval(() => void load(), 600) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [worldId, agentId, atTick]);
  const replaying = atTick !== undefined;

  if (error) return <p className="muted">{error}</p>;
  if (!agent || agent.id !== agentId) return <p className="muted">Loading…</p>;

  const status = agent.alive
    ? agent.indoors && agent.activity === 'sleeping'
      ? 'Sleeping at home'
      : ACTIVITY_LABEL[agent.activity]
    : `Died ${agent.death ? formatClock(agent.death.tick) : ''} of ${agent.death?.cause}`;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <Portrait appearance={agent.appearance} dead={!agent.alive} />
        <div className="inspector-id">
          <div className="selection-title">{agent.name}</div>
          <div className="muted small">
            {STAGE_LABELS[agent.stage]} · {agent.age} · {agent.sex} · {agent.occupation}
          </div>
          <div className={`status-pill ${agent.alive ? '' : 'is-dead'}`}>{status}</div>
          {agent.sickness && <div className="status-pill is-ill">Ill</div>}
        </div>
        {agent.alive && !replaying && (
          <button
            className={`btn btn-small ${following ? 'btn-primary' : ''}`}
            onClick={() => setFollow(following ? null : agentId)}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {agent.alive && (
        <section>
          <h3>Mind</h3>
          {agent.thought ? (
            <blockquote className="thought">“{agent.thought}”</blockquote>
          ) : (
            <p className="muted">No thoughts yet.</p>
          )}
          <dl className="facts">
            <dt>Goal</dt>
            <dd>{agent.goal || '—'}</dd>
            <dt>Doing</dt>
            <dd>
              {agent.awaitingDecision ? 'Deciding what to do…' : (agent.currentAction ?? '—')}
            </dd>
          </dl>
          {agent.plan.length > 0 && (
            <ol className="plan">
              {agent.plan.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section>
        <h3>Family</h3>
        <dl className="facts">
          {agent.family.partner && (
            <PersonRow label="Partner" p={agent.family.partner} onPick={onPick} />
          )}
          {agent.family.mother && (
            <PersonRow label="Mother" p={agent.family.mother} onPick={onPick} />
          )}
          {agent.family.father && (
            <PersonRow label="Father" p={agent.family.father} onPick={onPick} />
          )}
          {agent.family.adoptiveParents.map((p) => (
            <PersonRow key={p.id} label="Adoptive parent" p={p} onPick={onPick} />
          ))}
          {agent.family.children.map((c) => (
            <PersonRow
              key={c.id}
              label={c.adopted ? 'Adopted child' : 'Child'}
              p={c}
              onPick={onPick}
            />
          ))}
        </dl>
        {!agent.family.partner &&
          !agent.family.mother &&
          !agent.family.father &&
          agent.family.adoptiveParents.length === 0 &&
          agent.family.children.length === 0 && (
            <p className="muted small">No family in the village.</p>
          )}
        {agent.pregnancy && (
          <p className="small">
            Expecting a child with {agent.pregnancy.fatherName} (
            {Math.round(agent.pregnancy.progress * 100)}% along).
          </p>
        )}
        {agent.will && <p className="small">Will: everything goes to {agent.will.heirName}.</p>}
        <button className="btn btn-small" onClick={() => setTreeOpen(true)}>
          Family tree
        </button>
        {treeOpen && (
          <FamilyTree
            worldId={worldId}
            agentId={agentId}
            onClose={() => setTreeOpen(false)}
            onPick={(id) => {
              setTreeOpen(false);
              onPick?.(id);
            }}
          />
        )}
      </section>

      <section>
        <h3>Body</h3>
        <Bar label="Health" value={agent.health} />
        {agent.sickness && <Bar label="Illness" value={agent.sickness.severity * 100} tone="bad" />}
        {(Object.keys(NEED_LABELS) as NeedName[]).map((k) => (
          <Bar key={k} label={NEED_LABELS[k]} value={agent.needs[k]} />
        ))}
      </section>

      <section>
        <h3>Belongings</h3>
        <dl className="facts">
          <dt>Money</dt>
          <dd>{agent.money} coins</dd>
          <dt>Home</dt>
          <dd>{agent.homeName ?? 'None'}</dd>
          {agent.owns.filter((o) => o.id !== agent.homeId).length > 0 && (
            <FactRow
              label="Owns"
              value={agent.owns
                .filter((o) => o.id !== agent.homeId)
                .map((o) => o.name)
                .join(', ')}
            />
          )}
          {Object.entries(agent.inventory).map(([item, n]) => (
            <FactRow key={item} label={item[0]!.toUpperCase() + item.slice(1)} value={String(n)} />
          ))}
        </dl>
      </section>

      <section>
        <h3>Recent experiences</h3>
        {agent.recent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="recent">
            {agent.recent.map((r, i) => (
              <li key={i}>
                <span className="muted small">{formatClock(r.tick)}</span> {r.text}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Knows {agent.knownPlaces} places.</p>
      </section>

      <section>
        <h3>About</h3>
        {agent.traits && <p>{agent.traits}</p>}
        {agent.background && <p className="muted">{agent.background}</p>}
        {BIG_FIVE.map(([k, label]) => (
          <Bar key={k} label={label} value={agent.personality[k]} tone="neutral" />
        ))}
      </section>

      <section>
        <h3>Inborn</h3>
        <Bar label="Physical aptitude" value={agent.aptitude.physical * 50} tone="neutral" />
        <Bar label="Craft aptitude" value={agent.aptitude.craft * 50} tone="neutral" />
        <Bar label="Social aptitude" value={agent.aptitude.social * 50} tone="neutral" />
        <Bar label="Mind aptitude" value={agent.aptitude.intellectual * 50} tone="neutral" />
        <Bar label="Constitution" value={agent.constitution * 50} tone="neutral" />
      </section>

      <section>
        <h3>Skills</h3>
        {Object.entries(agent.skills)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <Bar key={k} label={k[0]!.toUpperCase() + k.slice(1)} value={v} tone="neutral" />
          ))}
      </section>

      <section>
        <h3>Memory</h3>
        <button className="btn btn-small" onClick={() => setStoryOpen(true)}>
          Life story
        </button>
        {storyOpen && (
          <LifeStory worldId={worldId} agent={agent} onClose={() => setStoryOpen(false)} />
        )}
        <Memories agent={agent} />
      </section>

      {agent.people.length > 0 && (
        <section>
          <h3>Relationships</h3>
          <ul className="relationships">
            {agent.people.slice(0, 14).map((p) => (
              <RelationRow key={p.id} r={p} onPick={onPick} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Brain</h3>
        <p className="muted small">
          {agent.decisions} decisions ·{' '}
          {agent.brain.provider === 'claude_plan'
            ? `${formatUsd(agent.spentUsd)} of AI use (Claude plan, at API prices)`
            : `${formatUsd(agent.spentUsd)} spent on AI`}
        </p>
        {replaying && (
          <p className="muted small">As they were on {formatClock(atTick)} (replay).</p>
        )}
        {agent.alive && !replaying && (
          <BrainEditor
            key={JSON.stringify(agent.brain)}
            value={agent.brain}
            onSave={async (brain) => {
              await api.setBrain(worldId, agentId, brain);
            }}
          />
        )}
        <AiExchanges worldId={worldId} agentId={agentId} />
      </section>
    </div>
  );
}

type MemoryFilter = 'all' | 'story' | 'forgotten';

/**
 * What the person remembers: their life chapters and beliefs, then the memory stream (faded
 * memories look faint), and what they have forgotten (greyed; they no longer know it).
 */
function Memories({ agent }: { agent: AgentDetail }) {
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [limit, setLimit] = useState(15);
  const chapters = agent.memories
    .filter((m) => m.kind === 'chapter')
    .sort((a, b) => a.tick - b.tick);
  const beliefs = agent.memories.filter((m) => m.kind === 'belief');
  const list =
    filter === 'forgotten'
      ? agent.forgotten
      : filter === 'story'
        ? agent.memories.filter((m) => m.kind === 'diary')
        : agent.memories.filter((m) => m.kind !== 'chapter' && m.kind !== 'belief');
  return (
    <div className="memory">
      {chapters.length > 0 && (
        <>
          <h4>Life so far</h4>
          <ol className="chapters">
            {chapters.map((c) => (
              <li key={c.tick}>{c.text}</li>
            ))}
          </ol>
        </>
      )}
      {beliefs.length > 0 && (
        <>
          <h4>Believes</h4>
          <ul className="beliefs">
            {beliefs.map((b) => (
              <li key={b.tick + b.text}>{b.text}</li>
            ))}
          </ul>
        </>
      )}
      <div className="segmented" role="tablist" aria-label="Which memories">
        {(
          [
            ['all', `Memories (${agent.memories.length})`],
            ['story', 'Diary'],
            ['forgotten', `Forgotten (${agent.forgotten.length})`],
          ] as [MemoryFilter, string][]
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
      {list.length === 0 ? (
        <p className="muted small">
          {filter === 'forgotten' ? 'Nothing forgotten yet.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="recent memories">
          {list.slice(0, limit).map((m, i) => (
            <li
              key={i}
              className={m.forgotten ? 'is-forgotten' : ''}
              style={
                m.forgotten || m.strength === undefined
                  ? undefined
                  : { opacity: 0.45 + 0.55 * Math.min(1, m.strength / Math.max(1, m.importance)) }
              }
              title={
                m.forgotten
                  ? 'Forgotten — they no longer remember this'
                  : `Importance ${m.importance}/10 · vividness ${m.strength ?? m.importance}/10`
              }
            >
              <span className={`imp imp-${Math.min(3, Math.ceil(m.importance / 3.4))}`}>
                {m.importance}
              </span>{' '}
              <span className="muted small">{formatClock(m.tick)}</span> {m.text}
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && (
        <button className="linkish small" onClick={() => setLimit(limit + 30)}>
          Show more ({list.length - limit} more)
        </button>
      )}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** The raw prompts and replies behind recent decisions (for curiosity and debugging). */
function AiExchanges({ worldId, agentId }: { worldId: string; agentId: string }) {
  const [calls, setCalls] = useState<LlmCallView[] | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void api.calls(worldId, agentId).then((r) => setCalls(r.calls));
  };
  return (
    <div className="exchanges">
      <button className="linkish small" onClick={toggle}>
        {open ? '▾' : '▸'} Raw AI exchanges
      </button>
      {open &&
        (calls === null ? (
          <p className="muted small">Loading…</p>
        ) : calls.length === 0 ? (
          <p className="muted small">
            No AI calls yet (the mock brain and instinct don’t call an AI).
          </p>
        ) : (
          calls.map((c) => (
            <details key={c.id} className="exchange">
              <summary>
                {formatClock(c.tick)} · {c.trigger} · {c.model || c.provider} · {c.inputTokens}+
                {c.outputTokens} tok · {formatUsd(c.costUsd)}
                {c.plan ? ' (plan)' : ''}
                {c.error ? ' · ⚠' : ''}
              </summary>
              {c.error && <p className="warn small">{c.error}</p>}
              {c.prompt ? (
                <pre>{c.prompt}</pre>
              ) : (
                <p className="muted small">(Text of older calls isn’t kept.)</p>
              )}
              {c.response && <pre>{c.response}</pre>}
            </details>
          ))
        ))}
    </div>
  );
}

function PersonRow({
  label,
  p,
  onPick,
}: {
  label: string;
  p: { id: string; name: string; alive: boolean };
  onPick?: (id: string) => void;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <button className="linkish" onClick={() => onPick?.(p.id)}>
          {p.name}
          {p.alive ? '' : ' †'}
        </button>
      </dd>
    </>
  );
}

function feelingLabel(r: RelationshipView): string {
  const like =
    r.affection >= 60
      ? 'loves'
      : r.affection >= 25
        ? 'likes'
        : r.affection > -25
          ? 'neutral'
          : r.affection > -60
            ? 'dislikes'
            : 'hates';
  const trust = r.trust >= 40 ? ', trusts' : r.trust <= -20 ? ', distrusts' : '';
  const rom = r.romance >= 50 ? ', in love' : r.romance >= 20 ? ', attracted' : '';
  return `${like}${trust}${rom}`;
}

function RelationRow({ r, onPick }: { r: RelationshipView; onPick?: (id: string) => void }) {
  return (
    <li>
      <button className="linkish" onClick={() => onPick?.(r.id)}>
        {r.name}
      </button>
      {r.role && <span className="tag">{r.role}</span>}
      <span className="muted small"> {feelingLabel(r)}</span>
    </li>
  );
}
