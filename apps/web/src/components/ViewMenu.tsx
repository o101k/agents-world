import { useEffect, useRef, useState } from 'react';
import { SIDEBAR_WIDTH, TIMELINE_HEIGHT, useLayout } from '../layoutStore.ts';

/** Top-bar menu that shows, hides and resizes the sidebar and the timeline. */
export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const timelineOpen = useLayout((s) => s.timelineOpen);
  const timelineHeight = useLayout((s) => s.timelineHeight);
  const set = useLayout((s) => s.set);
  const reset = useLayout((s) => s.reset);

  // Close on a press outside the menu or on Escape; listeners exist only while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase, and stopPropagation: Escape closes the menu but must not
    // also clear the map selection (MapView listens on window in bubble phase).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="view-menu" ref={wrapRef}>
      <button
        className="btn btn-small btn-ghost"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="View"
        title="View: show, hide or resize the sidebar and the timeline"
        onClick={() => setOpen((o) => !o)}
      >
        ▤
      </button>
      {open && (
        <div className="view-menu-panel" role="group" aria-label="Layout">
          <h3>Sidebar</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={sidebarOpen}
              onChange={(e) => set({ sidebarOpen: e.target.checked })}
            />{' '}
            Show sidebar
          </label>
          <div className="view-menu-row">
            <input
              type="range"
              aria-label="Sidebar width"
              min={SIDEBAR_WIDTH.min}
              max={SIDEBAR_WIDTH.max}
              step={10}
              value={sidebarWidth}
              disabled={!sidebarOpen}
              onChange={(e) => set({ sidebarWidth: Number(e.target.value) })}
            />
            <span className="muted small">{sidebarWidth} px</span>
          </div>

          <h3>Timeline</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={timelineOpen}
              onChange={(e) => set({ timelineOpen: e.target.checked })}
            />{' '}
            Show timeline
          </label>
          <div className="view-menu-row">
            <input
              type="range"
              aria-label="Timeline height"
              min={TIMELINE_HEIGHT.min}
              max={TIMELINE_HEIGHT.max}
              step={10}
              value={timelineHeight}
              disabled={!timelineOpen}
              onChange={(e) => set({ timelineHeight: Number(e.target.value) })}
            />
            <span className="muted small">{timelineHeight} px</span>
          </div>

          <div className="view-menu-reset">
            <button className="btn btn-small" onClick={() => reset()}>
              Reset layout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
