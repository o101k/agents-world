/**
 * Camera maths, kept free of PixiJS so it can be unit-tested.
 * (x, y) is the world pixel shown at the top-left corner of the screen; zoom is screen px per world px.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Discrete zoom steps keep pixel art crisp (whole or half-pixel multiples). */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6] as const;

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

export function screenToTile(cam: Camera, sx: number, sy: number, tilePx: number) {
  const w = screenToWorld(cam, sx, sy);
  return { x: Math.floor(w.x / tilePx), y: Math.floor(w.y / tilePx) };
}

/** Zoom to `zoom` while keeping the world point under the screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, zoom: number): Camera {
  const w = screenToWorld(cam, sx, sy);
  return { x: w.x - sx / zoom, y: w.y - sy / zoom, zoom };
}

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0)
    return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? ZOOM_STEPS[0];
}

/** Largest zoom step at which the whole world fits on screen, centred. */
export function fitCamera(world: Size, screen: Size): Camera {
  const fit = Math.min(screen.width / world.width, screen.height / world.height);
  const zoom = [...ZOOM_STEPS].reverse().find((z) => z <= fit) ?? ZOOM_STEPS[0];
  return centerOn(world.width / 2, world.height / 2, zoom, screen);
}

export function centerOn(wx: number, wy: number, zoom: number, screen: Size): Camera {
  return { x: wx - screen.width / 2 / zoom, y: wy - screen.height / 2 / zoom, zoom };
}

/** Keep at least `margin` screen pixels of the world visible so it can't be lost off-screen. */
export function clampCamera(cam: Camera, world: Size, screen: Size, margin = 64): Camera {
  const viewW = screen.width / cam.zoom;
  const viewH = screen.height / cam.zoom;
  const m = margin / cam.zoom;
  const x = Math.min(Math.max(cam.x, m - viewW), world.width - m);
  const y = Math.min(Math.max(cam.y, m - viewH), world.height - m);
  return { ...cam, x, y };
}
