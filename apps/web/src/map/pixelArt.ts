/**
 * Procedural pixel art. Every sprite is painted in code at 16 px per tile, so the game
 * needs no downloaded assets. A real tileset pack can replace these later: the renderer only
 * asks for sprites by name (see SpriteName) and doesn't care where the pixels come from.
 */

import { PixelBuffer, fillRect, parseColor } from './pixelBuffer.ts';

export const TILE_PX = 16;

type Color = string;

/** Deterministic per-pixel noise so each variant looks the same every time. */
function noise(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paints into a PixelBuffer, inside the box (ox, oy, w, h) of it. Pixels go straight into the
 * buffer's bytes: a canvas would parse a CSS colour and make a call for every pixel.
 */
export class Painter {
  constructor(
    readonly buf: PixelBuffer,
    readonly ox = 0,
    readonly oy = 0,
    readonly w = buf.width,
    readonly h = buf.height,
  ) {}

  px(x: number, y: number, c: Color): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    fillRect(this.buf, this.ox + x, this.oy + y, 1, 1, parseColor(c));
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    fillRect(this.buf, this.ox + x0, this.oy + y0, x1 - x0, y1 - y0, parseColor(c));
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
    }
  }

  /** Fill a region with a base colour sprinkled with darker/lighter pixels. */
  speckle(
    x: number,
    y: number,
    w: number,
    h: number,
    base: Color,
    dots: [Color, number][],
    seed: number,
  ) {
    this.rect(x, y, w, h, base);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        let r = noise(xx, yy, seed);
        for (const [c, p] of dots) {
          if (r < p) {
            this.px(xx, yy, c);
            break;
          }
          r -= p;
        }
      }
    }
  }
}

export interface SpriteDef {
  w: number;
  h: number;
  /** Anchor in sprite pixels, placed at the bottom-left of the object's footprint. Default (0, h). */
  anchorY?: number;
  paint: (p: Painter) => void;
}

// ---------------------------------------------------------------- ground tiles

const GRASS = { base: '#5b9b3f', dark: '#4c8735', light: '#6cb04b' };

function grass(seed: number, extra?: (p: Painter) => void): SpriteDef {
  return {
    w: 16,
    h: 16,
    paint: (p) => {
      p.speckle(
        0,
        0,
        16,
        16,
        GRASS.base,
        [
          [GRASS.dark, 0.1],
          [GRASS.light, 0.07],
        ],
        seed,
      );
      extra?.(p);
    },
  };
}

const flowers = (colors: Color[]) => (p: Painter) => {
  const spots = [
    [3, 4],
    [11, 2],
    [7, 11],
    [13, 12],
  ] as const;
  spots.forEach(([x, y], i) => {
    const c = colors[i % colors.length] as Color;
    p.px(x, y, c);
    p.px(x + 1, y, '#2f6e2e');
  });
};

const tuft = (p: Painter) => {
  for (const [x, y] of [
    [4, 9],
    [10, 5],
  ] as const) {
    p.px(x, y, GRASS.dark);
    p.px(x + 1, y - 1, GRASS.dark);
    p.px(x + 2, y, GRASS.dark);
    p.px(x + 1, y, '#3d7a2b');
  }
};

function water(seed: number): SpriteDef {
  return {
    w: 16,
    h: 16,
    paint: (p) => {
      p.speckle(0, 0, 16, 16, '#3a78c9', [['#3269b3', 0.12]], seed);
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(noise(i, 1, seed) * 12);
        const y = 2 + i * 5 + Math.floor(noise(i, 2, seed) * 2);
        p.rect(x, y, 3, 1, '#6aa3e3');
        p.px(x + 1, y, '#a8d0f5');
      }
    },
  };
}

/** Light foam strip where water meets land; one sprite per side. */
function foam(side: 'n' | 'e' | 's' | 'w'): SpriteDef {
  return {
    w: 16,
    h: 16,
    paint: (p) => {
      for (let i = 0; i < 16; i++) {
        const deep = noise(i, 9, side.charCodeAt(0)) < 0.35 ? 2 : 1;
        for (let d = 0; d < deep; d++) {
          const c = d === 0 ? '#cfe8fa' : '#8cc0ee';
          if (side === 'n') p.px(i, d, c);
          if (side === 's') p.px(i, 15 - d, c);
          if (side === 'w') p.px(d, i, c);
          if (side === 'e') p.px(15 - d, i, c);
        }
      }
    },
  };
}

