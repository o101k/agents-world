import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeMap, type BrainConfig, type CastPreviewRequest } from '@aw/shared';
import { SAMPLE_CAST } from '@aw/sim';
import { NotFoundError, ValidationError, WorldManager } from './worldManager.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('WorldManager', () => {
  it('creates, lists, activates and deletes worlds', async () => {
    const wm = new WorldManager(dir);
    const a = await wm.create({ name: 'Alpha', seed: 'a', mapSize: 'small' });
    const b = await wm.create({ name: 'Bravo', mapSize: 'small' });
    expect(
      wm
        .list()
        .map((w) => w.name)
        .sort(),
    ).toEqual(['Alpha', 'Bravo']);
    expect(a.mapWidth).toBe(48);
    expect(a.population).toBe(11);
    expect(b.seed).toMatch(/^[0-9a-f]{8}$/);

    await wm.activate(a.id);
    expect(wm.activeWorldId).toBe(a.id);
    expect(wm.active?.id).toBe(a.id);

    await wm.delete(a.id);
    expect(wm.activeWorldId).toBeNull();
    expect(wm.active).toBeNull();
    expect(wm.list().map((w) => w.name)).toEqual(['Bravo']);
    expect(readdirSync(join(dir, 'worlds')).filter((f) => f.startsWith(a.id))).toEqual([]);
    await wm.closeAll();
  });

  it('persists worlds and the active world across restarts', async () => {
    const first = new WorldManager(dir);
    const w = await first.create({ name: 'Persist', seed: 'keep', mapSize: 'small' });
    await first.activate(w.id);
    const before = first.view(w.id);
    await first.closeAll();

    const second = new WorldManager(dir);
    expect(second.activeWorldId).toBe(w.id);
    const after = second.view(w.id);
    expect(after.meta.name).toBe('Persist');
    expect(after.map.tiles).toBe(before.map.tiles);
    expect(decodeMap(after.map).objects.length).toBe(before.map.objects.length);
    expect(after.agents.map((a) => a.name)).toEqual(before.agents.map((a) => a.name));
    await second.closeAll();
  });

  it('only one world runs at a time', async () => {
    const wm = new WorldManager(dir);
    const a = await wm.create({ name: 'A', seed: 'twin', mapSize: 'small' });
    const b = await wm.create({ name: 'B', seed: 'twin', mapSize: 'small' });
    await wm.activate(a.id);
    expect(() => wm.view(b.id)).toThrow(/Open this world first/);
    await wm.activate(b.id);
    expect(wm.view(b.id).map.tiles).toBeTruthy();
    await wm.closeAll();
  });

  it('rejects invalid input and unknown ids', async () => {
    const wm = new WorldManager(dir);
    await expect(wm.create({ name: '   ' })).rejects.toThrow();
    await expect(wm.activate('w_doesnotexist')).rejects.toThrow(/not found/);
    await expect(wm.delete('../../etc/passwd')).rejects.toThrow(/Invalid world id/);
    await wm.closeAll();
  });
});

describe('starting casts', () => {
  it('creates worlds from a written cast and from a generated one', async () => {
    const wm = new WorldManager(dir);
    const custom = await wm.create({
      name: 'Custom',
      mapSize: 'small',
      cast: {
        mode: 'custom',
        people: [
          {
            name: 'Ada',
            familyName: 'Stone',
            sex: 'female',
            age: 30,
            household: 0,
            partner: 'Ben',
          },
          { name: 'Ben', familyName: 'Stone', sex: 'male', age: 32, household: 0, partner: 'Ada' },
          {
            name: 'Cal',
            familyName: 'Stone',
            sex: 'male',
            age: 0.4,
            household: 0,
            parents: ['Ada', 'Ben'],
          },
        ],
      },
    });
    expect(custom.population).toBe(3);
    await wm.activate(custom.id);
    const ada = wm.view(custom.id).agents.find((a) => a.name === 'Ada Stone')!;
    const tree = wm.familyTree(custom.id, ada.id);
    expect(tree.partner?.name).toBe('Ben Stone');
    expect(tree.children?.map((c) => c.name)).toEqual(['Cal Stone']);

    const gen = await wm.create({
      name: 'Gen',
      seed: 'g',
      mapSize: 'small',
      cast: { mode: 'generated', adults: 10, children: 5, useAi: false },
    });
    expect(gen.population).toBe(15);
    await expect(
      wm.create({
        name: 'Dup',
        cast: {
          mode: 'custom',
          people: [
            { name: 'X', sex: 'male', age: 20 },
            { name: 'X', sex: 'female', age: 20 },
          ],
        },
      }),
    ).rejects.toThrow(/unique/);
    await wm.closeAll();
  });
});

