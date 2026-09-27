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
    const a = wm.create({ name: 'Alpha', seed: 'a', mapSize: 'small' });
    const b = wm.create({ name: 'Bravo', mapSize: 'small' });
    expect(
      wm
        .list()
        .map((w) => w.name)
        .sort(),
    ).toEqual(['Alpha', 'Bravo']);
    expect(a.mapWidth).toBe(48);
    expect(a.population).toBe(8);
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
    const w = first.create({ name: 'Persist', seed: 'keep', mapSize: 'small' });
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
    const a = wm.create({ name: 'A', seed: 'twin', mapSize: 'small' });
    const b = wm.create({ name: 'B', seed: 'twin', mapSize: 'small' });
    await wm.activate(a.id);
    expect(() => wm.view(b.id)).toThrow(/Open this world first/);
    await wm.activate(b.id);
    expect(wm.view(b.id).map.tiles).toBeTruthy();
    await wm.closeAll();
  });

  it('rejects invalid input and unknown ids', async () => {
    const wm = new WorldManager(dir);
    expect(() => wm.create({ name: '   ' })).toThrow();
    await expect(wm.activate('w_doesnotexist')).rejects.toThrow(/not found/);
    await expect(wm.delete('../../etc/passwd')).rejects.toThrow(/Invalid world id/);
    await wm.closeAll();
  });
});