const sand = (seed: number): SpriteDef => ({
  w: 16,
  h: 16,
  paint: (p) =>
    p.speckle(
      0,
      0,
      16,
      16,
      '#d9c48c',
      [
        ['#c4ad72', 0.12],
        ['#e8d6a4', 0.08],
      ],
      seed,
    ),
});

const path = (seed: number): SpriteDef => ({
  w: 16,
  h: 16,
  paint: (p) => {
    p.speckle(
      0,
      0,
      16,
      16,
      '#b48c5c',
      [
        ['#9c7648', 0.12],
        ['#c9a272', 0.08],
        ['#8a8a82', 0.015],
      ],
      seed,
    );
  },
});

const farmland: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.speckle(0, 0, 16, 16, '#7b5431', [['#8e6540', 0.1]], 77);
    for (const y of [1, 5, 9, 13]) p.rect(0, y, 16, 1, '#5f3f22');
  },
};

const crops: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    for (const y of [3, 7, 11, 15]) {
      for (const x of [2, 6, 10, 14]) {
        p.px(x, y, '#4f8f2c');
        p.px(x - 1, y - 1, '#7cc04a');
        p.px(x + 1, y - 1, '#7cc04a');
        p.px(x, y - 2, '#9ad85e');
      }
    }
  },
};

const bridge: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.rect(0, 0, 16, 16, '#a0703e');
    for (let x = 3; x < 16; x += 4) p.rect(x, 0, 1, 16, '#6e4a26');
    p.rect(0, 0, 16, 2, '#5a3a1c');
    p.rect(0, 14, 16, 2, '#5a3a1c');
    p.rect(0, 2, 16, 1, '#c08850');
  },
};

// ---------------------------------------------------------------- nature

function tree(canopy: [Color, Color, Color]): SpriteDef {
  const [mid, dark, light] = canopy;
  return {
    w: 16,
    h: 24,
    paint: (p) => {
      p.ellipse(8, 22.5, 6, 1.8, 'rgba(0,0,0,0.25)');
      p.rect(7, 16, 3, 7, '#6b4423');
      p.rect(7, 16, 1, 7, '#83562e');
      p.ellipse(8, 10, 7.5, 7.5, '#24502a');
      p.ellipse(8, 10, 6.8, 6.8, mid);
      p.ellipse(9.5, 12, 4.5, 4, dark);
      p.ellipse(6, 7.5, 3, 2.5, light);
      p.px(5, 6, '#9ad26a');
    },
  };
}

const pine: SpriteDef = {
  w: 16,
  h: 24,
  paint: (p) => {
    p.ellipse(8, 22.5, 5, 1.6, 'rgba(0,0,0,0.25)');
    p.rect(7, 18, 2, 5, '#5e3b1e');
    const layers = [
      [3, 6],
      [7, 10],
      [11, 14],
    ] as const;
    layers.forEach(([top, bottom], i) => {
      for (let y = top - 2; y <= bottom + 3; y++) {
        const half = Math.max(0, Math.round(((y - top + 2) / (bottom - top + 5)) * (4 + i * 1.5)));
        p.rect(8 - half, y, half * 2, 1, '#2f6e44');
        p.px(8 - half, y, '#1f4f30');
        p.px(8 + half - 1, y, '#3f8a56');
      }
    });
  },
};

const berryBush: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.ellipse(8, 14, 6, 1.5, 'rgba(0,0,0,0.22)');
    p.ellipse(8, 10, 6.5, 5, '#2c5e28');
    p.ellipse(8, 9.6, 5.8, 4.4, '#4a9a3e');
    p.ellipse(6, 8, 2.5, 1.8, '#63b152');
    for (const [x, y] of [
      [5, 10],
      [9, 7],
      [11, 11],
      [7, 12],
      [12, 8],
    ] as const) {
      p.px(x, y, '#d8344a');
      p.px(x, y - 1, '#f07a88');
    }
  },
};

const berryBushEmpty: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.ellipse(8, 14, 6, 1.5, 'rgba(0,0,0,0.22)');
    p.ellipse(8, 10, 6.5, 5, '#2c5e28');
    p.ellipse(8, 9.6, 5.8, 4.4, '#4a9a3e');
    p.ellipse(6, 8, 2.5, 1.8, '#63b152');
  },
};

