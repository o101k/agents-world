import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  OBJECT_LABELS,
  TILE_NAMES,
  decodeMap,
  formatClock,
  rateLimitFacts,
  rateLimitSource,
  type MapObject,
  type MapObjectKind,
  type RateLimitNotice,
  type WorldMap,
  type WorldSettings,
  type WorldViewResponse,
} from '@aw/shared';
import { api } from '../api.ts';
import { AgentInspector } from '../components/AgentInspector.tsx';
import { EventLog } from '../components/EventLog.tsx';
import { ViewMenu } from '../components/ViewMenu.tsx';
import { BrainEditor } from '../components/BrainEditor.tsx';
import { WorldBrainsDialog } from '../components/WorldBrainsDialog.tsx';
import { MarketPanel } from '../components/MarketPanel.tsx';
import { ObjectHistory } from '../components/ObjectHistory.tsx';
import { PenFacts, StallStock, useVillage, VillagePanel } from '../components/VillagePanel.tsx';
import { PeopleList } from '../components/PeopleList.tsx';
import { SpawnDialog } from '../components/SpawnDialog.tsx';
import { ConditionsBar, WorldEventsDialog } from '../components/WorldEventsDialog.tsx';
import { ReplayBar } from '../components/ReplayBar.tsx';
import { SpendMeter } from '../components/SpendMeter.tsx';
import { TimeControls } from '../components/TimeControls.tsx';
import { useLayout } from '../layoutStore.ts';
import { useSettings } from '../settingsStore.ts';
import { MapView } from '../map/MapView.tsx';
import type { MapSelection, WorldRenderer } from '../map/renderer.ts';
import { useApp } from '../store.ts';
import { useWorld } from '../worldStore.ts';

const OBJECT_BLURBS: Partial<Record<MapObjectKind, string>> = {
  house: 'A family home. Shelter from cold and storms; a place to sleep, rest and be ill in.',
  market: 'The town market buys and sells basic goods at prices driven by supply and demand.',
  well: 'Fresh drinking water. New wells are built of stone.',
  field:
    'Farmland. Common fields belong to everyone; cleared fields belong to whoever cleared them.',
  bakery: 'Turns wheat into bread (3 wheat → 2 bread).',
  workshop: 'Turns wood into planks (2 → 2) and planks into tools (3 → 1).',
  dock: 'A good spot for fishing.',
  tree: 'Chop it for wood. It grows back slowly.',
  berry_bush: 'Wild berries — free food for whoever finds them. They grow back slowly.',
  rock: 'Quarry it for stone.',
  pen: 'Hens and sheep live here. Tend them for eggs and wool.',
  stall: "A villager's own stall: their goods at their prices.",
};

const OBJECT_PLURALS: Record<MapObjectKind, string> = {
  house: 'Houses',
  market: 'Markets',
  well: 'Wells',
  field: 'Fields',
  bakery: 'Bakeries',
  workshop: 'Workshops',
  dock: 'Docks',
  tree: 'Trees',
  berry_bush: 'Berry bushes',
  rock: 'Rocks',
  pen: 'Animal pens',
  stall: 'Market stalls',
};

type Tab = 'selected' | 'people' | 'world';

