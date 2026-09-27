import { useEffect, useRef, type RefObject } from 'react';
import type { WorldMap } from '@aw/shared';
import { useWorld } from '../worldStore.ts';
import { WorldRenderer } from './renderer.ts';

interface Props {
  map: WorldMap;
  rendererRef: RefObject<WorldRenderer | null>;
}

const PAN_STEP = 96;

/** Hosts the PixiJS renderer and feeds it live world state from the store (outside React renders). */
export function MapView({ map, rendererRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new WorldRenderer();
    renderer.onSelect = (sel) => useWorld.getState().select(sel);
    renderer.onFollowBroken = () => useWorld.getState().setFollow(null);
    rendererRef.current = renderer;
    let cancelled = false;
    void renderer.init(host).then(() => {
      if (cancelled) return;
      const s = useWorld.getState();
      renderer.setResources(s.resources);
      renderer.setAgents(s.agents);
      renderer.setClock(s.tick);
      renderer.setFollow(s.followId);
      renderer.setConditions(s.conditions);
      if (s.calendar) renderer.setSeason(s.calendar.season);
    });
    const unsub = useWorld.subscribe((s, prev) => {
      const past = s.replay?.view;
      if (past) {
        // Replay: show the past moment; live updates wait.
        if (past !== prev.replay?.view) {
          renderer.setResources(past.resources);
          renderer.setAgents(past.agents);
          renderer.setClock(past.tick);
          renderer.setConditions(past.conditions);
          if (past.calendar) renderer.setSeason(past.calendar.season);
        }
      } else if (prev.replay?.view) {
        // Back to live: catch up with everything at once.
        renderer.setResources(s.resources);
        renderer.setAgents(s.agents);
        renderer.setClock(s.tick);
        renderer.setConditions(s.conditions);
        if (s.calendar) renderer.setSeason(s.calendar.season);
      } else {
        if (s.resourceChanges !== prev.resourceChanges) renderer.setResources(s.resourceChanges);
        if (s.agents !== prev.agents) renderer.setAgents(s.agents);
        if (s.tick !== prev.tick) renderer.setClock(s.tick);
        if (s.conditions !== prev.conditions) renderer.setConditions(s.conditions);
        if (s.calendar && s.calendar.season !== prev.calendar?.season)
          renderer.setSeason(s.calendar.season);
      }
      if (s.followId !== prev.followId) renderer.setFollow(s.followId);
      if (s.selection !== prev.selection) renderer.select(s.selection);
    });
    return () => {
      cancelled = true;
      unsub();
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [rendererRef]);

  const shownOnce = useRef(false);
  useEffect(() => {
    rendererRef.current?.setMap(map, shownOnce.current);
    shownOnce.current = true;
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
