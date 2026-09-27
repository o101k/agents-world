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
  it('creates, lists, activates and deletes worlds', () => {
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
    expect(b.seed).toMatch(/^[0-9a-f]{8}$/);

    wm.activate(a.id);
    expect(wm.activeWorldId).toBe(a.id);

    wm.delete(a.id);
    expect(wm.activeWorldId).toBeNull();
    expect(wm.list().map((w) => w.name)).toEqual(['Bravo']);
    expect(readdirSync(join(dir, 'worlds')).filter((f) => f.startsWith(a.id))).toEqual([]);
    wm.closeAll();
  });

  it('persists worlds and the active world across restarts', () => {
    const first = new WorldManager(dir);
    const w = first.create({ name: 'Persist', seed: 'keep', mapSize: 'small' });
    first.activate(w.id);
    const before = first.view(w.id);
    first.closeAll();

    const second = new WorldManager(dir);
    expect(second.activeWorldId).toBe(w.id);
    const after = second.view(w.id);
    expect(after.meta.name).toBe('Persist');
    expect(after.map.tiles).toBe(before.map.tiles);
    expect(decodeMap(after.map).objects.length).toBe(before.map.objects.length);
    second.closeAll();
  });

  it('same seed gives the same map', () => {
    const wm = new WorldManager(dir);
    const a = wm.create({ name: 'A', seed: 'twin', mapSize: 'small' });
    const b = wm.create({ name: 'B', seed: 'twin', mapSize: 'small' });
    expect(wm.view(a.id).map.tiles).toBe(wm.view(b.id).map.tiles);
    wm.closeAll();
  });

  it('rejects invalid input and unknown ids', () => {
    const wm = new WorldManager(dir);
    expect(() => wm.create({ name: '   ' })).toThrow();
    expect(() => wm.activate('w_doesnotexist')).toThrow(/not found/);
    expect(() => wm.delete('../../etc/passwd')).toThrow(/Invalid world id/);
    wm.closeAll();
  });
});