export function WorldScreen({ worldId }: { worldId: string }) {
  const setShowWorldsScreen = useApp((s) => s.setShowWorldsScreen);
  const connectionEpoch = useApp((s) => s.connectionEpoch);
  const meta = useApp((s) => s.worlds.find((w) => w.id === worldId));
  const [view, setView] = useState<WorldViewResponse | null>(null);
  const [worldSettings, setWorldSettings] = useState<WorldSettings | null>(null);
  const [map, setMap] = useState<WorldMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spawnNote, setSpawnNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('people');
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const timelineOpen = useLayout((s) => s.timelineOpen);
  const timelineHeight = useLayout((s) => s.timelineHeight);
  const selection = useWorld((s) => s.selection);
  const capReached = useWorld((s) => s.runner.capReached);
  const rateLimit = useWorld((s) => s.runner.rateLimit);
  const [spawning, setSpawning] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [brainsOpen, setBrainsOpen] = useState(false);
  const replaying = useWorld((s) => s.replay !== null);
  // The map as it was, when replaying a moment before the map changed (e.g. before a house).
  const [pastMap, setPastMap] = useState<{ version: number; map: WorldMap } | null>(null);
  useEffect(
    () =>
      useWorld.subscribe((s, prev) => {
        if (!s.replay && prev.replay) setPastMap(null);
        const replayView = s.replay?.view;
        if (replayView && replayView !== prev.replay?.view && replayView.map)
          setPastMap({ version: replayView.mapVersion, map: decodeMap(replayView.map) });
        if (replayView && !replayView.map && replayView.mapVersion === s.mapVersion)
          setPastMap(null);
      }),
    [],
  );
  const shownMap = pastMap?.map ?? map;
  const shownMapRef = useRef(shownMap);
  useEffect(() => {
    shownMapRef.current = shownMap;
  }, [shownMap]);
  const pastOwners = useWorld((s) => s.replay?.view?.owners);
  const openSettings = useSettings((s) => s.setOpen);
  const rendererRef = useRef<WorldRenderer | null>(null);
  /** Owners' names by object id, updated with each map. */
  const [owners, setOwners] = useState<Record<string, string[]>>({});
  /** Map version on screen. */
  const shownMapVersion = useRef(0);
  /** A map request is out (never more than one at a time). */
  const mapBusy = useRef(false);
  /** False after unmount (App keys this screen by world, so a world change unmounts it too). */
  const alive = useRef(true);
  const spawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (spawnTimerRef.current !== null) clearTimeout(spawnTimerRef.current);
      useWorld.getState().reset();
    };
  }, []);

  const worldTitle = meta?.name ?? view?.meta.name;
  useEffect(() => {
    document.title = worldTitle ? `${worldTitle} — Agents World` : 'Agents World';
    return () => {
      document.title = 'Agents World';
    };
  }, [worldTitle]);

  // Load world state on mount and resync cleanly after WebSocket reconnects.
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      api.worldView(worldId, ctrl.signal),
      api.events(worldId, { limit: 300 }, ctrl.signal),
    ])
      .then(([v, ev]) => {
        if (ctrl.signal.aborted) return;
        useWorld.getState().load(worldId, v, ev.events);
        shownMapVersion.current = v.mapVersion;
        setView(v);
        setWorldSettings(v.settings);
        setMap(decodeMap(v.map));
        setOwners(v.owners);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ctrl.abort();
    };
  }, [worldId, connectionEpoch]);

  // The map changed on the helper (e.g. a house is being built): fetch just the map, in place.
  // A reply is applied even if the version moved on in flight; the newer one is fetched next.
  const mapVersion = useWorld((s) => s.mapVersion);
  const syncMap = useCallback((): void => {
    function fetchMap(): void {
      const wanted = useWorld.getState().mapVersion;
      if (!alive.current || mapBusy.current || wanted <= shownMapVersion.current) return;
      mapBusy.current = true;
      api
        .worldMap(worldId)
        .then((r) => {
          if (!alive.current || r.mapVersion <= shownMapVersion.current) return;
          shownMapVersion.current = r.mapVersion;
          setMap(decodeMap(r.map));
          setOwners(r.owners);
        })
        .catch(() => {})
        .finally(() => {
          mapBusy.current = false;
          // Refetch only if the version moved on meanwhile; a stale store value can't loop.
          if (useWorld.getState().mapVersion !== wanted) fetchMap();
        });
    }
    fetchMap();
  }, [worldId]);
  useEffect(() => {
    if (view) syncMap();
  }, [view, mapVersion, syncMap]);

  // Selecting something on the map shows it.
  useEffect(
    () =>
      useWorld.subscribe((s, prev) => {
        if (s.selection && s.selection !== prev.selection) setTab('selected');
      }),
    [],
  );

  // Space toggles play/pause when no dialog or input is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))
      )
        return;
      e.preventDefault();
      void api.control(worldId, { running: !useWorld.getState().runner.running }).catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [worldId]);

  const pickAgent = useCallback((id: string) => {
    const sel: MapSelection = { kind: 'agent', id };
    useWorld.getState().select(sel);
    rendererRef.current?.select(sel, true);
  }, []);

  /** Select a house, bush… (e.g. from a timeline entry) and show it on the map. */
  const pickObject = useCallback((id: string) => {
    const object = shownMapRef.current?.objects.find((o) => o.id === id);
    if (!object) return;
    const sel: MapSelection = { kind: 'object', id, tile: { x: object.x, y: object.y } };
    useWorld.getState().select(sel);
    rendererRef.current?.select(sel, true);
  }, []);

  return (
    <div className="world-screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost" onClick={() => setShowWorldsScreen(true)}>
          ← Worlds
        </button>
        <h1 className="topbar-title">{worldTitle ?? '…'}</h1>
        {view && <TimeControls worldId={worldId} />}
        <div className="topbar-spacer" />
        {view && <SpendMeter worldId={worldId} />}
        <button
          type="button"
          className={`btn btn-small ${replaying ? 'btn-primary' : ''}`}
          aria-pressed={replaying}
          disabled={!view}
          onClick={() =>
            useWorld
              .getState()
              .setReplayTarget(replaying ? null : Math.max(0, useWorld.getState().tick - 60))
          }
          title="Scrub back through the world's history"
        >
          {replaying ? '⏵ Live' : '⏪ Replay'}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!view}
          onClick={() => setEventsOpen(true)}
          title="Trigger a drought, storm, sickness, fire or bumper harvest"
        >
          ⚡ Events
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!view}
          onClick={() => setBrainsOpen(true)}
          title="Choose which AI each person thinks with, and see what they have spent"
        >
          🧠 Brains
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!view}
          onClick={() => setSpawning(true)}
          title="Bring a new person into the world"
        >
          + Spawn
        </button>
        <ViewMenu />
        <button
          type="button"
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
      {rateLimit && <RateLimitBanner notice={rateLimit} />}
      {spawnNote && (
        <div className="banner banner-info row-between" role="status">
          <span>{spawnNote}</span>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => setSpawnNote(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <ConditionsBar map={shownMap} onPickObject={pickObject} />
      {eventsOpen && (
        <WorldEventsDialog worldId={worldId} map={map} onClose={() => setEventsOpen(false)} />
      )}
      {brainsOpen && (
        <WorldBrainsDialog
          worldId={worldId}
          onClose={() => setBrainsOpen(false)}
          onSettingsUpdated={setWorldSettings}
        />
      )}
      {spawning && (
        <SpawnDialog
          worldId={worldId}
          onClose={() => setSpawning(false)}
          onSpawned={(id, note) => {
            if (note) setSpawnNote(note);
            if (spawnTimerRef.current !== null) clearTimeout(spawnTimerRef.current);
            spawnTimerRef.current = setTimeout(() => {
              spawnTimerRef.current = null;
              if (alive.current) pickAgent(id);
            }, 300);
          }}
        />
      )}

      <div
        className="world-body"
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
            '--timeline-height': `${timelineHeight}px`,
          } as CSSProperties
        }
      >
        <main className="map-area">
          {error && (
            <div className="banner banner-error" role="alert">
              {error}
            </div>
          )}
          <div className="map-wrap">
            {shownMap ? (
              <MapView map={shownMap} rendererRef={rendererRef} />
            ) : !error ? (
              <div className="map-loading muted">Loading village…</div>
            ) : null}
            <div className="map-controls" aria-label="Map controls">
              <button
                type="button"
                className="btn btn-icon"
                title="Zoom in (+)"
                aria-label="Zoom in"
                onClick={() => rendererRef.current?.zoomBy(1)}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-icon"
                title="Zoom out (−)"
                aria-label="Zoom out"
                onClick={() => rendererRef.current?.zoomBy(-1)}
              >
                −
              </button>
              <button
                type="button"
                className="btn btn-icon"
                title="Fit map (F)"
                aria-label="Fit map"
                onClick={() => rendererRef.current?.fit()}
              >
                ⤢
              </button>
            </div>
          </div>
          <ReplayBar worldId={worldId} />
          {timelineOpen && <EventLog onPickAgent={pickAgent} onPickObject={pickObject} />}
        </main>

        {sidebarOpen && (
          <aside className="sidebar">
            <div className="tabs" role="tablist">
              {(['selected', 'people', 'world'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
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
                  <SelectionDetails
                    worldId={worldId}
                    selection={selection}
                    map={shownMap}
                    ownersById={pastOwners ?? owners}
                    onPick={pickAgent}
                  />
                ) : (
                  <p className="muted">Click a person or anything on the map.</p>
                ))}
              {tab === 'people' && <PeopleList onPick={pickAgent} />}
              {tab === 'world' &&
                (view && worldSettings ? (
                  <WorldInfo
                    worldId={worldId}
                    view={view}
                    settings={worldSettings}
                    onSettingsChange={setWorldSettings}
                    map={map}
                    onOpenBrains={() => setBrainsOpen(true)}
                  />
                ) : (
                  <p className="muted">Loading…</p>
                ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function WorldInfo({
  worldId,
  view,
  settings,
  onSettingsChange,
  map,
  onOpenBrains,
}: {
  worldId: string;
  view: WorldViewResponse;
  settings: WorldSettings;
  onSettingsChange: (s: WorldSettings) => void;
  map: WorldMap | null;
  onOpenBrains: () => void;
}) {
  const [applyToAll, setApplyToAll] = useState(false);
  const [daysPerYear, setDaysPerYear] = useState(settings.daysPerYear);
  const [agingError, setAgingError] = useState<string | null>(null);
  const savedDaysRef = useRef(settings.daysPerYear);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/loading state when the fetch key changes
    setDaysPerYear(settings.daysPerYear);
    savedDaysRef.current = settings.daysPerYear;
  }, [settings.daysPerYear]);

  const commitAging = (nextDays: number) => {
    if (nextDays === savedDaysRef.current) return;
    setAgingError(null);
    void api
      .setAging(worldId, nextDays)
      .then((updated) => {
        savedDaysRef.current = updated.daysPerYear;
        onSettingsChange(updated);
      })
      .catch((e: unknown) => {
        setAgingError(e instanceof Error ? e.message : String(e));
        setDaysPerYear(savedDaysRef.current);
      });
  };

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
        <dd>{daysPerYear} in-game days per year</dd>
        {(['house', 'field', 'tree', 'berry_bush'] as MapObjectKind[]).map((k) => (
          <FactRow key={k} label={OBJECT_PLURALS[k]} value={counts.get(k) ?? 0} />
        ))}
      </dl>
      <h3>Aging speed</h3>
      <input
        type="range"
        min={1}
        max={30}
        value={daysPerYear}
        aria-label="In-game days per year of age"
        onChange={(e) => setDaysPerYear(Number(e.target.value))}
        onPointerUp={() => commitAging(daysPerYear)}
        onKeyUp={() => commitAging(daysPerYear)}
        onBlur={() => commitAging(daysPerYear)}
      />
      {agingError && (
        <p className="warn small" role="alert">
          {agingError}
        </p>
      )}
      <p className="muted small">
        One year of age every {daysPerYear} in-game day{daysPerYear === 1 ? '' : 's'} (a lifetime of
        ~70 years ≈ {Math.round(70 * daysPerYear)} days). Lower is faster.
      </p>
      <h3>Town market</h3>
      <MarketPanel worldId={worldId} />
      <h3>Village</h3>
      <VillagePanel worldId={worldId} />
      <h3>Default brain</h3>
      <p className="muted small">
        Used for newborns and spawned people. You can also set each person’s brain in their
        inspector, or everyone at once in{' '}
        <button type="button" className="linkish" onClick={onOpenBrains}>
          Brains &amp; spending…
        </button>
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
          onSettingsChange(await api.setDefaultBrain(worldId, brain, applyToAll));
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
  ownersById,
  onPick,
}: {
  worldId: string;
  selection: MapSelection;
  map: WorldMap | null;
  ownersById: Record<string, string[]>;
  onPick: (id: string) => void;
}) {
  const liveResources = useWorld((s) => s.resources);
  const past = useWorld((s) => s.replay?.view);
  const resources = past?.resources ?? liveResources;
  if (selection.kind === 'agent')
    return (
      <AgentInspector
        key={selection.id}
        worldId={worldId}
        agentId={selection.id}
        onPick={onPick}
        atTick={past?.tick}
      />
    );
  if (selection.kind === 'object') {
    const object = map?.objects.find((o) => o.id === selection.id);
    if (!object) {
      return <p className="muted">This place does not exist at this moment.</p>;
    }
    const amount = resources[object.id] ?? (object.kind === 'tree' ? 4 : undefined);
    const owners = ownersById[object.id];
    const isCommonField = object.kind === 'field' && !(owners && owners.length > 0);
    const commonCrop = isCommonField
      ? Number(object.id.split('-')[1]) % 2 === 1
        ? 'Wheat'
        : 'Vegetables'
      : null;
    const amountLabel =
      object.kind === 'berry_bush'
        ? 'Berries'
        : object.kind === 'tree'
          ? 'Wood left'
          : commonCrop
            ? `${commonCrop} ready`
            : object.kind === 'field'
              ? 'Harvest ready'
              : 'Amount';
    return (
      <div className="selection">
        <div className="selection-title">{object.name ?? OBJECT_LABELS[object.kind]}</div>
        <div className="muted small">
          {OBJECT_LABELS[object.kind]} · at ({object.x}, {object.y})
          {object.w > 1 || object.h > 1 ? ` · ${object.w}×${object.h}` : ''}
        </div>
        {OBJECT_BLURBS[object.kind] && <p>{OBJECT_BLURBS[object.kind]}</p>}
        {object.burntTick !== undefined && (
          <p className="warn">
            Burnt down {formatClock(object.burntTick)} — being rebuilt (
            {Math.round((object.progress ?? 0) * 100)}%). Unusable until finished.
          </p>
        )}
        {object.burntTick === undefined && object.progress !== undefined && (
          <p>Being built ({Math.round(object.progress * 100)}%).</p>
        )}
        {owners?.length ? (
          <p>
            <strong>Owned by:</strong> {owners.join(', ')}
          </p>
        ) : null}
        {amount !== undefined && (
          <p>
            <strong>{amountLabel}:</strong> {amount}
          </p>
        )}
        {object.kind === 'market' && <MarketPanel worldId={worldId} />}
        {(object.kind === 'pen' ||
          object.kind === 'stall' ||
          (object.kind === 'field' && Boolean(owners?.length))) && (
          <VillageObjectFacts worldId={worldId} object={object} />
        )}
        <ObjectHistory
          key={object.id}
          worldId={worldId}
          objectId={object.id}
          atTick={past?.tick}
          onPick={onPick}
        />
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

/** A stall's goods, pen's animals, or owned field's sown crop from the village's records. */
function VillageObjectFacts({ worldId, object }: { worldId: string; object: MapObject }) {
  const { data: village } = useVillage(worldId);
  if (!village) return null;
  if (object.kind === 'stall') {
    const stall = village.stalls.find((s) => s.id === object.id);
    if (!stall) return null;
    return (
      <>
        <h3 className="village-sub">Goods for sale</h3>
        <StallStock stock={stall.stock} />
      </>
    );
  }
  if (object.kind === 'field') {
    const field = village.fields.find((f) => f.id === object.id);
    if (!field) return null;
    return (
      <p>
        <strong>Crop:</strong>{' '}
        {field.crop ? `${field.crop[0]!.toUpperCase()}${field.crop.slice(1)}` : 'Unsown'}
      </p>
    );
  }
  const pen = village.pens.find((p) => p.id === object.id);
  if (!pen) return null;
  return <PenFacts hens={pen.hens} sheep={pen.sheep} wool={pen.wool} />;
}

/** Says exactly what stopped the world: whose decision, which provider and model, which limit. */
function RateLimitBanner({ notice }: { notice: RateLimitNotice }) {
  const facts = rateLimitFacts(notice);
  const at = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      second: t - notice.at < 3_600_000 ? '2-digit' : undefined,
    });
  return (
    <div className="banner banner-warn rate-limit-banner" role="alert">
      <strong>Time is paused: an AI rate limit was hit.</strong> {rateLimitSource(notice)}
      {facts && <> · {facts}</>}
      <div className="rate-limit-message">“{notice.message}”</div>
      <div>
        {notice.resumeAt !== null ? (
          <>Resumes by itself around {at(notice.resumeAt)}, or press Play to try sooner. </>
        ) : (
          <>The provider didn't say when the limit lifts. Press Play to try again. </>
        )}
        {notice.agentName}'s decision will be asked again. Fewer people on this model, Frugal
        effort, or a slower speed make limits less likely.
      </div>
    </div>
  );
}
