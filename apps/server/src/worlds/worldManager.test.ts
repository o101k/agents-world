import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeMap } from '@aw/shared';
import { WorldManager } from './worldManager.ts';

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
