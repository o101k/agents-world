import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  RECORD_KINDS,
  formatClock,
  tickToClock,
  type BrainConfig,
  type InterviewView,
  type RecordEntry,
  type RecordKind,
  type RecordResponse,
  type Sex,
} from '@aw/shared';
import { api } from '../api.ts';
import {
  RECORD_KIND_LABELS,
  groupByDay,
  periodLabel,
  periodPresets,
  pronounsFor,
  suggestionsFor,
  type PeriodPresetId,
} from '../ask.ts';
import { useSettings } from '../settingsStore.ts';
import { useWorld } from '../worldStore.ts';
import { AnswerCard, PendingAnswer, useAsk } from './AnswerCard.tsx';

const PAGE = 100;
const DAY = 1440;
const ZERO_COUNTS: Record<RecordKind, number> = {
  event: 0,
  said: 0,
  thought: 0,
  diary: 0,
  memory: 0,
};

type KindTab = RecordKind | 'all';

/** The full view of asking about one person: the conversation, the period and the record. */
export function AskDialog({
  worldId,
  agentId,
  firstName,
  fullName,
  sex,
  lifeFromTick,
  lifeToTick,
  nowTick,
  daysPerYear,
  initialFrom,
  initialTo,
  interviews,
  onAsked,
  onClose,
}: {
  worldId: string;
  agentId: string;
  firstName: string;
  fullName: string;
  sex: Sex;
  brain: BrainConfig;
  /** Replay moment, if any (the periods are measured from `nowTick`). */
  atTick?: number;
  lifeFromTick: number;
  lifeToTick: number;
  /** "Now" for the period chips: the replay moment, or the world's time. */
  nowTick: number;
  daysPerYear: number;
  initialFrom: number;
  initialTo: number;
  interviews: InterviewView[];
  onAsked: (interview: InterviewView) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const { subj, poss } = pronounsFor(sex);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [kind, setKind] = useState<KindTab>('all');
  const [rec, setRec] = useState<{ key: string; data: RecordResponse } | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [text, setText] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const { asking, error: askError, ask } = useAsk(worldId, agentId, onAsked);

  const presets = periodPresets(nowTick, lifeFromTick, lifeToTick, daysPerYear);
  const activePreset: PeriodPresetId | null =
    presets.find((p) => p.available && p.from === from && p.to === to)?.id ?? null;

  // Escape closes, unless the settings dialog is open on top of this one.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !useSettings.getState().open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Newest answer in view.
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [interviews.length]);

  // The record for the period and kind, page 1. Sliders are debounced so dragging doesn't flood.
  const key = `${from}|${to}|${kind}`;
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .record(worldId, agentId, {
          from,
          to,
          kinds: kind === 'all' ? undefined : kind,
          limit: PAGE,
          offset: 0,
        })
        .then((r) => {
          if (cancelled) return;
          setRec({ key, data: r });
          setRecError(null);
        })
        .catch((e: Error) => !cancelled && setRecError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [worldId, agentId, from, to, kind, key]);

  const loading = rec?.key !== key;
  const data = rec?.data ?? null;
  const counts = data?.counts ?? ZERO_COUNTS;
  const totalAll = RECORD_KINDS.reduce((sum, k) => sum + counts[k], 0);
  const tabs: { id: KindTab; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: totalAll },
    ...RECORD_KINDS.map((k) => ({ id: k, label: RECORD_KIND_LABELS[k], n: counts[k] })),
  ];

  const loadOlder = async () => {
    if (!data || moreBusy) return;
    const offset = data.entries.length;
    const k = key;
    setMoreBusy(true);
    try {
      const r = await api.record(worldId, agentId, {
        from: data.fromTick,
        to: data.toTick,
        kinds: kind === 'all' ? undefined : kind,
        limit: PAGE,
        offset,
      });
      // Only add the page if the list is still the one it was asked for.
      setRec((prev) =>
        prev && prev.key === k && prev.data.entries.length === offset
          ? { key: k, data: { ...prev.data, entries: [...prev.data.entries, ...r.entries] } }
          : prev,
      );
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoreBusy(false);
    }
  };

  // Day strip: one bar per day of their life.
  const days = data?.days ?? [];
  const maxNotable = days.reduce((m, d) => Math.max(m, d.notable), 1);
  const firstDay = Math.floor(from / DAY) + 1;
  const lastDay = Math.floor(to / DAY) + 1;

  const pickDay = (day: number) => {
    const start = (day - 1) * DAY;
    setFrom(Math.max(start, lifeFromTick));
    setTo(Math.min(start + DAY - 1, lifeToTick));
  };

  const pickPreset = (id: PeriodPresetId) => {
    const p = presets.find((x) => x.id === id);
    if (p?.available) {
      setFrom(p.from);
      setTo(p.to);
    }
  };

  const composerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!asking) submit(text);
    }
  };

  const submit = (question: string, wholeLife = false) => {
    const q = question.trim();
    const period = wholeLife ? { from: lifeFromTick, to: lifeToTick } : { from, to };
    if (wholeLife) {
      setFrom(lifeFromTick);
      setTo(lifeToTick);
    }
    void ask(q, period.from, period.to).then((ok) => ok && setText(''));
  };

  const groups = data ? groupByDay(data.entries) : [];
  const periodText = periodLabel(from, to, lifeFromTick, lifeToTick);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal panel ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>Ask about {fullName}</h2>
            <p className="muted small">
              Answers come from {poss} own brain reading the village&apos;s record of {poss} life.
              Asking never changes anything in the world.
            </p>
          </div>
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ask-period-panel">
          <div className="segmented ask-periods" role="group" aria-label="Period">
            {presets
              .filter((p) => p.available)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`seg ${activePreset === p.id ? 'is-on' : ''}`}
                  aria-pressed={activePreset === p.id}
                  onClick={() => pickPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
          </div>
          <div className="ask-range">
            <label className="ask-slider">
              <span className="muted small">From</span>
              <input
                type="range"
                min={lifeFromTick}
                max={to}
                step={60}
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
                aria-label="From"
              />
              <span className="small">{formatClock(from)}</span>
            </label>
            <label className="ask-slider">
              <span className="muted small">To</span>
              <input
                type="range"
                min={from}
                max={lifeToTick}
                step={60}
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
                aria-label="To"
              />
              <span className="small">{formatClock(to)}</span>
            </label>
          </div>
          <div className="ask-strip" aria-label="Days of their life">
            {days.map((d) => {
              const selected = d.day >= firstDay && d.day <= lastDay;
              const height = Math.max(2, Math.round((d.notable / maxNotable) * 28));
              return (
                <button
                  key={d.day}
                  type="button"
                  className={`ask-strip-bar ${selected ? 'is-on' : ''}`}
                  style={{ height }}
                  title={`Day ${d.day}: ${d.entries} things recorded`}
                  aria-label={`Day ${d.day}: ${d.entries} things recorded`}
                  onClick={() => pickDay(d.day)}
                />
              );
            })}
          </div>
        </div>

        <div className="ask-columns">
          <div className="ask-column ask-conversation">
            <h3>Conversation</h3>
            <div className="ask-scroll" ref={conversationRef}>
              {interviews.length === 0 && !asking && (
                <p className="muted">
                  Ask anything about {firstName}&apos;s life: what {subj} did, who {subj} spent time
                  with, how {subj} felt.
                </p>
              )}
              {interviews.map((i) => (
                <AnswerCard
                  key={i.id}
                  interview={i}
                  firstName={firstName}
                  lifeFrom={lifeFromTick}
                  lifeTo={lifeToTick}
                  onPeriod={(f, t) => {
                    setFrom(f);
                    setTo(t);
                  }}
                />
              ))}
              {asking && (
                <PendingAnswer
                  question={asking.question}
                  startedAt={asking.startedAt}
                  firstName={firstName}
                  her={poss}
                />
              )}
            </div>
            <div className="ask-composer">
              <div className="ask-suggest">
                {suggestionsFor(firstName, sex).map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    className="ask-chip"
                    disabled={asking !== null}
                    onClick={() => {
                      setText(s.text);
                      submit(s.text, s.period === 'life');
                    }}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
              <div className="ask-row">
                <textarea
                  aria-label="Question"
                  placeholder={`What did ${firstName} do?`}
                  rows={Math.min(4, Math.max(1, text.split('\n').length))}
                  value={text}
                  disabled={asking !== null}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={composerKey}
                />
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={asking !== null}
                  onClick={() => submit(text)}
                >
                  Ask
                </button>
              </div>
              <p className="muted small">
                Asks about {periodText}. Each paid answer costs a little and counts toward the cap.
              </p>
              {askError && <p className="warn">{askError}</p>}
            </div>
          </div>

          <div className="ask-column ask-record">
            <h3>The record · {periodText}</h3>
            <div className="ask-tabs" role="tablist" aria-label="Kind of record">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={kind === t.id}
                  className={`ask-tab ${kind === t.id ? 'is-on' : ''}`}
                  onClick={() => setKind(t.id)}
                >
                  {t.label} ({t.n})
                </button>
              ))}
            </div>
            <div className="ask-scroll">
              {recError && <p className="warn">{recError}</p>}
              {!data && !recError && <p className="muted">Loading the record…</p>}
              {data && data.entries.length === 0 && !loading && (
                <p className="muted">Nothing recorded in this period.</p>
              )}
              {data &&
                groups.map((g) => (
                  <div className="ask-day" key={g.day}>
                    <h4>Day {g.day}</h4>
                    {g.entries.map((e, i) => (
                      <RecordRow
                        key={`${e.tick}-${e.kind}-${i}`}
                        entry={e}
                        onShow={() => {
                          useWorld.getState().setReplayTarget(e.tick);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                ))}
              {data && data.entries.length < data.total && (
                <button
                  type="button"
                  className="btn btn-small ask-older"
                  disabled={moreBusy}
                  onClick={() => void loadOlder()}
                >
                  Load older ({data.total - data.entries.length} more)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordRow({ entry, onShow }: { entry: RecordEntry; onShow: () => void }) {
  const { hour, minute } = tickToClock(entry.tick);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return (
    <div
      className={`ask-line ask-line-${entry.kind} ${entry.forgotten ? 'is-forgotten' : ''}`}
      title={entry.forgotten ? 'Forgotten' : undefined}
    >
      <button
        type="button"
        className="linkish ask-time"
        title="Show the village at this moment"
        onClick={onShow}
      >
        {time}
      </button>
      <span className={`ask-kind ask-kind-${entry.kind}`}>{RECORD_KIND_LABELS[entry.kind]}</span>
      <span className="ask-text">{entry.kind === 'thought' ? `“${entry.text}”` : entry.text}</span>
    </div>
  );
}
