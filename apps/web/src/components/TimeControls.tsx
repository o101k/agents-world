import { SPEED_PRESETS, formatClock, speedLabel } from '@aw/shared';
import { api } from '../api.ts';
import { nightLevel } from '../map/renderer.ts';
import { useWorld } from '../worldStore.ts';

export function TimeControls({ worldId }: { worldId: string }) {
  const tick = useWorld((s) => s.tick);
  const runner = useWorld((s) => s.runner);
  const control = (req: { running?: boolean; speed?: number }) =>
    void api.control(worldId, req).catch(() => {});
  const night = nightLevel(tick) > 0.5;

  return (
    <div className="time-controls">
      <div className="topbar-clock" title="In-game time">
        <span aria-hidden>{night ? '☾' : '☀'}</span> {formatClock(tick)}
      </div>
      <button
        className={`btn ${runner.running ? '' : 'btn-primary'}`}
        onClick={() => control({ running: !runner.running })}
        title={runner.running ? 'Pause (Space)' : 'Play (Space)'}
        data-testid="play-pause"
      >
        {runner.running ? '❚❚ Pause' : '▶ Play'}
      </button>
      <div className="segmented" role="group" aria-label="Speed">
        {SPEED_PRESETS.map((s) => (
          <button
            key={s}
            className={`seg ${runner.speed === s ? 'is-on' : ''}`}
            onClick={() => control({ speed: s })}
            title={s === 0 ? 'As fast as possible' : `${s} in-game minutes per second`}
          >
            {speedLabel(s)}
          </button>
        ))}
      </div>
      {runner.running && (
        <div className="muted small speed-actual" title="Measured speed">
          {runner.thinking > 0
            ? `waiting on ${runner.thinking} mind${runner.thinking > 1 ? 's' : ''}…`
            : `${runner.actualSpeed} min/s`}
        </div>
      )}
    </div>
  );
}
