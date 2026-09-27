import { useEffect, useRef, useState } from 'react';
import {
  OBJECT_LABELS,
  TILE_NAMES,
  decodeMap,
  type MapObjectKind,
  type WorldMap,
  type WorldViewResponse,
} from '@aw/shared';
import { api } from '../api.ts';
import { AgentInspector } from '../components/AgentInspector.tsx';
import { EventLog } from '../components/EventLog.tsx';
import { BrainEditor } from '../components/BrainEditor.tsx';
import { PeopleList } from '../components/PeopleList.tsx';
import { SpawnDialog } from '../components/SpawnDialog.tsx';
import { SpendMeter } from '../components/SpendMeter.tsx';
import { TimeControls } from '../components/TimeControls.tsx';
import { useSettings } from '../settingsStore.ts';
import { MapView } from '../map/MapView.tsx';
import type { MapSelection, WorldRenderer } from '../map/renderer.ts';
import { useApp } from '../store.ts';
import { useWorld } from '../worldStore.ts';

const OBJECT_BLURBS: Partial<Record<MapObjectKind, string>> = {
  house: 'A family home. Shelter from cold and storms, and a place to sleep.',
  bakery: 'Turns flour into bread. Someone will need to run it.',
  workshop: 'Where wood becomes planks, tools and furniture.',
  market: 'The town market buys and sells basic goods at prices driven by supply and demand.',
  well: 'Fresh drinking water for everyone.',
  field: 'Farmland. Vegetables grow back over time.',
  dock: 'A good spot for fishing.',
  tree: 'Wood for building and fires.',
  berry_bush: 'Wild berries — free food for whoever finds them. They grow back slowly.',
  rock: 'Stone for building.',
};

type Tab = 'selected' | 'people' | 'world';

