import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BrainConfig, InterviewView, Sex } from '@aw/shared';
import { api } from '../api.ts';
import {
  periodPresets,
  pronounsFor,
  shortProvider,
  suggestionsFor,
  type PeriodPresetId,
} from '../ask.ts';
import { describeBrain } from '../brainLabels.ts';
import { useSettings } from '../settingsStore.ts';
import './ask.css';
import { AnswerCard, PendingAnswer, useAsk } from './AnswerCard.tsx';
import { AskDialog } from './AskDialog.tsx';

/** The person's clock and life span, as the inspector needs it to draw period chips. */
interface AskMeta {
  lifeFromTick: number;
  lifeToTick: number;
  nowTick: number;
  daysPerYear: number;
}

/** "Ask about Anna" in the inspector: a question box, period chips and the latest answer. */
export function AskSection({
  worldId,
  agentId,
  firstName,
  fullName,
  sex,
  alive,
  brain,
  atTick,
}: {
  worldId: string;
  agentId: string;
  firstName: string;
  fullName: string;
  sex: Sex;
  alive: boolean;
  brain: BrainConfig;
  /** Replay: the moment being shown; periods are measured from it. */
  atTick?: number;
}) {
  const { poss: her } = pronounsFor(sex);
  const providers = useSettings((s) => s.settings?.providers);
  const settingsLoaded = useSettings((s) => s.settings !== null);
  const loadSettings = useSettings((s) => s.load);
  const [meta, setMeta] = useState<AskMeta | null>(null);
  const [interviews, setInterviews] = useState<InterviewView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PeriodPresetId>('today');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const onAsked = useCallback((i: InterviewView) => setInterviews((prev) => [...prev, i]), []);
  const { asking, error, ask } = useAsk(worldId, agentId, onAsked);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [worldId, agentId]);

  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);

  // Load once per person. The inspector polls every 600 ms, so nothing here may depend on it.
  useEffect(() => {
    let cancelled = false;
    api
      .interviews(worldId, agentId)
      .then((r) => {
        if (cancelled) return;
        setMeta(toMeta(r));
        setInterviews(r.interviews);
        setLoadError(null);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [worldId, agentId]);

  if (!meta) {
    return (
      <section className="ask-section">
        <h3>Ask about {firstName}</h3>
        {loadError ? (
          <p className="warn" role="alert">
            {loadError}
          </p>
        ) : (
          <p className="muted small">Loading…</p>
        )}
      </section>
    );
  }

  const busy = submitting || asking !== null;
  const nowTick = atTick ?? meta.lifeToTick;
  const presets = periodPresets(nowTick, meta.lifeFromTick, meta.lifeToTick, meta.daysPerYear);
  const shown = presets.filter((p) => p.available);
  const latest = interviews[interviews.length - 1];

  // Refresh the clock first for the living, so "Today" follows the world's time.
  const submit = async (question: string, wholeLife = false) => {
    if (submittingRef.current || asking !== null) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const q = question.trim();
      let m = meta;
      if (alive) {
        try {
          m = toMeta(await api.interviews(worldId, agentId));
          if (!mountedRef.current) return;
          setMeta(m);
        } catch {
          // Keep the last clock; the ask itself will report a real problem.
        }
      }
      if (!mountedRef.current) return;
      const period = wholeLife
        ? { from: m.lifeFromTick, to: m.lifeToTick }
        : periodFor(m, presetId, atTick);
      if (wholeLife) setPresetId('life');
      const ok = await ask(q, period.from, period.to);
      if (ok && mountedRef.current) setText('');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) void submit(text);
    }
  };

  const rows = Math.min(4, Math.max(1, text.split('\n').length));
  const desc = describeBrain(brain, providers);
  const brainLine =
    brain.provider === 'mock'
      ? 'Free summary from the record (Mock brain).'
      : desc.notSetUp
        ? `${shortProvider(desc.title)} isn't set up, so you'll get the free summary.`
        : `Answered by ${firstName}'s own brain (${shortProvider(desc.title)}, ${brain.model || 'default model'}). Each answer costs a little and counts toward the cap.`;

  return (
    <section className="ask-section">
      <h3>Ask about {firstName}</h3>
      <div className="ask-row">
        <textarea
          aria-label="Question"
          placeholder={`What did ${firstName} do?`}
          rows={rows}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={() => void submit(text)}
        >
          Ask
        </button>
      </div>

      <div className="ask-tabs ask-periods" role="group" aria-label="Period">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`ask-tab ${presetId === p.id ? 'is-on' : ''}`}
            aria-pressed={presetId === p.id}
            onClick={() => setPresetId(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="ask-tab ask-tab-more" onClick={() => setDialogOpen(true)}>
          Pick days…
        </button>
      </div>

      <div className="ask-suggest">
        {suggestionsFor(firstName, sex)
          .slice(0, 3)
          .map((s) => (
            <button
              key={s.text}
              type="button"
              className="ask-chip"
              disabled={busy}
              onClick={() => {
                setText(s.text);
                void submit(s.text, s.period === 'life');
              }}
            >
              {s.text}
            </button>
          ))}
      </div>

      <p className="muted small ask-brain">{brainLine}</p>

      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      {asking && (
        <PendingAnswer
          question={asking.question}
          startedAt={asking.startedAt}
          firstName={firstName}
          her={her}
        />
      )}
      {latest && (
        <AnswerCard
          interview={latest}
          firstName={firstName}
          lifeFrom={meta.lifeFromTick}
          lifeTo={meta.lifeToTick}
          clamp
          onMore={() => setDialogOpen(true)}
        />
      )}

      <button type="button" className="linkish ask-all" onClick={() => setDialogOpen(true)}>
        {interviews.length
          ? `${interviews.length === 1 ? 'Your answer' : `All ${interviews.length} answers`} and ${her} full record →`
          : `${capitalize(her)} full record, day by day →`}
      </button>

      {dialogOpen && (
        <AskDialog
          worldId={worldId}
          agentId={agentId}
          firstName={firstName}
          fullName={fullName}
          sex={sex}
          brain={brain}
          atTick={atTick}
          lifeFromTick={meta.lifeFromTick}
          lifeToTick={meta.lifeToTick}
          nowTick={nowTick}
          daysPerYear={meta.daysPerYear}
          initialFrom={periodFor(meta, presetId, atTick).from}
          initialTo={periodFor(meta, presetId, atTick).to}
          interviews={interviews}
          onAsked={onAsked}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

/** The chosen preset's period; if it isn't available (e.g. yesterday for a newborn), today. */
function periodFor(m: AskMeta, id: PeriodPresetId, atTick: number | undefined) {
  const presets = periodPresets(
    atTick ?? m.lifeToTick,
    m.lifeFromTick,
    m.lifeToTick,
    m.daysPerYear,
  );
  return presets.find((p) => p.id === id && p.available) ?? presets.find((p) => p.id === 'today')!;
}

function toMeta(r: {
  lifeFromTick: number;
  lifeToTick: number;
  nowTick: number;
  daysPerYear: number;
}): AskMeta {
  return {
    lifeFromTick: r.lifeFromTick,
    lifeToTick: r.lifeToTick,
    nowTick: r.nowTick,
    daysPerYear: r.daysPerYear,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