const grave: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.ellipse(8, 14, 5, 1.5, 'rgba(0,0,0,0.25)');
    p.rect(5, 12, 7, 2, '#6b4a2a');
    p.ellipse(8, 6.5, 3.5, 3, '#5a5a58');
    p.rect(5, 6, 7, 7, '#5a5a58');
    p.ellipse(8, 6.5, 2.8, 2.4, '#9a9a94');
    p.rect(6, 6, 5, 6, '#9a9a94');
    p.rect(8, 7, 1, 4, '#5a5a58');
    p.rect(7, 8, 3, 1, '#5a5a58');
  },
};

const rock: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.ellipse(8, 13.5, 6, 1.6, 'rgba(0,0,0,0.22)');
    p.ellipse(8, 10, 6, 4.5, '#5a5a55');
    p.ellipse(8, 9.6, 5.4, 4, '#8e8e86');
    p.ellipse(9.5, 11, 3.5, 2.2, '#6c6c66');
    p.ellipse(6, 8, 2, 1.4, '#b0b0a8');
  },
};

// ---------------------------------------------------------------- buildings

const ROOFS: [Color, Color, Color][] = [
  ['#b5473a', '#8e342a', '#d0685a'], // red tiles
  ['#4a6aa0', '#374f7a', '#6a8cc4'], // blue slate
  ['#8a5a3a', '#6a4228', '#a8764e'], // brown shingles
  ['#4f7f4a', '#3a6036', '#6c9e62'], // moss
  ['#b98a3a', '#8e6828', '#d6a95a'], // thatch
];
export const HOUSE_VARIANTS = ROOFS.length;

function roof(p: Painter, w: number, h: number, [mid, dark, light]: [Color, Color, Color]) {
  p.rect(0, 0, w, h, mid);
  const ridge = Math.floor(h * 0.42);
  p.rect(0, 0, w, ridge, light);
  for (let y = 3; y < h; y += 4) {
    p.rect(1, y, w - 2, 1, dark);
    for (let x = y % 8 === 3 ? 2 : 5; x < w - 1; x += 6) p.px(x, y - 1, dark);
  }
  p.rect(0, ridge, w, 1, dark);
  p.rect(0, 0, w, 1, '#3a2a20');
  p.rect(0, 0, 1, h, '#3a2a20');
  p.rect(w - 1, 0, 1, h, '#3a2a20');
  p.rect(0, h - 1, w, 1, '#2a1e16');
  p.rect(1, h, w - 2, 1, 'rgba(0,0,0,0.25)'); // shadow cast on the wall
}

function window(p: Painter, x: number, y: number) {
  p.rect(x, y, 8, 7, '#5a4028');
  p.rect(x + 1, y + 1, 6, 5, '#9fd0f0');
  p.rect(x + 1, y + 1, 2, 2, '#d6eefc');
  p.rect(x + 4, y + 1, 1, 5, '#5a4028');
  p.rect(x + 1, y + 3, 6, 1, '#5a4028');
}

function door(p: Painter, x: number, y: number, w = 8) {
  p.rect(x, y, w, 48 - y, '#4a2c14');
  p.rect(x + 1, y + 1, w - 2, 47 - y, '#7a4a24');
  p.rect(x + w / 2, y + 1, 1, 47 - y, '#5a3418');
  p.px(x + w - 3, y + 6, '#e0c060');
}

function house(variant: number): SpriteDef {
  return {
    w: 48,
    h: 48,
    paint: (p) => {
      // Wall
      p.rect(0, 28, 48, 20, '#d8c8a0');
      p.speckle(1, 29, 46, 18, '#d8c8a0', [['#cbb88e', 0.08]], variant + 3);
      p.rect(0, 28, 2, 20, '#7a5a3a');
      p.rect(46, 28, 2, 20, '#7a5a3a');
      p.rect(0, 46, 48, 2, '#6b5537');
      window(p, 5, 33);
      window(p, 35, 33);
      door(p, 20, 34);
      roof(p, 48, 30, ROOFS[variant % ROOFS.length] as [Color, Color, Color]);
      if (variant % 2 === 0) {
        p.rect(36, 2, 6, 9, '#7a6a60');
        p.rect(36, 2, 6, 2, '#4a4040');
      }
    },
  };
}

