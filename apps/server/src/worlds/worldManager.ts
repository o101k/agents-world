import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateWorldRequest,
  WORLD_ID_PATTERN,
  encodeMap,
  type WorldMeta,
  type WorldViewResponse,
} from '@aw/shared';
import { createWorldState, type WorldState } from '@aw/sim';
import { WorldFile } from './worldFile.ts';

export class NotFoundError extends Error {}

interface AppState {
  activeWorldId: string | null;
}

/**
 * Owns the data directory: creates, lists, activates and deletes worlds.
 * Layout:  <dataDir>/app.json  and  <dataDir>/worlds/<worldId>.sqlite
 */
export class WorldManager {
  private readonly worldsDir: string;
  private readonly appStatePath: string;
  private readonly open = new Map<string, WorldFile>();
  private readonly states = new Map<string, WorldState>();
  private appState: AppState;

  constructor(
    readonly dataDir: string,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.worldsDir = join(dataDir, 'worlds');
    this.appStatePath = join(dataDir, 'app.json');
    mkdirSync(this.worldsDir, { recursive: true });
    this.appState = this.readAppState();
    if (this.appState.activeWorldId && !existsSync(this.pathFor(this.appState.activeWorldId))) {
      this.setActive(null);
    }
  }

  get activeWorldId(): string | null {
    return this.appState.activeWorldId;
  }

  list(): WorldMeta[] {
    const worlds: WorldMeta[] = [];
    for (const name of readdirSync(this.worldsDir)) {
      const id = name.replace(/\.sqlite$/, '');
      if (!name.endsWith('.sqlite') || !WORLD_ID_PATTERN.test(id)) continue;
      try {
        worlds.push(this.file(id).readMeta());
      } catch (err) {
        this.log(`Skipping unreadable world file ${name}: ${(err as Error).message}`);
      }
    }
    return worlds.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(input: CreateWorldRequest): WorldMeta {
    const req = CreateWorldRequest.parse(input);
    const id = `w_${randomBytes(6).toString('hex')}`;
    const seed = req.seed || randomBytes(4).toString('hex');
    const state = createWorldState({ seed, mapSize: req.mapSize });
    const now = new Date().toISOString();
    const meta: WorldMeta = {
      id,
      name: req.name,
      seed,
      createdAt: now,
      updatedAt: now,
      tick: state.tick,
      mapWidth: state.map.width,
      mapHeight: state.map.height,
    };
    const file = WorldFile.create(this.pathFor(id), meta, state);
    this.open.set(id, file);
    this.states.set(id, state);
    this.log(`Created world "${meta.name}" (${id}, seed ${seed})`);
    return meta;
  }

  activate(id: string): WorldMeta {
    const file = this.file(id);
    const meta = file.readMeta();
    this.state(id); // load now so problems surface on activation
    const updatedAt = new Date().toISOString();
    file.writeMeta({ updatedAt });
    this.setActive(id);
    return { ...meta, updatedAt };
  }

  delete(id: string): void {
    const path = this.pathFor(id);
    if (!existsSync(path)) throw new NotFoundError(`World ${id} not found`);
    this.open.get(id)?.close();
    this.open.delete(id);
    this.states.delete(id);
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    if (this.appState.activeWorldId === id) this.setActive(null);
    this.log(`Deleted world ${id}`);
  }

  view(id: string): WorldViewResponse {
    const meta = this.file(id).readMeta();
    const state = this.state(id);
    return { meta, settings: state.settings, map: encodeMap(state.map) };
  }

  closeAll(): void {
    for (const file of this.open.values()) file.close();
    this.open.clear();
    this.states.clear();
  }

  private state(id: string): WorldState {
    let state = this.states.get(id);
    if (!state) {
      state = this.file(id).loadLatestSnapshot();
      this.states.set(id, state);
    }
    return state;
  }

  private file(id: string): WorldFile {
    let file = this.open.get(id);
    if (!file) {
      const path = this.pathFor(id);
      if (!existsSync(path)) throw new NotFoundError(`World ${id} not found`);
      file = WorldFile.open(path);
      this.open.set(id, file);
    }
    return file;
  }

  private pathFor(id: string): string {
    if (!WORLD_ID_PATTERN.test(id)) throw new NotFoundError(`Invalid world id ${id}`);
    return join(this.worldsDir, `${id}.sqlite`);
  }

  private readAppState(): AppState {
    try {
      const parsed = JSON.parse(readFileSync(this.appStatePath, 'utf8')) as Partial<AppState>;
      return {
        activeWorldId: typeof parsed.activeWorldId === 'string' ? parsed.activeWorldId : null,
      };
    } catch {
      return { activeWorldId: null };
    }
  }

  private setActive(id: string | null): void {
    this.appState = { ...this.appState, activeWorldId: id };
    writeFileSync(this.appStatePath, JSON.stringify(this.appState, null, 2));
  }
}
