import { useEffect, useRef, useState } from 'react';
import { formatClock } from '@aw/shared';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

const PLAY_SPEEDS = [
  { label: '10×', minutes: 2 },
  { label: '60×', minutes: 15 },
  { label: '600×', minutes: 150 },
];

/**
 * Replay: scrub the map back to any moment of the world's history. The helper rebuilds that
 * moment from its saved history (no AI calls); the live world carries on meanwhile.
 */
export function ReplayBar({ worldId }: { worldId: string }) {
  const replay = useWorld((s) => s.replay);
  const liveTick = useWorld((s) => s.tick);
  const setTarget = useWorld((s) => s.setReplayTarget);
  const [speed, setSpeed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stop playback whenever replay closes (e.g. from the topbar Live button or world switch).
  const isReplaying = replay !== null;
  useEffect(() => {
    if (!isReplaying) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/loading state when the fetch key changes
      setSpeed(null);
      setError(null);
    }
  }, [isReplaying]);

  // Fetch the asked-for moment; one request at a time, always catching up with the latest ask.
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, [worldId]);

  const target = replay?.target;
  const session = replay?.session;
  useEffect(() => {
    if (target === undefined || session === undefined || inFlight.current) return;
    const run = (tick: number, sess: number) => {
      inFlight.current = true;
      const ac = new AbortController();
      abortRef.current = ac;
      const s = useWorld.getState();
      const shownMap = s.replay?.view?.mapVersion ?? s.mapVersion;
      api
        .replay(worldId, tick, shownMap, ac.signal)
        .then((view) => {
          if (!alive.current) return;
          useWorld.getState().setReplayView(view, worldId, sess);
          setError(null);
        })
        .catch((e: Error) => {
          if (!alive.current || ac.signal.aborted) return;
          setError(e.message);
        })
        .finally(() => {
          inFlight.current = false;
          if (!alive.current) return;
          const next = useWorld.getState().replay;
          if (next && next.target !== tick) run(next.target, next.session);
        });
    };
    run(target, session);
  }, [target, session, worldId]);

  // Playback through history.
  useEffect(() => {
    if (speed === null || !isReplaying) return;
    const t = setInterval(() => {
      const s = useWorld.getState();
      if (!s.replay) {
        setSpeed(null);
        return;
      }
      const next = s.replay.target + speed;
      if (next >= s.tick) {
        setSpeed(null);
        s.setReplayTarget(s.tick);
      } else s.setReplayTarget(next);
    }, 250);
    return () => clearInterval(t);
  }, [speed, isReplaying]);

  if (!replay) return null;
  const view = replay.view;
  const first = view?.firstTick ?? 0;
  const jump = (minutes: number) => {
    setSpeed(null);
    setTarget(Math.max(first, Math.min(liveTick, replay.target + minutes)));
  };

  return (
    <div className="replay-bar" role="region" aria-label="Replay">
      <span className="replay-badge">⏪ Replay</span>
      <span className="replay-clock" data-testid="replay-clock">
        {formatClock(view?.tick ?? replay.target)}
        {view?.calendar ? ` · ${view.calendar.season}` : ''}
        {view && view.tick !== replay.target ? ' …' : ''}
      </span>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => jump(-1440)}
        title="Back one day"
      >
        −1d
      </button>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => jump(-60)}
        title="Back one hour"
      >
        −1h
      </button>
      <input
        type="range"
        className="replay-slider"
        min={first}
        max={Math.max(first, liveTick)}
        value={Math.min(replay.target, liveTick)}
        aria-label="Moment in history"
        onChange={(e) => {
          setSpeed(null);
          setTarget(Number(e.target.value));
        }}
      />
      <button
        type="button"
        className="btn btn-small"
        onClick={() => jump(60)}
        title="Forward one hour"
      >
        +1h
      </button>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => jump(1440)}
        title="Forward one day"
      >
        +1d
      </button>
      <div className="segmented" role="group" aria-label="Replay speed">
        {PLAY_SPEEDS.map((p) => (
          <button
            type="button"
            key={p.label}
            aria-pressed={speed === p.minutes}
            className={`seg ${speed === p.minutes ? 'is-on' : ''}`}
            onClick={() => setSpeed(speed === p.minutes ? null : p.minutes)}
            title={`Play history at ${p.label}`}
          >
            ▶ {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-small btn-primary"
        onClick={() => {
          setSpeed(null);
          setTarget(null);
        }}
      >
        Back to live
      </button>
      {error && (
        <span className="warn small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