/** A house with the roof lifted off: you look down into the room (drawn while someone is inside). */
function houseOpen(variant: number): SpriteDef {
  const [mid, dark, light] = ROOFS[variant % ROOFS.length] as [Color, Color, Color];
  return {
    w: 48,
    h: 48,
    paint: (p) => {
      // Wooden floor
      p.rect(0, 8, 48, 40, '#b08a58');
      for (let y = 10; y < 48; y += 5) p.rect(2, y, 44, 1, '#94703f');
      p.speckle(2, 9, 44, 38, '#b08a58', [['#a07c4c', 0.1]], variant + 21);
      // Back wall with the roof colour as trim, a small window and a hearth
      p.rect(0, 0, 48, 10, '#d8c8a0');
      p.rect(0, 0, 48, 2, dark);
      p.rect(0, 2, 48, 1, mid);
      p.rect(0, 3, 48, 1, light);
      p.rect(0, 9, 48, 1, '#6b5537');
      p.rect(4, 4, 9, 5, '#5a4028');
      p.rect(5, 5, 7, 3, '#9fd0f0');
      p.rect(8, 5, 1, 3, '#5a4028');
      p.rect(19, 3, 10, 7, '#6a6660');
      p.rect(21, 5, 6, 5, '#2a2420');
      p.rect(22, 7, 4, 3, '#ff9a2a');
      p.rect(23, 8, 2, 2, '#ffd860');
      p.rect(0, 10, 48, 2, 'rgba(0,0,0,0.22)'); // shadow under the back wall
      // Bed
      p.rect(3, 13, 13, 11, '#6a4424');
      p.rect(4, 14, 11, 9, '#e8e0d0');
      p.rect(4, 14, 4, 9, '#f6f2ea');
      p.rect(8, 17, 7, 6, mid);
      p.rect(8, 17, 7, 1, light);
      // Table with a stool
      p.rect(32, 14, 12, 8, '#7a5230');
      p.rect(33, 15, 10, 6, '#a47440');
      p.rect(34, 16, 3, 2, '#e8d8b0');
      p.rect(33, 22, 2, 3, '#5a3a1c');
      p.rect(41, 22, 2, 3, '#5a3a1c');
      p.rect(36, 26, 5, 4, '#8a6238');
      // Doormat in the doorway
      p.rect(20, 40, 8, 8, '#8a4a2a');
      p.rect(21, 41, 6, 7, '#a8603a');
      // Side walls and low front wall with the doorway gap
      p.rect(0, 0, 2, 48, '#7a5a3a');
      p.rect(46, 0, 2, 48, '#7a5a3a');
      p.rect(2, 41, 18, 7, '#d8c8a0');
      p.rect(28, 41, 18, 7, '#d8c8a0');
      p.rect(2, 41, 18, 1, '#f0e4c4');
      p.rect(28, 41, 18, 1, '#f0e4c4');
      p.rect(0, 46, 20, 2, '#6b5537');
      p.rect(28, 46, 20, 2, '#6b5537');
      p.rect(19, 41, 1, 7, '#6b5537');
      p.rect(28, 41, 1, 7, '#6b5537');
    },
  };
}

const bakery: SpriteDef = {
  w: 64,
  h: 48,
  paint: (p) => {
    p.rect(0, 28, 64, 20, '#e0cfa8');
    p.speckle(1, 29, 62, 18, '#e0cfa8', [['#d0bd92', 0.08]], 11);
    p.rect(0, 28, 2, 20, '#7a5a3a');
    p.rect(62, 28, 2, 20, '#7a5a3a');
    window(p, 6, 33);
    window(p, 50, 33);
    door(p, 36, 34);
    roof(p, 64, 30, ['#c8702e', '#9a5420', '#e08e4a']);
    p.rect(48, 0, 8, 10, '#8a6a5a');
    p.rect(48, 0, 8, 2, '#4a3a34');
    p.ellipse(52, -1, 3, 2, 'rgba(230,230,230,0.8)');
    // Hanging sign with a loaf
    p.rect(20, 33, 12, 8, '#5a3a1c');
    p.rect(21, 34, 10, 6, '#e8d8b0');
    p.ellipse(26, 37, 4, 2, '#8a4a1a');
    p.ellipse(26, 36.6, 3.4, 1.5, '#d9a55a');
  },
};