export function WorldScreen({ worldId }: { worldId: string }) {
  const setShowWorldsScreen = useApp((s) => s.setShowWorldsScreen);
  const meta = useApp((s) => s.worlds.find((w) => w.id === worldId));
  const [view, setView] = useState<WorldViewResponse | null>(null);
  const [map, setMap] = useState<WorldMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('people');
  const selection = useWorld((s) => s.selection);
  const capReached = useWorld((s) => s.runner.capReached);
  const [spawning, setSpawning] = useState(false);
  const openSettings = useSettings((s) => s.setOpen);
  const rendererRef = useRef<WorldRenderer | null>(null);

  // State starts fresh per world: App renders this screen with key={worldId}.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.worldView(worldId), api.events(worldId, { limit: 300 })])
      .then(([v, ev]) => {
        if (cancelled) return;
        useWorld.getState().load(worldId, v, ev.events);
        setView(v);
        setMap(decodeMap(v.map));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      useWorld.getState().reset();
    };
  }, [worldId]);

  // Selecting something on the map shows it.
  useEffect(
    () =>
      useWorld.subscribe((s, prev) => {
        if (s.selection && s.selection !== prev.selection) setTab('selected');
      }),
    [],
  );

  // Space toggles play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.key !== ' ' ||
        (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
      )
        return;
      e.preventDefault();
      void api.control(worldId, { running: !useWorld.getState().runner.running });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [worldId]);

  const pickAgent = (id: string) => {
    const sel: MapSelection = { kind: 'agent', id };
    useWorld.getState().select(sel);
    rendererRef.current?.select(sel, true);
  };

  return (
    <div className="world-screen">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => setShowWorldsScreen(true)}>
          ← Worlds
        </button>
        <div className="topbar-title">{meta?.name ?? view?.meta.name ?? '…'}</div>
        {view && <TimeControls worldId={worldId} />}
        <div className="topbar-spacer" />
        {view && <SpendMeter worldId={worldId} />}
        <button
          className="btn btn-small"
          onClick={() => setSpawning(true)}
          title="Bring a new person into the world"
        >
          + Spawn
        </button>
        <button
          className="btn btn-small btn-ghost"
          onClick={() => openSettings(true)}
          title="Settings: AI providers, keys, prices"
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>
      {capReached && (
        <div className="banner banner-warn" role="alert">
          The spending cap is reached, so time is paused. Raise the cap (click the spending meter)
          or switch people to the free Mock brain, then press Play.
        </div>
      )}
      {spawning && (
        <SpawnDialog
          worldId={worldId}
          onClose={() => setSpawning(false)}
          onSpawned={(id) => setTimeout(() => pickAgent(id), 300)}
        />
      )}

      <div className="world-body">
        <main className="map-area">
          {error && <div className="banner banner-error">{error}</div>}
          <div className="map-wrap">
            {map && <MapView map={map} rendererRef={rendererRef} />}
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
          </div>
          <EventLog onPickAgent={pickAgent} />
        </main>

        <aside className="sidebar">
          <div className="tabs" role="tablist">
            {(['selected', 'people', 'world'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? 'is-on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'selected' ? 'Selected' : t === 'people' ? 'People' : 'World'}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'selected' &&
              (selection ? (
                <SelectionDetails worldId={worldId} selection={selection} map={map} />
              ) : (
                <p className="muted">Click a person or anything on the map.</p>
              ))}
            {tab === 'people' && <PeopleList onPick={pickAgent} />}
            {tab === 'world' && view && <WorldInfo worldId={worldId} view={view} map={map} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function WorldInfo({
  worldId,
  view,
  map,
}: {
  worldId: string;
  view: WorldViewResponse;
  map: WorldMap | null;
}) {
  const [settings, setSettings] = useState(view.settings);
  const [applyToAll, setApplyToAll] = useState(false);
  const counts = new Map<MapObjectKind, number>();
  for (const o of map?.objects ?? []) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  return (
    <div>
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
        {(['house', 'field', 'tree', 'berry_bush'] as MapObjectKind[]).map((k) => (
          <FactRow key={k} label={`${OBJECT_LABELS[k]}s`} value={counts.get(k) ?? 0} />
        ))}
      </dl>
      <h3>Default brain</h3>
      <p className="muted small">
        Used for newborns and spawned people. You can also set each person’s brain in their
        inspector.
      </p>
      <BrainEditor
        key={JSON.stringify(settings.defaultBrain)}
        value={settings.defaultBrain}
        saveLabel={applyToAll ? 'Save and apply to everyone' : 'Save default'}
        extra={
          <label className="check">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />{' '}
            Also switch everyone alive to this brain
          </label>
        }
        onSave={async (brain) => {
          setSettings(await api.setDefaultBrain(worldId, brain, applyToAll));
          setApplyToAll(false);
        }}
      />
      <h3>Getting around</h3>
      <ul className="help-list">
        <li>Drag or two-finger scroll to pan</li>
        <li>Pinch or ⌘ + scroll to zoom</li>
        <li>Arrow keys / WASD pan · + / − zoom · F fit</li>
        <li>Space plays / pauses time</li>
      </ul>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: number | string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function SelectionDetails({
  worldId,
  selection,
  map,
}: {
  worldId: string;
  selection: MapSelection;
  map: WorldMap | null;
}) {
  const resources = useWorld((s) => s.resources);
  if (selection.kind === 'agent')
    return <AgentInspector worldId={worldId} agentId={selection.id} />;
  if (selection.kind === 'object') {
    const object = map?.objects.find((o) => o.id === selection.id);
    if (!object) return null;
    const amount = resources[object.id];
    return (
      <div className="selection">
        <div className="selection-title">{object.name ?? OBJECT_LABELS[object.kind]}</div>
        <div className="muted small">
          {OBJECT_LABELS[object.kind]} · at ({object.x}, {object.y})
          {object.w > 1 || object.h > 1 ? ` · ${object.w}×${object.h}` : ''}
        </div>
        {OBJECT_BLURBS[object.kind] && <p>{OBJECT_BLURBS[object.kind]}</p>}
        {amount !== undefined && (
          <p>
            <strong>{object.kind === 'berry_bush' ? 'Berries' : 'Vegetables ready'}:</strong>{' '}
            {amount}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="selection">
      <div className="selection-title">{TILE_NAMES[selection.tileType]}</div>
      <div className="muted small">
        Tile ({selection.tile.x}, {selection.tile.y})
      </div>
    </div>
  );
}
