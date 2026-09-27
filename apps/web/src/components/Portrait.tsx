import { useEffect, useRef } from 'react';
import type { Appearance } from '@aw/shared';
import { CHARACTER_PX, characterCanvas } from '../map/pixelArt.ts';

/** A person's face-forward sprite, scaled up crisply. */
export function Portrait({
  appearance,
  size = 48,
  dead = false,
}: {
  appearance: Appearance;
  size?: number;
  dead?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(appearance);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(
      characterCanvas(JSON.parse(key) as Appearance),
      0,
      0,
      CHARACTER_PX,
      CHARACTER_PX,
      0,
      0,
      c.width,
      c.height,
    );
  }, [key]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="portrait"
      style={{ width: size, height: size, filter: dead ? 'grayscale(1) opacity(0.6)' : undefined }}
    />
  );
}