const workshop: SpriteDef = {
  w: 64,
  h: 48,
  paint: (p) => {
    p.rect(0, 28, 64, 20, '#9a7048');
    for (let x = 0; x < 64; x += 5) p.rect(x, 28, 1, 20, '#7a5434');
    p.rect(0, 46, 64, 2, '#5a3a1c');
    window(p, 6, 33);
    // Wide double door
    p.rect(33, 32, 14, 16, '#3a2410');
    p.rect(34, 33, 6, 15, '#6a4020');
    p.rect(41, 33, 5, 15, '#6a4020');
    p.rect(34, 38, 12, 1, '#3a2410');
    // Log pile
    for (let i = 0; i < 3; i++) {
      p.ellipse(18 + i * 4, 44, 2, 2, '#6b4423');
      p.px(18 + i * 4, 44, '#c8a070');
    }
    p.ellipse(20, 40.5, 2, 2, '#6b4423');
    p.px(20, 40, '#c8a070');
    roof(p, 64, 30, ['#5f6b78', '#46505c', '#7c8896']);
  },
};

const market: SpriteDef = {
  w: 48,
  h: 32,
  paint: (p) => {
    // Poles
    p.rect(1, 12, 2, 20, '#5a3a1c');
    p.rect(45, 12, 2, 20, '#5a3a1c');
    // Counter with goods
    p.rect(2, 20, 44, 11, '#8a5a30');
    p.rect(2, 20, 44, 2, '#a8784a');
    p.rect(2, 30, 44, 2, '#5a3a1c');
    const goods: [number, Color, Color][] = [
      [7, '#d83a3a', '#f07070'],
      [15, '#d9a55a', '#f0c880'],
      [23, '#7a9ab0', '#a8c4d8'],
      [31, '#7cc04a', '#a8e070'],
      [39, '#e0a030', '#f8d070'],
    ];
    for (const [x, c, hi] of goods) {
      p.ellipse(x, 19, 3, 2, c);
      p.px(x - 1, 18, hi);
    }
    // Striped awning with scalloped edge
    for (let x = 0; x < 48; x++) {
      const c = Math.floor(x / 4) % 2 === 0 ? '#c8403a' : '#f0e8d8';
      p.rect(x, 0, 1, 13, c);
      if (x % 4 !== 3) p.px(x, 13, c);
      if (x % 4 === 1 || x % 4 === 2) p.px(x, 14, c);
    }
    p.rect(0, 0, 48, 1, '#7a2420');
    p.rect(0, 6, 48, 1, 'rgba(0,0,0,0.12)');
  },
};

const well: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.ellipse(8, 14, 7, 2, 'rgba(0,0,0,0.25)');
    p.ellipse(8, 10, 7, 5, '#5a5a55');
    p.ellipse(8, 9.5, 6.3, 4.4, '#9a9a92');
    for (const x of [3, 7, 11]) p.px(x, 8, '#6a6a64');
    p.ellipse(8, 9.5, 3.8, 2.4, '#1e3e6a');
    p.ellipse(7, 9, 1.5, 0.8, '#3a78c9');
    p.rect(1, 2, 1, 8, '#5a3a1c');
    p.rect(14, 2, 1, 8, '#5a3a1c');
    p.rect(1, 2, 14, 1, '#6b4423');
    p.rect(8, 3, 1, 3, '#3a2a20');
    p.rect(7, 6, 3, 2, '#8a5a30');
  },
};

const dock: SpriteDef = {
  w: 16,
  h: 16,
  paint: (p) => {
    p.rect(0, 2, 16, 12, '#9a6a3a');
    for (let y = 2; y < 14; y += 3) p.rect(0, y, 16, 1, '#6e4a26');
    p.rect(0, 13, 16, 1, '#5a3a1c');
    for (const x of [0, 14]) {
      p.rect(x, 0, 2, 16, '#5a3a1c');
    }
  },
};

