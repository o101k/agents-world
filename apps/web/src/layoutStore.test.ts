import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, parseLayout, useLayout } from './layoutStore.ts';

describe('the panel layout', () => {
  beforeEach(() => {
    useLayout.getState().reset();
  });

  it('falls back to the defaults for anything that is not an object', () => {
    for (const garbage of [null, 'sidebar', [1, 2], undefined, 42]) {
      expect(parseLayout(garbage)).toEqual(DEFAULT_LAYOUT);
    }
    expect(parseLayout({})).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps widths and heights into their allowed ranges', () => {
    const layout = parseLayout({ sidebarWidth: 10, timelineHeight: 5000 });
    expect(layout.sidebarWidth).toBe(240);
    expect(layout.timelineHeight).toBe(600);
    const big = parseLayout({ sidebarWidth: 9999, timelineHeight: -3 });
    expect(big.sidebarWidth).toBe(720);
    expect(big.timelineHeight).toBe(100);
  });

  it('uses the defaults for values that are not finite numbers', () => {
    const layout = parseLayout({ sidebarWidth: NaN, timelineHeight: '300' });
    expect(layout.sidebarWidth).toBe(340);
    expect(layout.timelineHeight).toBe(210);
    expect(parseLayout({ sidebarWidth: Infinity }).sidebarWidth).toBe(340);
  });

  it('rounds fractional sizes to whole pixels', () => {
    expect(parseLayout({ sidebarWidth: 301.6, timelineHeight: 150.2 })).toMatchObject({
      sidebarWidth: 302,
      timelineHeight: 150,
    });
  });

  it('treats non-boolean open flags as open', () => {
    const layout = parseLayout({ sidebarOpen: 'no', timelineOpen: 0 });
    expect(layout.sidebarOpen).toBe(true);
    expect(layout.timelineOpen).toBe(true);
    expect(parseLayout({ sidebarOpen: false, timelineOpen: false })).toMatchObject({
      sidebarOpen: false,
      timelineOpen: false,
    });
  });

  it('clamps when a size is set through the store, and reset restores the defaults', () => {
    useLayout.getState().set({ sidebarWidth: 9999 });
    expect(useLayout.getState().sidebarWidth).toBe(720);
    useLayout.getState().set({ timelineOpen: false });
    expect(useLayout.getState().timelineOpen).toBe(false);
    useLayout.getState().reset();
    const state = useLayout.getState();
    expect({
      sidebarOpen: state.sidebarOpen,
      sidebarWidth: state.sidebarWidth,
      timelineOpen: state.timelineOpen,
      timelineHeight: state.timelineHeight,
    }).toEqual(DEFAULT_LAYOUT);
  });
});
