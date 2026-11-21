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
  replay: { target: number; view: ReplayResponse | null; session: number } | null;
  replaySession: number;
  setReplayTarget: (tick: number | null) => void;
  setReplayView: (view: ReplayResponse, worldId?: string, session?: number) => void;

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
  replaySession: 0,
  setReplayTarget: (tick) =>
    set((s) => {
      if (tick === null) return { replay: null, replaySession: s.replaySession + 1 };
      const session = s.replay ? s.replay.session : s.replaySession + 1;
      return {
        replay: { target: tick, view: s.replay?.view ?? null, session },
        replaySession: session,
        followId: null,
      };
    }),
  setReplayView: (view, worldId, session) =>
    set((s) => {
      if (!s.replay) return {};
      if (worldId !== undefined && s.worldId !== worldId) return {};
      if (session !== undefined && s.replay.session !== session) return {};
      return { replay: { target: s.replay.target, view, session: s.replay.session } };
    }),

  load: (worldId, view, events) =>
    set((s) => ({
      worldId,
      tick: view.tick,
      runner: view.runner,
      agents: view.agents,
      resources: view.resources,
      resourceChanges: view.resources,
      mapVersion: view.mapVersion,
      events,
      selection: s.worldId === worldId ? s.selection : null,
      followId: s.worldId === worldId ? s.followId : null,
      conditions: view.conditions ?? [],
      calendar: view.calendar ?? null,
      replay: s.worldId === worldId ? s.replay : null,
    })),
  applyFrame: (worldId, f) => {
    if (get().worldId !== worldId) return;
    const hasChanges = Object.keys(f.resources).length > 0;
    set((s) => ({
      tick: f.tick,
      runner: f.runner,
      agents: f.agents,
      resources: hasChanges ? { ...s.resources, ...f.resources } : s.resources,
      resourceChanges: hasChanges ? f.resources : s.resourceChanges,
      mapVersion: f.mapVersion ?? s.mapVersion,
      conditions: f.conditions ?? s.conditions,
      calendar: f.calendar ?? s.calendar,
    }));
  },
  addEvents: (worldId, events) => {
    if (get().worldId !== worldId || events.length === 0) return;
    set((s) => {
      const seen = new Set(s.events.map((e) => e.id).filter((id) => id !== undefined));
      const fresh = [...events].reverse().filter((e) => {
        if (e.id === undefined) return true;
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      if (fresh.length === 0) return {};
      return { events: [...fresh, ...s.events].slice(0, MAX_EVENTS) };
    });
  },
  select: (selection) => set({ selection }),
  setFollow: (followId) => set({ followId }),
  reset: () =>
    set((s) => ({
      worldId: null,
      tick: 0,
      runner: idle,
      agents: [],
      events: [],
      selection: null,
      followId: null,
      resources: {},
      resourceChanges: {},
      mapVersion: 0,
      conditions: [],
      calendar: null,
      replay: null,
      replaySession: s.replaySession + 1,
    })),
}));
