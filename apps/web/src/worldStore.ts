import { create } from 'zustand';
import type {
  ActiveCondition,
  CalendarView,
  ReplayResponse,
  AgentView,
  RunnerStatus,
  WorldEvent,
  WorldViewResponse,
} from '@aw/shared';
import type { MapSelection } from './map/renderer.ts';

const MAX_EVENTS = 600;

interface WorldRuntime {
  worldId: string | null;
  tick: number;
  runner: RunnerStatus;
  agents: AgentView[];
  /** Resource amounts by object id (full set, kept up to date from frames). */
  resources: Record<string, number>;
  /** Latest changed resources, for the renderer. */
  resourceChanges: Record<string, number>;
  /** Newest first. */
  events: WorldEvent[];
  selection: MapSelection | null;
  followId: string | null;
  /** Bumped by the helper when the map changes (e.g. a house is built). */
  mapVersion: number;
  /** World events in progress (drought, storm, sickness, fires, plenty). */
  conditions: ActiveCondition[];
  calendar: CalendarView | null;

  /**
   * Replay mode: the tick asked for and the past view being shown (null = live). The live world
   * keeps running meanwhile.
   */
  replay: { target: number; view: ReplayResponse | null } | null;
  setReplayTarget: (tick: number | null) => void;
  setReplayView: (view: ReplayResponse) => void;

  load: (worldId: string, view: WorldViewResponse, events: WorldEvent[]) => void;
  applyFrame: (
    worldId: string,
    f: {
      tick: number;
      runner: RunnerStatus;
      agents: AgentView[];
      resources: Record<string, number>;
      mapVersion: number;
      conditions?: ActiveCondition[];
      calendar?: CalendarView;
    },
  ) => void;
  addEvents: (worldId: string, events: WorldEvent[]) => void;
  select: (sel: MapSelection | null) => void;
  setFollow: (id: string | null) => void;
  reset: () => void;
}

const idle: RunnerStatus = {
  running: false,
  speed: 5,
  actualSpeed: 0,
  thinking: 0,
  spentUsd: 0,
  planUsd: 0,
  capUsd: 1,
  capReached: false,
  rateLimit: null,
};

export const useWorld = create<WorldRuntime>((set, get) => ({
  worldId: null,
  tick: 0,
  runner: idle,
  agents: [],
  resources: {},
  resourceChanges: {},
  events: [],
  selection: null,
  followId: null,
  mapVersion: 0,
  conditions: [],
  calendar: null,
  replay: null,
  setReplayTarget: (tick) =>
    set((s) =>
      tick === null
        ? { replay: null }
        : { replay: { target: tick, view: s.replay?.view ?? null }, followId: null },
    ),
  setReplayView: (view) =>
    set((s) => (s.replay ? { replay: { target: s.replay.target, view } } : {})),

  load: (worldId, view, events) =>
    set({
      worldId,
      tick: view.tick,
      runner: view.runner,
      agents: view.agents,
      resources: view.resources,
      resourceChanges: view.resources,
      events,
      selection: null,
      followId: null,
      conditions: view.conditions ?? [],
      calendar: view.calendar ?? null,
      replay: null,
    }),
  applyFrame: (worldId, f) => {
    if (get().worldId !== worldId) return;
    set((s) => ({
      tick: f.tick,
      runner: f.runner,
      agents: f.agents,
      resources: Object.keys(f.resources).length ? { ...s.resources, ...f.resources } : s.resources,
      resourceChanges: f.resources,
      mapVersion: f.mapVersion ?? s.mapVersion,
      conditions: f.conditions ?? s.conditions,
      calendar: f.calendar ?? s.calendar,
    }));
  },
  addEvents: (worldId, events) => {
    if (get().worldId !== worldId || events.length === 0) return;
    set((s) => ({ events: [...[...events].reverse(), ...s.events].slice(0, MAX_EVENTS) }));
  },
  select: (selection) => set({ selection }),
  setFollow: (followId) => set({ followId }),
  reset: () =>
    set({
      worldId: null,
      agents: [],
      events: [],
      selection: null,
      followId: null,
      resources: {},
      conditions: [],
      replay: null,
    }),
}));