const CLAUDE: BrainConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  effort: 'standard',
};
const PLAN: BrainConfig = { provider: 'claude_plan', model: 'haiku', effort: 'deep' };
const MOCK: BrainConfig = { provider: 'mock', model: '', effort: 'frugal' };

describe('choosing brains when a world is created', () => {
  it('gives each villager their own brain and everyone else the default', async () => {
    const wm = new WorldManager(dir);
    const before = JSON.stringify(SAMPLE_CAST);
    // 11 villagers in the sample cast; only the first three are picked by hand.
    const w = await wm.create({
      name: 'Picked',
      seed: 'picked',
      mapSize: 'small',
      brains: [CLAUDE, PLAN, MOCK],
      defaultBrain: CLAUDE,
    });
    await wm.activate(w.id);
    const { people, defaultBrain } = wm.brainsView(w.id);
    expect(people).toHaveLength(11);
    expect(people.map((p) => p.brain)).toEqual([CLAUDE, PLAN, MOCK, ...Array(8).fill(CLAUDE)]);
    expect(defaultBrain).toEqual(CLAUDE);
    expect(wm.view(w.id).settings.defaultBrain).toEqual(CLAUDE);
    // The shared sample cast isn't changed by any of this.
    expect(JSON.stringify(SAMPLE_CAST)).toBe(before);
    await wm.closeAll();
  });

  it('keeps starting everyone on the free Mock brain when none is chosen', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Plain', seed: 'plain', mapSize: 'small' });
    await wm.activate(w.id);
    const { people, defaultBrain } = wm.brainsView(w.id);
    expect(people.every((p) => p.brain.provider === 'mock')).toBe(true);
    expect(defaultBrain.provider).toBe('mock');
    await wm.closeAll();
  });

  it('uses the default brain for people who arrive later', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({
      name: 'Later',
      seed: 'later',
      mapSize: 'small',
      defaultBrain: PLAN,
    });
    await wm.activate(w.id);
    const { agentId } = await wm.spawn(w.id, {
      description: 'A tinker who mends pots.',
      name: 'Hob',
    });
    expect(wm.agent(w.id, agentId).brain).toEqual(PLAN);
    await wm.closeAll();
  });

  it('refuses more brains than there are people, and makes no world', async () => {
    const wm = new WorldManager(dir);
    await expect(
      wm.create({ name: 'Too many', mapSize: 'small', brains: Array(12).fill(MOCK) }),
    ).rejects.toThrow(ValidationError);
    await expect(
      wm.create({ name: 'Bad brain', mapSize: 'small', brains: [{ provider: 'nope' } as never] }),
    ).rejects.toThrow();
    expect(wm.list()).toEqual([]);
    await wm.closeAll();
  });
});

describe('changing brains in a running world', () => {
  it('changes several people with one logged input and one tick', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Bulk', seed: 'bulk', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    const ids = runner.state.agents.slice(0, 4).map((a) => a.id);
    const tick = runner.state.tick;
    const view = await wm.setBrains(w.id, [...ids, ids[0]!], CLAUDE);
    expect(runner.state.tick).toBe(tick + 1);
    expect(view.people.filter((p) => p.brain.provider === 'anthropic').map((p) => p.id)).toEqual(
      ids,
    );
    expect(wm.brainsView(w.id)).toEqual(view);
    expect(runner.state.agents.filter((a) => a.brain.provider === 'anthropic')).toHaveLength(4);
    // The default for newborns is separate.
    expect(view.defaultBrain).toEqual(MOCK);

    // Survives a restart (the change is a logged input).
    await wm.closeAll();
    const again = new WorldManager(dir);
    expect(
      again.brainsView(w.id).people.filter((p) => p.brain.provider === 'anthropic'),
    ).toHaveLength(4);
    await again.closeAll();
  });

  it('refuses unknown people without changing anyone', async () => {
    const wm = new WorldManager(dir);
    const w = await wm.create({ name: 'Unknown', seed: 'unknown', mapSize: 'small' });
    await wm.activate(w.id);
    const runner = wm.active!;
    const tick = runner.state.tick;
    await expect(wm.setBrains(w.id, ['a1', 'a999'], CLAUDE)).rejects.toThrow(NotFoundError);
    expect(runner.state.tick).toBe(tick);
    expect(runner.state.agents.every((a) => a.brain.provider === 'mock')).toBe(true);
    await wm.closeAll();
  });

  it('only works on the active world', async () => {
    const wm = new WorldManager(dir);
    const a = await wm.create({ name: 'A', seed: 'a', mapSize: 'small' });
    await wm.create({ name: 'B', seed: 'b', mapSize: 'small' });
    await expect(wm.setBrains(a.id, ['a1'], CLAUDE)).rejects.toThrow(/Open this world first/);
    expect(() => wm.brainsView(a.id)).toThrow(/Open this world first/);
    await wm.closeAll();
  });
});

