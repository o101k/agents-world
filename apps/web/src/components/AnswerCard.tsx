import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, type InterviewView } from '@aw/shared';
import { api } from '../api.ts';
import { answerBlocks, answerSource, periodLabel } from '../ask.ts';
import { useSettings } from '../settingsStore.ts';

/**
 * Asking: one question in flight for one person. The key (world + person) decides whether an
 * answer still belongs on screen: switching person drops it, closing a dialog doesn't (the saved
 * answer is still wanted by the inspector).
 */
export function useAsk(
  worldId: string,
  agentId: string,
  onAsked: (interview: InterviewView) => void,
) {
  const key = `${worldId}/${agentId}`;
  const keyRef = useRef(key);
  const onAskedRef = useRef(onAsked);
  // Each state remembers its person, so a leftover from another person is simply not shown.
  const [pending, setPending] = useState<{
    key: string;
    question: string;
    startedAt: number;
  } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    onAskedRef.current = onAsked;
  }, [onAsked]);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  /** Resolves true when an answer came back. */
  const ask = useCallback(
    async (question: string, from: number, to: number): Promise<boolean> => {
      const current = key;
      setFailed(null);
      setPending({ key: current, question, startedAt: Date.now() });
      let ok = false;
      try {
        const r = await api.ask(worldId, agentId, { question, fromTick: from, toTick: to });
        if (keyRef.current === current) onAskedRef.current(r.interview);
        ok = true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (keyRef.current === current) setFailed({ key: current, message });
      } finally {
        setPending((p) => (p?.key === current ? null : p));
      }
      return ok;
    },
    [worldId, agentId, key],
  );

  return {
    asking: pending?.key === key ? pending : null,
    error: failed?.key === key ? failed.message : null,
    ask,
  };
}

/** The "reading the record" card shown while an answer is being written. */
export function PendingAnswer({
  question,
  startedAt,
  firstName,
  her,
}: {
  question: string;
  startedAt: number;
  firstName: string;
  her: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((now - startedAt) / 1000);
  return (
    <div className="ask-card ask-pending">
      <div className="ask-q">{question.trim() || `What did ${firstName} do?`}</div>
      <div className="ask-reading">
        <span role="status">Reading {her} record</span>
        <span className="ask-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
        {seconds >= 3 && (
          <span className="muted small" aria-hidden="true">
            {' '}
            {seconds}s
          </span>
        )}
      </div>
    </div>
  );
}

/** One answer: the question, its period, the answer, and where it came from. */
export function AnswerCard({
  interview,
  firstName,
  lifeFrom,
  lifeTo,
  onPeriod,
  clamp = false,
  onMore,
}: {
  interview: InterviewView;
  /** Used for the question when it was left empty. */
  firstName?: string;
  lifeFrom: number;
  lifeTo: number;
  onPeriod?: (from: number, to: number) => void;
  /** Show only the start of a long answer, with a "Read more" link. */
  clamp?: boolean;
  onMore?: () => void;
}) {
  const providers = useSettings((s) => s.settings?.providers);
  const providerLabel = providers?.find((p) => p.id === interview.provider)?.label;
  const answerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = answerRef.current;
    if (!clamp || !el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, interview.answer]);

  const question =
    interview.question.trim() || (firstName ? `What did ${firstName} do?` : 'What did they do?');
  const label = periodLabel(interview.fromTick, interview.toTick, lifeFrom, lifeTo);

  return (
    <article className="ask-card">
      <div className="ask-q">{question}</div>
      <div className="ask-meta">
        {onPeriod ? (
          <button
            type="button"
            className="ask-period"
            title="Show this period"
            aria-label={`Show this period: ${label}`}
            onClick={() => onPeriod(interview.fromTick, interview.toTick)}
          >
            {label}
          </button>
        ) : (
          <span className="ask-period is-static">{label}</span>
        )}
      </div>
      {interview.note && (
        <div className="ask-note" role="note">
          {interview.note}
        </div>
      )}
      <div ref={answerRef} className={`ask-answer ${clamp ? 'is-clamped' : ''}`}>
        {answerBlocks(interview.answer).map((block, i) =>
          block.kind === 'ul' ? (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{block.text}</p>
          ),
        )}
      </div>
      {clamp && overflows && onMore && (
        <button type="button" className="linkish ask-more" onClick={onMore}>
          Read more
        </button>
      )}
      <div className="ask-foot muted small">
        Asked {formatClock(interview.askedTick)} · {answerSource(interview, providerLabel)}
      </div>
    </article>
  );
}