/** A villager's animal pen: a wooden fence round straw, a gate at the bottom, hens and a sheep. */
const pen: SpriteDef = {
  w: 48,
  h: 48,
  paint: (p) => {
    p.speckle(
      2,
      4,
      44,
      42,
      '#d9c274',
      [
        ['#c4a85a', 0.12],
        ['#ead98e', 0.08],
      ],
      21,
    );
    const wood = '#8a5a30';
    const dark = '#5a3a1c';
    const light = '#a8784a';
    // Rails: top and sides, then the bottom rail in two pieces with the gate gap between them.
    p.rect(1, 4, 46, 2, wood);
    p.rect(1, 6, 46, 1, dark);
    p.rect(1, 4, 2, 44, wood);
    p.rect(45, 4, 2, 44, wood);
    p.rect(3, 4, 1, 42, light);
    p.rect(44, 4, 1, 42, dark);
    for (const y of [16, 30]) {
      p.rect(3, y, 42, 1, wood);
      p.rect(3, y + 1, 42, 1, dark);
    }
    p.rect(1, 44, 18, 2, wood);
    p.rect(29, 44, 18, 2, wood);
    p.rect(1, 46, 18, 1, dark);
    p.rect(29, 46, 18, 1, dark);
    // Posts at the corners and along the sides; gate posts either side of the gap.
    for (const [x, y] of [
      [0, 2],
      [44, 2],
      [0, 42],
      [44, 42],
      [0, 22],
      [44, 22],
      [19, 40],
      [28, 40],
    ] as const) {
      p.rect(x, y, 4, 6, light);
      p.rect(x + 3, y, 1, 6, dark);
    }
    // Two hens.
    for (const [x, y] of [
      [10, 30],
      [33, 35],
    ] as const) {
      p.ellipse(x, y, 2.5, 2, '#f4f0e6');
      p.ellipse(x + 2, y - 2, 1.4, 1.4, '#f4f0e6');
      p.px(x + 2, y - 4, '#d83a3a');
      p.px(x + 3, y - 2, '#e0a030');
      p.px(x - 1, y + 2, '#d9a55a');
      p.px(x + 1, y + 2, '#d9a55a');
    }
    // A sheep: fleecy body, dark head.
    p.ellipse(27, 18, 5, 3.5, '#f2f2ee');
    for (const [x, y] of [
      [24, 16],
      [27, 15],
      [30, 17],
      [25, 19],
      [28, 20],
    ] as const)
      p.px(x, y, '#dcdcd4');
    p.ellipse(33, 15, 1.8, 1.6, '#3a3a3a');
    p.px(34, 14, '#ffffff');
    p.px(23, 21, '#3a3a3a');
    p.px(26, 21, '#3a3a3a');
    p.px(29, 21, '#3a3a3a');
    p.px(31, 21, '#3a3a3a');
  },
};

/** A villager's own market stall: a counter, goods and a striped awning. */
const stall: SpriteDef = {
  w: 32,
  h: 20,
  paint: (p) => {
    // Striped awning with a scalloped edge.
    for (let x = 0; x < 32; x++) {
      const c = Math.floor(x / 4) % 2 === 0 ? '#c8403a' : '#f0e8d8';
      p.rect(x, 0, 1, 7, c);
      if (x % 4 !== 3) p.px(x, 7, c);
      if (x % 4 === 1 || x % 4 === 2) p.px(x, 8, c);
    }
    p.rect(0, 0, 32, 1, '#7a2420');
    // Poles.
    p.rect(1, 7, 2, 13, '#5a3a1c');
    p.rect(29, 7, 2, 13, '#5a3a1c');
    // Counter with goods on top.
    p.rect(3, 13, 26, 6, '#8a5a30');
    p.rect(3, 13, 26, 1, '#a8784a');
    p.rect(3, 18, 26, 1, '#5a3a1c');
    for (const [x, c] of [
      [8, '#d83a3a'],
      [14, '#d9a55a'],
      [20, '#7cc04a'],
      [25, '#e0a030'],
    ] as const) {
      p.ellipse(x, 12, 1.6, 1.2, c);
    }
  },
};

/** A field still being cleared: bare tilled dirt with a few stumps and stones. */
const plot: SpriteDef = {
  w: 64,
  h: 48,
  paint: (p) => {
    p.speckle(
      0,
      0,
      64,
      48,
      '#6b4a2c',
      [
        ['#5a3c22', 0.12],
        ['#7e5a36', 0.08],
      ],
      91,
    );
    for (const y of [6, 14, 22, 30, 38, 46]) p.rect(0, y, 64, 1, '#4e3520');
    // Stumps (cut rings) and stones.
    for (const [x, y] of [
      [12, 40],
      [50, 12],
    ] as const) {
      p.ellipse(x, y, 2.5, 1.6, '#6b4423');
      p.ellipse(x, y - 0.4, 1.8, 1, '#a07a50');
    }
    for (const [x, y, rx, ry] of [
      [30, 30, 2, 1.5],
      [42, 22, 1.5, 1],
      [22, 16, 1.2, 0.9],
    ] as const) {
      p.ellipse(x, y, rx, ry, '#8e8e86');
      p.px(Math.floor(x) - 1, Math.floor(y) - 1, '#b0b0a8');
    }
  },
};