describe('previewing the starting cast', () => {
  /** What `create` makes, to compare with what `previewCast` promised. */
  async function createdPeople(wm: WorldManager, req: CastPreviewRequest, seed: string) {
    const w = await wm.create({ name: 'Preview', seed, mapSize: 'medium', cast: req.cast });
    await wm.activate(w.id);
    return wm.view(w.id).agents.map((a) => {
      const d = wm.agent(w.id, a.id);
      return {
        name: `${d.name}`,
        sex: d.sex,
        age: d.age,
        occupation: d.occupation,
      };
    });
  }

  const previewed = (preview: ReturnType<WorldManager['previewCast']>) =>
    preview.people.map((p) => ({
      name: p.familyName ? `${p.name} ${p.familyName}` : p.name,
      sex: p.sex,
      age: p.age,
      occupation: p.occupation,
    }));

  it('matches the sample cast the world is created with', async () => {
    const wm = new WorldManager(dir);
    const preview = wm.previewCast({ seed: 'sample-seed' });
    expect(preview.seed).toBe('sample-seed');
    expect(preview.people).toHaveLength(11);
    expect(preview.people.map((p) => p.index)).toEqual([...Array(11).keys()]);
    expect(previewed(preview)).toEqual(
      await createdPeople(wm, { seed: 'sample-seed', cast: { mode: 'sample' } }, 'sample-seed'),
    );
    await wm.closeAll();
  });

  it('matches a written cast, including the default occupations', async () => {
    const wm = new WorldManager(dir);
    const cast: CastPreviewRequest['cast'] = {
      mode: 'custom',
      people: [
        { name: 'Ada', familyName: 'Stone', sex: 'female', age: 30, occupation: 'weaver' },
        { name: 'Ben', familyName: 'Stone', sex: 'male', age: 32 },
        { name: 'Cal', familyName: 'Stone', sex: 'male', age: 0.4 },
        { name: 'Dot', sex: 'female', age: 7.8 },
      ],
    };
    const preview = wm.previewCast({ seed: 'custom-seed', cast });
    expect(preview.people.map((p) => p.occupation)).toEqual([
      'weaver',
      'villager',
      'baby',
      'child',
    ]);
    expect(preview.people.map((p) => p.age)).toEqual([30, 32, 0, 7]);
    expect(preview.people[3]).toMatchObject({ name: 'Dot', familyName: '', index: 3 });
    expect(previewed(preview)).toEqual(await createdPeople(wm, { cast }, 'custom-seed'));
    await wm.closeAll();
  });

  it('matches a generated cast with the same seed, and a different seed gives different people', async () => {
    const wm = new WorldManager(dir);
    const cast: CastPreviewRequest['cast'] = {
      mode: 'generated',
      adults: 12,
      children: 5,
      useAi: true, // no AI is set up; a preview never calls one anyway
    };
    const preview = wm.previewCast({ seed: 'gen-seed', cast });
    expect(preview.people).toHaveLength(17);
    expect(previewed(preview)).toEqual(await createdPeople(wm, { cast }, 'gen-seed'));
    expect(wm.previewCast({ seed: 'gen-seed', cast })).toEqual(preview);
    expect(previewed(wm.previewCast({ seed: 'another-seed', cast }))).not.toEqual(
      previewed(preview),
    );
    await wm.closeAll();
  });

  it('picks a random seed when none is given, and it reproduces the same cast', async () => {
    const wm = new WorldManager(dir);
    const cast: CastPreviewRequest['cast'] = {
      mode: 'generated',
      adults: 6,
      children: 2,
      useAi: false,
    };
    const first = wm.previewCast({ cast });
    expect(first.seed).toMatch(/^[0-9a-f]{8}$/);
    expect(wm.previewCast({ seed: '  ', cast }).seed).not.toBe(first.seed);
    expect(wm.previewCast({ seed: first.seed, cast }).people).toEqual(first.people);
    await wm.closeAll();
  });

  it('rejects two people with the same first name and a malformed request', async () => {
    const wm = new WorldManager(dir);
    expect(() =>
      wm.previewCast({
        cast: {
          mode: 'custom',
          people: [
            { name: 'X', sex: 'male', age: 20 },
            { name: 'X', sex: 'female', age: 20 },
          ],
        },
      }),
    ).toThrow(/unique/);
    expect(() => wm.previewCast({ cast: { mode: 'custom', people: [] } })).toThrow();
    // Previewing creates nothing.
    expect(wm.list()).toEqual([]);
    await wm.closeAll();
  });
});
