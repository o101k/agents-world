/**
 * RGBA pixels in a plain byte array (not premultiplied, like ImageData). Sprites are painted
 * here, then the finished image goes to a canvas once. Drawing on a 2D canvas costs a CSS colour
 * parse and a call per pixel, which is what made loading the map slow. This file has no DOM, so
 * it can be tested in Node.
 */

/** Red, green, blue and alpha, each 0–255. */
export type Rgba = readonly [number, number, number, number];

export class PixelBuffer {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly data = new Uint8ClampedArray(width * height * 4),
  ) {}
}

const colours = new Map<string, Rgba>();

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const FUNCTION = /^(rgba?)\((.*)\)$/i;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)$/;

/**
 * Reads a colour written as '#rrggbb', '#rgb', 'rgb(r,g,b)' or 'rgba(r,g,b,a)' (alpha 0–1).
 * Results are cached, since the same few colours are asked for again and again. Anything else
 * is painted magenta (and logged once), so a bad colour shows up without breaking the map.
 */
export function parseColor(c: string): Rgba {
  const hit = colours.get(c);
  if (hit) return hit;
  const parsed = parse(c);
  colours.set(c, parsed);
  return parsed;
}

function parse(c: string): Rgba {
  const hex6 = HEX6.exec(c);
  if (hex6) {
    const n = parseInt(hex6[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const hex3 = HEX3.exec(c);
  if (hex3) {
    // '#abc' means '#aabbcc'.
    const r = parseInt(hex3[1]! + hex3[1]!, 16);
    const g = parseInt(hex3[2]! + hex3[2]!, 16);
    const b = parseInt(hex3[3]! + hex3[3]!, 16);
    return [r, g, b, 255];
  }
  const fn = FUNCTION.exec(c.trim());
  if (fn) {
    const hasAlpha = fn[1]!.toLowerCase() === 'rgba';
    const parts = fn[2]!.split(',').map((s) => s.trim());
    if (parts.length === (hasAlpha ? 4 : 3) && parts.every((p) => NUMBER.test(p))) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = hasAlpha ? Number(parts[3]) : 1;
      if (r <= 255 && g <= 255 && b <= 255 && a <= 1) {
        return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
      }
    }
  }
  console.warn(`Unsupported colour "${c}", painted magenta`);
  return UNSUPPORTED;
}

/** What a colour that can't be read is painted with. */
export const UNSUPPORTED: Rgba = [255, 0, 255, 255];

/**
 * Blends one source pixel over the pixel at byte index `i` with source-over, as a canvas does:
 * out alpha = a + dstA × (1 − a); out colour = (src × a + dst × dstA × (1 − a)) / outA. `alpha` is
 * the source's byte alpha (1–255).
 */
function blendOver(
  d: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const dstA = d[i + 3]!;
  if (dstA === 0) {
    // Over nothing the source is the result, exactly (and no divide by a small number).
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = alpha;
    return;
  }
  const a = alpha / 255;
  const keep = (dstA / 255) * (1 - a);
  const outA = a + keep;
  d[i] = Math.round((r * a + d[i]! * keep) / outA);
  d[i + 1] = Math.round((g * a + d[i + 1]! * keep) / outA);
  d[i + 2] = Math.round((b * a + d[i + 2]! * keep) / outA);
  d[i + 3] = Math.round(outA * 255);
}

/**
 * Paints a w×h rectangle at (x, y) with a colour. Callers clip to the buffer; the coordinates
 * are whole numbers and inside the buffer.
 */
export function fillRect(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  rgba: Rgba,
): void {
  const [r, g, b, a] = rgba;
  if (a === 0) return;
  const d = buf.data;
  const stride = buf.width * 4;
  for (let yy = y; yy < y + h; yy++) {
    let i = yy * stride + x * 4;
    if (a === 255) {
      // Opaque paint replaces whatever was there.
      for (let k = 0; k < w; k++, i += 4) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    } else {
      for (let k = 0; k < w; k++, i += 4) blendOver(d, i, r, g, b, a);
    }
  }
}

/**
 * Copies a w×h rectangle from `src` (at sx, sy) onto `dst` (at dx, dy), blending each pixel
 * over what is there. Parts that fall outside either buffer are left out, as drawImage does.
 */
export function blit(
  dst: PixelBuffer,
  dx: number,
  dy: number,
  src: PixelBuffer,
  sx: number,
  sy: number,
  w: number,
  h: number,
): void {
  if (sx < 0) {
    w += sx;
    dx -= sx;
    sx = 0;
  }
  if (sy < 0) {
    h += sy;
    dy -= sy;
    sy = 0;
  }
  if (dx < 0) {
    w += dx;
    sx -= dx;
    dx = 0;
  }
  if (dy < 0) {
    h += dy;
    sy -= dy;
    dy = 0;
  }
  w = Math.min(w, src.width - sx, dst.width - dx);
  h = Math.min(h, src.height - sy, dst.height - dy);
  if (w <= 0 || h <= 0) return;
  const s = src.data;
  const d = dst.data;
  for (let row = 0; row < h; row++) {
    let si = ((sy + row) * src.width + sx) * 4;
    let di = ((dy + row) * dst.width + dx) * 4;
    for (let col = 0; col < w; col++, si += 4, di += 4) {
      const alpha = s[si + 3]!;
      if (alpha === 0) continue;
      if (alpha === 255) {
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = 255;
      } else {
        blendOver(d, di, s[si]!, s[si + 1]!, s[si + 2]!, alpha);
      }
    }
  }
}
