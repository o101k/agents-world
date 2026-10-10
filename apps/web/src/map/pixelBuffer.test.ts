import { describe, expect, it, vi } from 'vitest';
import { PixelBuffer, UNSUPPORTED, blit, fillRect, parseColor } from './pixelBuffer.ts';

/** The four bytes of the pixel at (x, y). */
function pixel(buf: PixelBuffer, x: number, y: number): number[] {
  const i = (y * buf.width + x) * 4;
  return [...buf.data.slice(i, i + 4)];
}

/** A buffer whose every pixel is the same colour. */
function filled(width: number, height: number, rgba: [number, number, number, number]) {
  const buf = new PixelBuffer(width, height);
  fillRect(buf, 0, 0, width, height, rgba);
  return buf;
}

describe('parseColor', () => {
  it('reads six-digit hex, in either case', () => {
    expect(parseColor('#1a2b3c')).toEqual([26, 43, 60, 255]);
    expect(parseColor('#FF8000')).toEqual([255, 128, 0, 255]);
  });

  it('reads three-digit hex, doubling each digit', () => {
    expect(parseColor('#ABC')).toEqual([170, 187, 204, 255]);
  });

  it('reads rgb() as opaque, with spaces allowed', () => {
    expect(parseColor('rgb(10, 20,30)')).toEqual([10, 20, 30, 255]);
  });

  it('reads rgba() with a 0–1 alpha, rounded to a byte', () => {
    expect(parseColor('rgba(20,14,10,0.85)')).toEqual([20, 14, 10, 217]);
    expect(parseColor('rgba(0, 0, 0, 0.25)')).toEqual([0, 0, 0, 64]);
    expect(parseColor('rgba(255,255,255,0)')).toEqual([255, 255, 255, 0]);
    expect(parseColor('rgba(1,2,3,1)')).toEqual([1, 2, 3, 255]);
  });

  it('caches the result', () => {
    expect(parseColor('#123456')).toBe(parseColor('#123456'));
  });

  it('paints anything it cannot read magenta', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      'red',
      '#12345',
      'hsl(0,0%,0%)',
      'rgba(1,2,3)',
      'rgb(1,2,3,0.5)',
      'rgb(300,0,0)',
      'rgba(1,2,3,1.5)',
      'rgba(-1,0,0,1)',
    ]) {
      expect(parseColor(bad), bad).toEqual(UNSUPPORTED);
    }
    warn.mockRestore();
  });
});

describe('fillRect', () => {
  it('overwrites with an opaque colour', () => {
    const buf = new PixelBuffer(3, 2);
    fillRect(buf, 1, 0, 2, 1, [9, 8, 7, 255]);
    expect(pixel(buf, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(buf, 1, 0)).toEqual([9, 8, 7, 255]);
    expect(pixel(buf, 2, 0)).toEqual([9, 8, 7, 255]);
    expect(pixel(buf, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('leaves pixels alone for a transparent colour', () => {
    const buf = filled(2, 2, [5, 5, 5, 255]);
    fillRect(buf, 0, 0, 2, 2, [9, 9, 9, 0]);
    expect(pixel(buf, 1, 1)).toEqual([5, 5, 5, 255]);
  });

  it('blends a half-transparent colour over an opaque pixel', () => {
    // 0.5 of red over opaque blue: 255 × 128/255 red, and the rest of the blue.
    const buf = filled(1, 1, [0, 0, 255, 255]);
    fillRect(buf, 0, 0, 1, 1, parseColor('rgba(255,0,0,0.5)'));
    expect(pixel(buf, 0, 0)).toEqual([128, 0, 127, 255]);
  });

  it('gives a half-transparent colour over nothing its own colour and alpha', () => {
    const buf = new PixelBuffer(1, 1);
    fillRect(buf, 0, 0, 1, 1, parseColor('rgba(255,0,0,0.5)'));
    expect(pixel(buf, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('blends a half-transparent colour over a half-transparent pixel', () => {
    // Out alpha 128 + 128 × (1 − 128/255) ≈ 192; the colour is mixed by each layer's share.
    const buf = filled(1, 1, [0, 0, 255, 128]);
    fillRect(buf, 0, 0, 1, 1, parseColor('rgba(255,0,0,0.5)'));
    expect(pixel(buf, 0, 0)).toEqual([170, 0, 85, 192]);
  });
});

describe('blit', () => {
  it('copies opaque source pixels and skips transparent ones', () => {
    const src = new PixelBuffer(2, 1);
    fillRect(src, 0, 0, 1, 1, [10, 20, 30, 255]);
    fillRect(src, 1, 0, 1, 1, [9, 9, 9, 0]);
    const dst = filled(2, 1, [1, 2, 3, 255]);
    blit(dst, 0, 0, src, 0, 0, 2, 1);
    expect(pixel(dst, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(dst, 1, 0)).toEqual([1, 2, 3, 255]);
  });

  it('blends half-transparent source pixels over what is there', () => {
    const src = new PixelBuffer(3, 1);
    fillRect(src, 0, 0, 1, 1, [10, 20, 30, 255]);
    fillRect(src, 1, 0, 1, 1, [9, 9, 9, 0]);
    fillRect(src, 2, 0, 1, 1, [255, 0, 0, 128]);
    const dst = filled(3, 1, [0, 0, 255, 255]);
    blit(dst, 0, 0, src, 0, 0, 3, 1);
    expect(pixel(dst, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(dst, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(dst, 2, 0)).toEqual([128, 0, 127, 255]);
  });

  it('copies a half-transparent pixel exactly onto a transparent one', () => {
    const src = filled(1, 1, [255, 0, 0, 128]);
    const dst = new PixelBuffer(1, 1);
    blit(dst, 0, 0, src, 0, 0, 1, 1);
    expect(pixel(dst, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('copies from a part of the source to a part of the destination', () => {
    const src = new PixelBuffer(4, 2);
    fillRect(src, 2, 1, 2, 1, [7, 7, 7, 255]);
    const dst = new PixelBuffer(3, 3);
    blit(dst, 1, 2, src, 2, 1, 2, 1);
    expect(pixel(dst, 1, 2)).toEqual([7, 7, 7, 255]);
    expect(pixel(dst, 2, 2)).toEqual([7, 7, 7, 255]);
    expect(pixel(dst, 0, 2)).toEqual([0, 0, 0, 0]);
    expect(pixel(dst, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('leaves out the parts that fall outside the destination', () => {
    const src = new PixelBuffer(2, 1);
    fillRect(src, 0, 0, 1, 1, [1, 0, 0, 255]);
    fillRect(src, 1, 0, 1, 1, [2, 0, 0, 255]);
    const dst = new PixelBuffer(2, 1);
    // Source column 0 lands at x = -1 (gone); source column 1 lands at x = 0.
    blit(dst, -1, 0, src, 0, 0, 2, 1);
    expect(pixel(dst, 0, 0)).toEqual([2, 0, 0, 255]);
    expect(pixel(dst, 1, 0)).toEqual([0, 0, 0, 0]);
  });
});