// ---------------------------------------------------------------- registry

export const SPRITES = {
  grass0: grass(1),
  grass1: grass(2),
  grass2: grass(3, tuft),
  grass3: grass(4, flowers(['#f2e46b', '#e8f0ff', '#e7839a'])),
  water0: water(5),
  water1: water(6),
  foam_n: foam('n'),
  foam_e: foam('e'),
  foam_s: foam('s'),
  foam_w: foam('w'),
  sand0: sand(7),
  sand1: sand(8),
  path0: path(9),
  path1: path(10),
  farmland,
  crops,
  bridge,
  tree0: tree(['#3f8a3a', '#2f6e2e', '#5aab4a']),
  tree1: tree(['#4b9440', '#357a32', '#6ab85a']),
  tree2: tree(['#367a3e', '#285e30', '#4f9a52']),
  pine,
  berry_bush: berryBush,
  berry_bush_empty: berryBushEmpty,
  grave,
  rock,
  house0: house(0),
  house1: house(1),
  house2: house(2),
  house3: house(3),
  house4: house(4),
  house_open0: houseOpen(0),
  house_open1: houseOpen(1),
  house_open2: houseOpen(2),
  house_open3: houseOpen(3),
  house_open4: houseOpen(4),
  bakery,
  workshop,
  market,
  well,
  dock,
  pen,
  stall,
  plot,
} satisfies Record<string, SpriteDef>;

export type SpriteName = keyof typeof SPRITES;

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Puts a finished pixel buffer on a new canvas in one call. Painting the buffer first and
 * copying it over once is much cheaper than drawing on the canvas pixel by pixel.
 */
function bufferToCanvas(buf: PixelBuffer): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  ctx.putImageData(new ImageData(buf.data, buf.width, buf.height), 0, 0);
  return canvas;
}

/**
 * Paints every sprite into one image (shelf-packed) so the GPU can draw the map in few batches.
 * `pixels` is the same image as bytes, so the ground can copy tiles without reading the canvas.
 */
export function buildAtlas(): {
  canvas: HTMLCanvasElement;
  frames: Record<SpriteName, AtlasFrame>;
  pixels: PixelBuffer;
} {
  const size = 512;
  const pixels = new PixelBuffer(size, size);
  const frames = {} as Record<SpriteName, AtlasFrame>;
  const entries = (Object.entries(SPRITES) as [SpriteName, SpriteDef][]).sort(
    (a, b) => b[1].h - a[1].h,
  );
  let x = 0;
  let y = 0;
  let rowH = 0;
  const PAD = 2; // avoids texture bleeding between neighbouring sprites
  for (const [name, def] of entries) {
    if (x + def.w > size) {
      x = 0;
      y += rowH + PAD;
      rowH = 0;
    }
    if (y + def.h > size) throw new Error('Sprite atlas is full');
    def.paint(new Painter(pixels, x, y, def.w, def.h));
    frames[name] = { x, y, w: def.w, h: def.h };
    x += def.w + PAD;
    rowH = Math.max(rowH, def.h);
  }
  return { canvas: bufferToCanvas(pixels), frames, pixels };
}

// ---------------------------------------------------------------- people

export interface CharacterLook {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hairStyle: number;
}

