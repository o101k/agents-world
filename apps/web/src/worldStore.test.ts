import { beforeEach, describe, expect, it } from 'vitest';
import type { ReplayResponse, RunnerStatus, WorldViewResponse } from '@aw/shared';
import { useWorld } from './worldStore.ts';

const runner: RunnerStatus = {
  running: true,
  speed: 5,
  actualSpeed: 5,
  thinking: 0,
  spentUsd: 0,
  planUsd: 0,
  capUsd: 1,
  capReached: false,
  rateLimit: null,
};

const view = {
  tick: 420,
  runner,
  agents: [],
  resources: { 'berry_bush-1': 3 },
  conditions: [],
  calendar: { year: 1, season: 'spring', progress: 0.02 },
} as unknown as WorldViewResponse;

describe('the world store (browser state)', () => {
  beforeEach(() => {
    useWorld.getState().reset();
    useWorld.getState().load('w1', view, []);
  });

  it('applies live frames for the open world only', () => {
    const frame = {
      tick: 421,
      runner,
      agents: [],
      resources: { 'berry_bush-1': 2 },
      mapVersion: 0,
    };
    useWorld.getState().applyFrame('other-world', { ...frame, tick: 999 });
    expect(useWorld.getState().tick).toBe(420);
    useWorld.getState().applyFrame('w1', frame);
    expect(useWorld.getState().tick).toBe(421);
    expect(useWorld.getState().resources['berry_bush-1']).toBe(2);
  });

  it('keeps the newest events first', () => {
    const e = (tick: number) => ({
      tick,
      kind: 'ate' as const,
      actors: [],
      text: `t${tick}`,
      importance: 1,
    });
    useWorld.getState().addEvents('w1', [e(1), e(2)]);
    useWorld.getState().addEvents('w1', [e(3)]);
    expect(useWorld.getState().events.map((x) => x.tick)).toEqual([3, 2, 1]);
  });

  it('enters and leaves replay mode', () => {
    useWorld.getState().setFollow('a1');
    useWorld.getState().setReplayTarget(430);
    expect(useWorld.getState().replay).toEqual({ target: 430, view: null });
    expect(useWorld.getState().followId).toBeNull(); // following makes no sense in the past
    useWorld.getState().setReplayView({ tick: 430 } as ReplayResponse);
    expect(useWorld.getState().replay?.view?.tick).toBe(430);
    useWorld.getState().setReplayTarget(null);
    expect(useWorld.getState().replay).toBeNull();
    // A late answer after leaving replay is ignored.
    useWorld.getState().setReplayView({ tick: 440 } as ReplayResponse);
    expect(useWorld.getState().replay).toBeNull();
  });
});
