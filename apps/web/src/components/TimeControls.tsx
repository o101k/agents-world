import { SPEED_PRESETS, formatClock, speedLabel, type Season } from '@aw/shared';

const SEASON_ICON: Record<Season, string> = {
  spring: '🌱',
  summer: '🌻',
  autumn: '🍂',
  winter: '❄',
};
import { api } from '../api.ts';
import { nightLevel } from '../map/renderer.ts';
import { useWorld } from '../worldStore.ts';

export function TimeControls({ worldId }: { worldId: string }) {
  const tick = useWorld((s) => s.tick);
  const runner = useWorld((s) => s.runner);
  const control = (req: { running?: boolean; speed?: number }) =>
    void api.control(worldId, req).catch(() => {});
  const night = nightLevel(tick) > 0.5;
  const calendar = useWorld((s) => s.calendar);

  return (
    <div className="time-controls">
      {calendar && (
        <div
          className={`season season-${calendar.season}`}
          title={`Year ${calendar.year}, ${calendar.season} (a year lasts as long as a year of age)`}
        >
          {SEASON_ICON[calendar.season]} {calendar.season[0]!.toUpperCase()}
          {calendar.season.slice(1)}, year {calendar.year}
        </div>
      )}
      <div className="topbar-clock" title="In-game time">
        <span aria-hidden>{night ? '☾' : '☀'}</span> {formatClock(tick)}
      </div>
      <button
        className={`btn play-pause ${runner.running ? '' : 'btn-primary'}`}
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
      <div
        className={`muted small speed-actual ${runner.running ? '' : 'is-hidden'}`}
        title="Measured speed"
        aria-hidden={!runner.running}
      >
        {runner.thinking > 0
          ? `waiting on ${runner.thinking} mind${runner.thinking > 1 ? 's' : ''}…`
          : `${runner.actualSpeed} min/s`}
      </div>
    </div>
  );
}
