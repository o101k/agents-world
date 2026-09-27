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

  // Fetch the asked-for moment; one request at a time, always catching up with the latest ask.
  const inFlight = useRef(false);
  const target = replay?.target;
  useEffect(() => {
    if (target === undefined || inFlight.current) return;
    const run = (tick: number) => {
      inFlight.current = true;
      const s = useWorld.getState();
      const shownMap = s.replay?.view?.mapVersion ?? s.mapVersion;
      api
        .replay(worldId, tick, shownMap)
        .then((view) => {
          useWorld.getState().setReplayView(view);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => {
          inFlight.current = false;
          const wanted = useWorld.getState().replay?.target;
          if (wanted !== undefined && wanted !== tick) run(wanted);
        });
    };
    run(target);
  }, [target, worldId]);

  // Playback through history.
  useEffect(() => {
    if (speed === null) return;
    const t = setInterval(() => {
      const s = useWorld.getState();
      if (!s.replay) return;
      const next = s.replay.target + speed;
      if (next >= s.tick) {
        setSpeed(null);
        s.setReplayTarget(s.tick);
      } else s.setReplayTarget(next);
    }, 250);
    return () => clearInterval(t);
  }, [speed]);

  if (!replay) return null;
  const view = replay.view;
  const first = view?.firstTick ?? 0;
  const jump = (minutes: number) =>
    setTarget(Math.max(first, Math.min(liveTick, replay.target + minutes)));

  return (
    <div className="replay-bar" role="region" aria-label="Replay">
      <span className="replay-badge">⏪ Replay</span>
      <span className="replay-clock" data-testid="replay-clock">
        {formatClock(view?.tick ?? replay.target)}
        {view?.calendar ? ` · ${view.calendar.season}` : ''}
        {view && view.tick !== replay.target ? ' …' : ''}
      </span>
      <button className="btn btn-small" onClick={() => jump(-1440)} title="Back one day">
        −1d
      </button>
      <button className="btn btn-small" onClick={() => jump(-60)} title="Back one hour">
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
      <button className="btn btn-small" onClick={() => jump(60)} title="Forward one hour">
        +1h
      </button>
      <button className="btn btn-small" onClick={() => jump(1440)} title="Forward one day">
        +1d
      </button>
      <div className="segmented" role="group" aria-label="Replay speed">
        {PLAY_SPEEDS.map((p) => (
          <button
            key={p.label}
            className={`seg ${speed === p.minutes ? 'is-on' : ''}`}
            onClick={() => setSpeed(speed === p.minutes ? null : p.minutes)}
            title={`Play history at ${p.label}`}
          >
            ▶ {p.label}
          </button>
        ))}
      </div>
      <button className="btn btn-small btn-primary" onClick={() => setTarget(null)}>
        Back to live
      </button>
      {error && <span className="warn small">{error}</span>}
    </div>
  );
}
