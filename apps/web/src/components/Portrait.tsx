import { memo, useEffect, useRef } from 'react';
import type { Appearance } from '@aw/shared';
import { CHARACTER_PX, characterCanvas } from '../map/pixelArt.ts';

/** Painted character strips by look (keyed by the appearance JSON), so each look is painted once. */
const strips = new Map<string, HTMLCanvasElement>();
const MAX_STRIPS = 512;

function stripFor(key: string): HTMLCanvasElement {
  let strip = strips.get(key);
  if (!strip) {
    // Drop the oldest look when full; portraits already drawn keep their own pixels.
    if (strips.size >= MAX_STRIPS) strips.delete(strips.keys().next().value!);
    strip = characterCanvas(JSON.parse(key) as Appearance);
    strips.set(key, strip);
  }
  return strip;
}

interface PortraitProps {
  appearance: Appearance;
  size?: number;
  dead?: boolean;
}

/** Callers pass a new appearance object every frame, so compare the looks, not the objects. */
function sameLook(prev: PortraitProps, next: PortraitProps): boolean {
  const a = prev.appearance;
  const b = next.appearance;
  return (
    a.skin === b.skin &&
    a.hair === b.hair &&
    a.shirt === b.shirt &&
    a.pants === b.pants &&
    a.hairStyle === b.hairStyle &&
    prev.size === next.size &&
    prev.dead === next.dead
  );
}

/** A person's face-forward sprite, scaled up crisply. */
export const Portrait = memo(function Portrait({
  appearance,
  size = 48,
  dead = false,
}: PortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(appearance);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(stripFor(key), 0, 0, CHARACTER_PX, CHARACTER_PX, 0, 0, c.width, c.height);
  }, [key, size]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="portrait"
      style={{ width: size, height: size, filter: dead ? 'grayscale(1) opacity(0.6)' : undefined }}
    />
  );
}, sameLook);
