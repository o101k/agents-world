import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainRouter } from '@aw/brain';
import {
  CreateWorldRequest,
  DEFAULT_SPEED,
  WORLD_ID_PATTERN,
  encodeMap,
  type AgentDetail,
  type WorldMeta,
  type WorldViewResponse,
} from '@aw/shared';
import { agentDetail, agentView, createWorldState, type TickInput } from '@aw/sim';
import { WorldFile } from './worldFile.ts';
import { WorldRunner, type RunnerHooks } from './worldRunner.ts';

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

interface AppState {
  activeWorldId: string | null;
}

export interface WorldManagerOptions {
  log?: (msg: string) => void;
  brains?: BrainRouter;
  /** Hooks for the active world's runner; receive the world id. */
  hooks?: (worldId: string) => RunnerHooks;
}

/**
 * Owns the data directory: creates, lists, activates and deletes worlds, and runs the active one.
 * Layout:  <dataDir>/app.json  and  <dataDir>/worlds/<worldId>.sqlite
 */
export class WorldManager {
  private readonly worldsDir: string;
  private readonly appStatePath: string;
  private readonly files = new Map<string, WorldFile>();
  private appState: AppState;
  private runner: WorldRunner | null = null;
  private readonly log: (msg: string) => void;
  readonly brains: BrainRouter;

  constructor(
    readonly dataDir: string,
    private readonly options: WorldManagerOptions = {},
  ) {
    this.log = options.log ?? (() => {});
    this.brains = options.brains ?? new BrainRouter();
    this.worldsDir = join(dataDir, 'worlds');
    this.appStatePath = join(dataDir, 'app.json');
    mkdirSync(this.worldsDir, { recursive: true });
    this.appState = this.readAppState();
    const active = this.appState.activeWorldId;
    if (active && !existsSync(this.pathFor(active))) this.setActive(null);
    else if (active) this.startRunner(active);
  }

  get activeWorldId(): string | null {
    return this.appState.activeWorldId;
  }

  /** The running world, if any. */
  get active(): WorldRunner | null {
    return this.runner;
  }

  list(): WorldMeta[] {
    const worlds: WorldMeta[] = [];
    for (const name of readdirSync(this.worldsDir)) {
      const id = name.replace(/\.sqlite$/, '');
      if (!name.endsWith('.sqlite') || !WORLD_ID_PATTERN.test(id)) continue;
      try {
        worlds.push(this.runner?.id === id ? this.runner.currentMeta() : this.file(id).readMeta());
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
      population: state.agents.filter((a) => a.alive).length,
      running: false,
      speed: DEFAULT_SPEED,
    };
    const file = WorldFile.create(this.pathFor(id), meta, state);
    file.writeMeta({ population: meta.population, running: false, speed: DEFAULT_SPEED });
    this.files.set(id, file);
    this.log(`Created world "${meta.name}" (${id}, seed ${seed})`);
    return meta;
  }

  /** Make a world the active one: the previous one is saved and stops; this one resumes. */
  async activate(id: string): Promise<WorldMeta> {
    const file = this.file(id);
    if (this.runner?.id !== id) {
      await this.stopRunner();
      file.writeMeta({ updatedAt: new Date().toISOString() });
      this.startRunner(id);
    }
    this.setActive(id);
    return this.runner!.currentMeta();
  }

  async delete(id: string): Promise<void> {
    const path = this.pathFor(id);
    if (!existsSync(path)) throw new NotFoundError(`World ${id} not found`);
    if (this.runner?.id === id) await this.stopRunner();
    this.files.get(id)?.close();
    this.files.delete(id);
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    if (this.appState.activeWorldId === id) this.setActive(null);
    this.log(`Deleted world ${id}`);
  }

  view(id: string): WorldViewResponse {
    const runner = this.requireActive(id);
    const state = runner.state;
    return {
      meta: runner.currentMeta(),
      settings: state.settings,
      map: encodeMap(state.map),
      tick: state.tick,
      runner: runner.status(),
      agents: state.agents.map(agentView),
      resources: runner.resourceAmounts(),
    };
  }

  agent(worldId: string, agentId: string): AgentDetail {
    const state = this.requireActive(worldId).state;
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) throw new NotFoundError(`No such person ${agentId}`);
    return agentDetail(state, agent);
  }

  events(worldId: string, query: Parameters<WorldFile['queryEvents']>[0]) {
    return this.file(worldId).queryEvents(query);
  }

  control(worldId: string, req: { running?: boolean; speed?: number }): void {
    const runner = this.requireActive(worldId);
    if (req.speed !== undefined) runner.setSpeed(req.speed);
    if (req.running !== undefined) runner.setRunning(req.running);
  }

  async submit(worldId: string, input: TickInput): Promise<void> {
    await this.requireActive(worldId).submit(input);
  }

  async closeAll(): Promise<void> {
    await this.stopRunner();
    for (const file of this.files.values()) file.close();
    this.files.clear();
  }

  private requireActive(id: string): WorldRunner {
    if (!existsSync(this.pathFor(id))) throw new NotFoundError(`World ${id} not found`);
    if (this.runner?.id !== id)
      throw new ConflictError('Open this world first (only the active world runs).');
    return this.runner;
  }

  private startRunner(id: string): void {
    this.runner = WorldRunner.open(this.file(id), this.brains, this.options.hooks?.(id) ?? {});
  }

  private async stopRunner(): Promise<void> {
    const r = this.runner;
    this.runner = null;
    await r?.stop();
  }

  private file(id: string): WorldFile {
    let file = this.files.get(id);
    if (!file) {
      const path = this.pathFor(id);
      if (!existsSync(path)) throw new NotFoundError(`World ${id} not found`);
      file = WorldFile.open(path);
      this.files.set(id, file);
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
