import { useEffect, useState } from 'react';
import {
  NEED_LABELS,
  formatClock,
  type AgentDetail,
  type LlmCallView,
  type NeedName,
} from '@aw/shared';
import { api } from '../api.ts';
import { BrainEditor } from './BrainEditor.tsx';
import { formatUsd } from './SpendMeter.tsx';
import { useWorld } from '../worldStore.ts';
import { Bar } from './Bars.tsx';
import { Portrait } from './Portrait.tsx';

const ACTIVITY_LABEL: Record<string, string> = {
  idle: 'Idle',
  walking: 'Walking',
  sleeping: 'Sleeping',
  eating: 'Eating',
  drinking: 'Drinking',
  gathering: 'Gathering',
  resting: 'Resting',
  thinking: 'Thinking…',
  dead: 'Dead',
};

const BIG_FIVE: [keyof AgentDetail['personality'], string][] = [
  ['openness', 'Openness'],
  ['conscientiousness', 'Conscientiousness'],
  ['extraversion', 'Extraversion'],
  ['agreeableness', 'Agreeableness'],
  ['neuroticism', 'Neuroticism'],
];

export function AgentInspector({ worldId, agentId }: { worldId: string; agentId: string }) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followId = useWorld((s) => s.followId);
  const setFollow = useWorld((s) => s.setFollow);
  const following = followId === agentId;

  // Poll while shown: cheap on localhost and keeps the mind view live.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .agent(worldId, agentId)
        .then((r) => {
          if (cancelled) return;
          setAgent(r.agent);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    void load();
    const t = setInterval(() => void load(), 600);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [worldId, agentId]);

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
            {agent.age} · {agent.sex} · {agent.occupation}
          </div>
          <div className={`status-pill ${agent.alive ? '' : 'is-dead'}`}>{status}</div>
        </div>
        {agent.alive && (
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
        <h3>Body</h3>
        <Bar label="Health" value={agent.health} />
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
        <h3>Skills</h3>
        {Object.entries(agent.skills)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <Bar key={k} label={k[0]!.toUpperCase() + k.slice(1)} value={v} tone="neutral" />
          ))}
      </section>

      {agent.memories.length > 0 && (
        <section>
          <h3>Memories ({agent.memories.length})</h3>
          <ul className="recent memories">
            {agent.memories.slice(0, 15).map((m, i) => (
              <li key={i}>
                <span
                  className={`imp imp-${Math.min(3, Math.ceil(m.importance / 3.4))}`}
                  title={`Importance ${m.importance}/10`}
                >
                  {m.importance}
                </span>{' '}
                <span className="muted small">{formatClock(m.tick)}</span> {m.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {agent.people.length > 0 && (
        <section>
          <h3>People they know</h3>
          <ul className="recent">
            {agent.people.slice(0, 12).map((p) => (
              <li key={p.id} className="person-known">
                <span>{p.name}</span>
                <span className="muted small">familiarity {p.familiarity}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Brain</h3>
        <p className="muted small">
          {agent.decisions} decisions · {formatUsd(agent.spentUsd)} spent on AI
        </p>
        {agent.alive && (
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