/** Frame order in a character strip: down0, down1, up0, up1, side0, side1 (side faces right). */
export const CHARACTER_FRAMES = 6;
export const CHARACTER_PX = 16;

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function paintCharacterFrame(
  p: Painter,
  look: CharacterLook,
  dir: 'down' | 'up' | 'side',
  frame: number,
) {
  const hairDark = shade(look.hair, -0.25);
  const shirtDark = shade(look.shirt, -0.25);
  const skinDark = shade(look.skin, -0.18);
  const long = look.hairStyle === 1;
  const bald = look.hairStyle === 2;
  // Legs & shoes (walk frame swaps which leg is forward)
  const legA = frame === 1 ? 1 : 0;
  const legB = frame === 1 ? 0 : 1;
  if (dir === 'side') {
    p.rect(6, 12, 2, 3 - legA, look.pants);
    p.rect(8, 12, 2, 3 - legB, shade(look.pants, -0.2));
    p.rect(frame === 1 ? 5 : 6, 15 - legA, 3, 1, '#2a1e16');
    p.rect(frame === 1 ? 9 : 8, 15 - legB, 3, 1, '#2a1e16');
  } else {
    p.rect(5, 12, 3, 3 - legA, look.pants);
    p.rect(8, 12, 3, 3 - legB, look.pants);
    p.rect(5, 15 - legA, 3, 1, '#2a1e16');
    p.rect(8, 15 - legB, 3, 1, '#2a1e16');
  }
  // Body
  p.rect(4, 7, 8, 5, look.shirt);
  p.rect(4, 11, 8, 1, shirtDark);
  if (dir === 'side') {
    p.rect(7, 8, 2, 3, shirtDark);
    p.rect(7, 11, 2, 1, look.skin);
  } else {
    p.rect(3, 8, 1, 3, look.shirt);
    p.rect(12, 8, 1, 3, look.shirt);
    p.px(3, 11, look.skin);
    p.px(12, 11, look.skin);
  }
  // Head
  p.rect(5, 2, 6, 5, look.skin);
  p.rect(5, 6, 6, 1, skinDark);
  if (dir === 'down') {
    p.px(6, 4, '#2a1e16');
    p.px(9, 4, '#2a1e16');
    p.px(7, 6, skinDark);
    p.px(8, 6, skinDark);
    if (!bald) {
      p.rect(5, 1, 6, 2, look.hair);
      p.rect(4, 2, 1, long ? 6 : 3, look.hair);
      p.rect(11, 2, 1, long ? 6 : 3, look.hair);
      p.rect(5, 1, 6, 1, hairDark);
    }
  } else if (dir === 'up') {
    if (!bald) {
      p.rect(5, 1, 6, 5, look.hair);
      p.rect(4, 2, 1, long ? 6 : 3, look.hair);
      p.rect(11, 2, 1, long ? 6 : 3, look.hair);
      if (long) p.rect(5, 6, 6, 2, look.hair);
      p.rect(5, 1, 6, 1, hairDark);
    }
  } else {
    p.px(9, 4, '#2a1e16');
    p.px(11, 5, look.skin);
    if (!bald) {
      p.rect(5, 1, 6, 2, look.hair);
      p.rect(4, 2, 3, long ? 6 : 4, look.hair);
      p.rect(5, 1, 6, 1, hairDark);
    }
  }
}

/** Paints a strip of CHARACTER_FRAMES frames for one person, with a dark outline for contrast. */
export function characterCanvas(look: CharacterLook): HTMLCanvasElement {
  const buf = new PixelBuffer(CHARACTER_PX * CHARACTER_FRAMES, CHARACTER_PX);
  const frames: ['down' | 'up' | 'side', number][] = [
    ['down', 0],
    ['down', 1],
    ['up', 0],
    ['up', 1],
    ['side', 0],
    ['side', 1],
  ];
  frames.forEach(([dir, f], i) =>
    paintCharacterFrame(new Painter(buf, i * CHARACTER_PX, 0, 16, 16), look, dir, f),
  );
  // Outline pass. Outline pixels are collected first and painted after, so an outline pixel
  // never counts as filled for its neighbours.
  const d = buf.data;
  const w = buf.width;
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < buf.height && d[(y * w + x) * 4 + 3]! > 0;
  const outline: number[] = [];
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) continue;
      const fx = x % CHARACTER_PX;
      const n =
        (fx > 0 && filled(x - 1, y)) ||
        (fx < CHARACTER_PX - 1 && filled(x + 1, y)) ||
        filled(x, y - 1) ||
        filled(x, y + 1);
      if (n) outline.push(x, y);
    }
  }
  const outlineColour = parseColor('rgba(20,14,10,0.85)');
  for (let i = 0; i < outline.length; i += 2) {
    fillRect(buf, outline[i]!, outline[i + 1]!, 1, 1, outlineColour);
  }
  return bufferToCanvas(buf);
}
