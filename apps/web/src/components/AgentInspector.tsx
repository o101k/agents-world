import { useEffect, useState } from 'react';
import { NEED_LABELS, formatClock, type AgentDetail, type NeedName } from '@aw/shared';
import { api } from '../api.ts';
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

      <section>
        <h3>Brain</h3>
        <dl className="facts">
          <dt>Provider</dt>
          <dd>
            {agent.brain.provider === 'mock' ? 'Mock (free, rule-based)' : agent.brain.provider}
          </dd>
          <dt>Effort</dt>
          <dd>{agent.brain.effort}</dd>
        </dl>
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
