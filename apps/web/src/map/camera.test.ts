import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera, nextZoomStep, screenToTile, zoomAt } from './camera.ts';

describe('camera', () => {
  it('keeps the point under the cursor fixed when zooming', () => {
    const cam = { x: 100, y: 50, zoom: 2 };
    const before = { x: cam.x + 300 / cam.zoom, y: cam.y + 200 / cam.zoom };
    const next = zoomAt(cam, 300, 200, 4);
    expect(next.x + 300 / 4).toBeCloseTo(before.x);
    expect(next.y + 200 / 4).toBeCloseTo(before.y);
  });

  it('maps screen points to tiles', () => {
    expect(screenToTile({ x: 0, y: 0, zoom: 2 }, 33, 65, 16)).toEqual({ x: 1, y: 2 });
    expect(screenToTile({ x: -16, y: 0, zoom: 1 }, 0, 0, 16)).toEqual({ x: -1, y: 0 });
  });

  it('steps through zoom levels and stops at the ends', () => {
    expect(nextZoomStep(2, 1)).toBe(3);
    expect(nextZoomStep(2, -1)).toBe(1.5);
    expect(nextZoomStep(6, 1)).toBe(6);
    expect(nextZoomStep(0.5, -1)).toBe(0.5);
  });

  it('fits the world on screen', () => {
    const cam = fitCamera({ width: 1024, height: 1024 }, { width: 1200, height: 800 });
    expect(cam.zoom).toBe(0.75);
    expect(cam.x + 1200 / 2 / cam.zoom).toBeCloseTo(512);
  });

  it('never lets the world scroll fully off-screen', () => {
    const world = { width: 1000, height: 1000 };
    const screen = { width: 800, height: 600 };
    const far = clampCamera({ x: 99999, y: -99999, zoom: 1 }, world, screen);
    expect(far.x).toBeLessThanOrEqual(1000 - 64);
    expect(far.y + 600).toBeGreaterThanOrEqual(64);
  });
});
