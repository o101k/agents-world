import { create } from 'zustand';

/** The viewer's panel layout: the right sidebar and the bottom timeline. */
export interface Layout {
  sidebarOpen: boolean;
  sidebarWidth: number; // px
  timelineOpen: boolean;
  timelineHeight: number; // px
}

export const SIDEBAR_WIDTH = { min: 240, max: 720, default: 340 } as const;
export const TIMELINE_HEIGHT = { min: 100, max: 600, default: 210 } as const;

export const DEFAULT_LAYOUT: Layout = {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH.default,
  timelineOpen: true,
  timelineHeight: TIMELINE_HEIGHT.default,
};

const STORAGE_KEY = 'aw.layout';

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function size(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Turns anything (stored or typed) into a valid layout. Never throws. */
export function parseLayout(raw: unknown): Layout {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_LAYOUT };
  const r = raw as Record<string, unknown>;
  return {
    sidebarOpen: bool(r.sidebarOpen, DEFAULT_LAYOUT.sidebarOpen),
    sidebarWidth: size(r.sidebarWidth, DEFAULT_LAYOUT.sidebarWidth, SIDEBAR_WIDTH),
    timelineOpen: bool(r.timelineOpen, DEFAULT_LAYOUT.timelineOpen),
    timelineHeight: size(r.timelineHeight, DEFAULT_LAYOUT.timelineHeight, TIMELINE_HEIGHT),
  };
}

function load(): Layout {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_LAYOUT };
    return parseLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function save(layout: Layout): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage is blocked or full: the layout still works for this visit.
  }
}

interface LayoutState extends Layout {
  /** Change some fields; the result is validated, saved and applied. */
  set: (patch: Partial<Layout>) => void;
  /** Put every panel back to the default layout. */
  reset: () => void;
}

function fields(state: Layout): Layout {
  return {
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    timelineOpen: state.timelineOpen,
    timelineHeight: state.timelineHeight,
  };
}

/** The layout of the panels, remembered in this browser and shared by every world. */
export const useLayout = create<LayoutState>((set, get) => {
  const initial = load();
  return {
    ...initial,
    set: (patch) => {
      const next = parseLayout({ ...fields(get()), ...patch });
      save(next);
      set(next);
    },
    reset: () => {
      save({ ...DEFAULT_LAYOUT });
      set({ ...DEFAULT_LAYOUT });
    },
  };
});
