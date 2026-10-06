import { describe, expect, it } from 'vitest';
import type { BrainConfig } from '@aw/shared';
import { DEFAULT_BRAIN } from './cast.ts';
import { step } from './engine.ts';
import { createWorldState } from './world.ts';

const CLAUDE: BrainConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  effort: 'standard',
};
const PLAN: BrainConfig = { provider: 'claude_plan', model: 'haiku', effort: 'deep' };

describe('choosing brains', () => {
  it('set_brains gives each listed person the brain, skipping unknown ids, living or dead', () => {
    const s = createWorldState({ seed: 'brains', mapSize: 'small' });
    const [a, b, c] = s.agents;
    c!.alive = false;
    step(s, [{ kind: 'set_brains', agentIds: [a!.id, c!.id, 'a999'], brain: CLAUDE }]);
    expect(a!.brain).toEqual(CLAUDE);
    expect(c!.brain).toEqual(CLAUDE);
    expect(b!.brain).toEqual(DEFAULT_BRAIN);
    expect(s.agents.filter((x) => x.brain.provider === 'anthropic')).toHaveLength(2);
    // Each person gets their own copy, so changing one later can't change another.
    expect(a!.brain).not.toBe(c!.brain);
    expect(a!.brain).not.toBe(CLAUDE);
  });

  it('starts a world with the given default brain for everyone without their own', () => {
    const s = createWorldState({
      seed: 'default-brain',
      mapSize: 'small',
      cast: [
        { name: 'Ada', sex: 'female', age: 30, household: 0 },
        { name: 'Ben', sex: 'male', age: 32, household: 0, brain: PLAN },
      ],
      defaultBrain: CLAUDE,
    });
    expect(s.settings.defaultBrain).toEqual(CLAUDE);
    expect(s.agents.find((x) => x.name === 'Ada')!.brain).toEqual(CLAUDE);
    expect(s.agents.find((x) => x.name === 'Ben')!.brain).toEqual(PLAN);
  });

  it('is the free Mock brain when no default is given', () => {
    const s = createWorldState({ seed: 'mock-default', mapSize: 'small' });
    expect(s.settings.defaultBrain).toEqual(DEFAULT_BRAIN);
    expect(s.agents.every((x) => x.brain.provider === 'mock')).toBe(true);
  });

  it('gives spawned people the world default', () => {
    const s = createWorldState({ seed: 'spawn-default', mapSize: 'small', defaultBrain: PLAN });
    step(s, [
      {
        kind: 'spawn_agent',
        spec: { name: 'Hob', sex: 'male', age: 40, knowsVillage: false, homeId: null },
      },
    ]);
    const hob = s.agents.find((x) => x.name === 'Hob')!;
    expect(hob.brain).toEqual(PLAN);
    // The default can be changed later, and only affects people who arrive afterwards.
    step(s, [{ kind: 'set_default_brain', brain: CLAUDE }]);
    step(s, [
      {
        kind: 'spawn_agent',
        spec: { name: 'Ivo', sex: 'male', age: 41, knowsVillage: false, homeId: null },
      },
    ]);
    expect(s.agents.find((x) => x.name === 'Ivo')!.brain).toEqual(CLAUDE);
    expect(hob.brain).toEqual(PLAN);
  });
});
