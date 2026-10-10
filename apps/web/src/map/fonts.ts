import { BitmapFontManager, type TextStyleOptions } from 'pixi.js';

/**
 * Bitmap fonts for the people on the map: name labels, the "z z"/"…" markers and speech.
 *
 * A `Text` is drawn on its own canvas and uploaded to the GPU again whenever its text or style
 * changes. A `BitmapText` takes its glyphs from a shared atlas, so changing its text only lays out
 * quads again. Each look is installed once, with its colour and outline baked into the glyphs
 * (an outlined font can't be tinted, so the selected name gets its own font). Characters not
 * listed here are added to the atlas by Pixi when they first appear.
 */

export const LABEL_FONT = 'aw-label';
export const LABEL_SELECTED_FONT = 'aw-label-selected';
export const MARKER_FONT = 'aw-marker';
export const BUBBLE_FONT = 'aw-bubble';

/** The outline around names and markers. Their BitmapText styles repeat it so bounds match. */
export const OUTLINE_COLOR = '#0b0f14';
export const OUTLINE_WIDTH = 3;

/** Printable ASCII and the ellipsis. */
const CHARS = [[' ', '~'], '…'];
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, monospace';

let installed = false;

/** Installs the four map fonts. Only the first call does anything. */
export function ensureMapFonts(): void {
  if (installed) return;
  installed = true;
  const resolution = Math.max(2, window.devicePixelRatio || 1);
  const install = (name: string, style: TextStyleOptions): void => {
    // No kerning: Pixi measures it pair by pair (about 18,000 text measurements per font, a
    // visible stall at load), and at these sizes it moves a letter by a pixel at most.
    const font = BitmapFontManager.install({
      name,
      style,
      chars: CHARS,
      resolution,
      skipKerning: true,
    });
    // Text is drawn without mipmaps. Sampling a 2x atlas at 1x device pixels from a mip level
    // would soften the glyphs, so the pages are sampled from their full-size level instead.
    for (const page of font.pages) page.texture.source.autoGenerateMipmaps = false;
  };
  install(LABEL_FONT, {
    fontFamily: SANS,
    fontSize: 11,
    fontWeight: '600',
    fill: '#ffffff',
    stroke: { color: OUTLINE_COLOR, width: OUTLINE_WIDTH },
  });
  install(LABEL_SELECTED_FONT, {
    fontFamily: SANS,
    fontSize: 11,
    fontWeight: '600',
    fill: '#ffd84a',
    stroke: { color: OUTLINE_COLOR, width: OUTLINE_WIDTH },
  });
  install(MARKER_FONT, {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    fill: '#cfe3ff',
    stroke: { color: OUTLINE_COLOR, width: OUTLINE_WIDTH },
  });
  install(BUBBLE_FONT, { fontFamily: SANS, fontSize: 12, fill: '#1a1a1a' });
}
