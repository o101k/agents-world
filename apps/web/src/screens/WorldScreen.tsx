import { useEffect, useMemo, useRef, useState } from 'react';
import {
  OBJECT_LABELS,
  TILE_NAMES,
  decodeMap,
  formatClock,
  type MapObjectKind,
  type WorldMap,
  type WorldViewResponse,
} from '@aw/shared';
import { api } from '../api.ts';
import { MapView } from '../map/MapView.tsx';
import type { MapSelection, WorldRenderer } from '../map/renderer.ts';
import { useApp } from '../store.ts';

const OBJECT_BLURBS: Partial<Record<MapObjectKind, string>> = {
  house: 'A family home. Shelter from cold and storms, and a place to sleep.',
  bakery: 'Turns flour into bread. Someone will need to run it.',
  workshop: 'Where wood becomes planks, tools and furniture.',
  market: 'The town market buys and sells basic goods at prices driven by supply and demand.',
  well: 'Fresh drinking water for everyone.',
  field: 'Farmland for growing grain and vegetables.',
  dock: 'A good spot for fishing.',
  tree: 'Wood for building and fires.',
  berry_bush: 'Wild berries — free food for whoever finds them.',
  rock: 'Stone for building.',
};

const SUMMARY_KINDS: MapObjectKind[] = ['house', 'field', 'tree', 'berry_bush'];

export function WorldScreen({ worldId }: { worldId: string }) {
  const setShowWorldsScreen = useApp((s) => s.setShowWorldsScreen);
  const [view, setView] = useState<WorldViewResponse | null>(null);
  const [map, setMap] = useState<WorldMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);

  useEffect(() => {
    // State starts fresh per world: App renders this screen with key={worldId}.
    let cancelled = false;
    api
      .worldView(worldId)
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setMap(decodeMap(v.map));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const counts = useMemo(() => {
    const c = new Map<MapObjectKind, number>();
    for (const o of map?.objects ?? []) c.set(o.kind, (c.get(o.kind) ?? 0) + 1);
    return c;
  }, [map]);

  return (
    <div className="world-screen">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => setShowWorldsScreen(true)}>
          ← Worlds
        </button>
        <div className="topbar-title">{view?.meta.name ?? '…'}</div>
        {view && <div className="topbar-clock">{formatClock(view.meta.tick)}</div>}
        <div className="topbar-spacer" />
        <div className="muted small">Villagers and time controls arrive in Phase 1</div>
      </header>

      <div className="world-body">
        <main className="map-area">
          {error && <div className="banner banner-error">{error}</div>}
          {map && <MapView map={map} onSelect={setSelection} rendererRef={rendererRef} />}
          <div className="map-controls" aria-label="Map controls">
            <button
              className="btn btn-icon"
              title="Zoom in (+)"
              onClick={() => rendererRef.current?.zoomBy(1)}
            >
              +
            </button>
            <button
              className="btn btn-icon"
              title="Zoom out (−)"
              onClick={() => rendererRef.current?.zoomBy(-1)}
            >
              −
            </button>
            <button
              className="btn btn-icon"
              title="Fit map (F)"
              onClick={() => rendererRef.current?.fit()}
            >
              ⤢
            </button>
          </div>
        </main>

        <aside className="sidebar">
          <section className="panel">
            <h2>Selected</h2>
            {selection ? (
              <SelectionDetails selection={selection} />
            ) : (
              <p className="muted">Click anything on the map.</p>
            )}
          </section>

          {view && (
            <section className="panel">
              <h2>World</h2>
              <dl className="facts">
                <dt>Seed</dt>
                <dd>
                  <code>{view.meta.seed}</code>
                </dd>
                <dt>Map</dt>
                <dd>
                  {view.meta.mapWidth}×{view.meta.mapHeight} tiles
                </dd>
                <dt>Aging</dt>
                <dd>{view.settings.daysPerYear} days per year</dd>
                {SUMMARY_KINDS.map((k) => (
                  <FactRow key={k} label={`${OBJECT_LABELS[k]}s`} value={counts.get(k) ?? 0} />
                ))}
              </dl>
            </section>
          )}

          <section className="panel help">
            <h2>Getting around</h2>
            <ul>
              <li>Drag or two-finger scroll to pan</li>
              <li>Pinch or ⌘ + scroll to zoom</li>
              <li>Arrow keys / WASD pan · + / − zoom · F fit</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function SelectionDetails({ selection }: { selection: MapSelection }) {
  const { object, tile, tileType } = selection;
  if (object) {
    return (
      <div className="selection">
        <div className="selection-title">{object.name ?? OBJECT_LABELS[object.kind]}</div>
        <div className="muted small">
          {OBJECT_LABELS[object.kind]} · at ({object.x}, {object.y})
          {object.w > 1 || object.h > 1 ? ` · ${object.w}×${object.h}` : ''}
        </div>
        {OBJECT_BLURBS[object.kind] && <p>{OBJECT_BLURBS[object.kind]}</p>}
      </div>
    );
  }
  return (
    <div className="selection">
      <div className="selection-title">{TILE_NAMES[tileType]}</div>
      <div className="muted small">
        Tile ({tile.x}, {tile.y})
      </div>
    </div>
  );
}
