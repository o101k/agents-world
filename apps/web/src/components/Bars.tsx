export function Bar({
  label,
  value,
  max = 100,
  tone,
}: {
  label: string;
  value: number;
  max?: number;
  /** auto: colour by level (high = good); neutral: one colour; bad: a warning colour. */
  tone?: 'auto' | 'neutral' | 'bad';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    tone === 'bad'
      ? 'var(--bar-bad)'
      : tone === 'neutral'
        ? 'var(--bar-neutral)'
        : pct < 20
          ? 'var(--bar-bad)'
          : pct < 45
            ? 'var(--bar-warn)'
            : 'var(--bar-good)';
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span
        className="bar-track"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <span className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="bar-value">{Math.round(value)}</span>
    </div>
  );
}
