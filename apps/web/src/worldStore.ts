import { create } from 'zustand';
import type { AgentView, RunnerStatus, WorldEvent, WorldViewResponse } from '@aw/shared';
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

  load: (worldId: string, view: WorldViewResponse, events: WorldEvent[]) => void;
  applyFrame: (
    worldId: string,
    f: {
      tick: number;
      runner: RunnerStatus;
      agents: AgentView[];
      resources: Record<string, number>;
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
  capUsd: 1,
  capReached: false,
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
    }),
  applyFrame: (worldId, f) => {
    if (get().worldId !== worldId) return;
    set((s) => ({
      tick: f.tick,
      runner: f.runner,
      agents: f.agents,
      resources: Object.keys(f.resources).length ? { ...s.resources, ...f.resources } : s.resources,
      resourceChanges: f.resources,
    }));
  },
  addEvents: (worldId, events) => {
    if (get().worldId !== worldId || events.length === 0) return;
    set((s) => ({ events: [...[...events].reverse(), ...s.events].slice(0, MAX_EVENTS) }));
  },
  select: (selection) => set({ selection }),
  setFollow: (followId) => set({ followId }),
  reset: () =>
    set({ worldId: null, agents: [], events: [], selection: null, followId: null, resources: {} }),
}));
