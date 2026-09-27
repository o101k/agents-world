import { useEffect, useRef, type RefObject } from 'react';
import type { WorldMap } from '@aw/shared';
import { WorldRenderer, type MapSelection } from './renderer.ts';

interface Props {
  map: WorldMap;
  onSelect: (sel: MapSelection | null) => void;
  rendererRef: RefObject<WorldRenderer | null>;
}

const PAN_STEP = 96;

export function MapView({ map, onSelect, rendererRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new WorldRenderer();
    renderer.onSelect = (sel) => onSelectRef.current(sel);
    rendererRef.current = renderer;
    void renderer.init(host);
    return () => {
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [rendererRef]);

  useEffect(() => {
    rendererRef.current?.setMap(map);
  }, [map, rendererRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = rendererRef.current;
      if (!r) return;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => r.panBy(-PAN_STEP, 0),
        ArrowRight: () => r.panBy(PAN_STEP, 0),
        ArrowUp: () => r.panBy(0, -PAN_STEP),
        ArrowDown: () => r.panBy(0, PAN_STEP),
        a: () => r.panBy(-PAN_STEP, 0),
        d: () => r.panBy(PAN_STEP, 0),
        w: () => r.panBy(0, -PAN_STEP),
        s: () => r.panBy(0, PAN_STEP),
        '+': () => r.zoomBy(1),
        '=': () => r.zoomBy(1),
        '-': () => r.zoomBy(-1),
        f: () => r.fit(),
        '0': () => r.fit(),
        Escape: () => r.clearSelection(),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rendererRef]);

  return <div className="map-host" ref={hostRef} data-testid="map" />;
}
