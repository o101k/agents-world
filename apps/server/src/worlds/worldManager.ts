import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainRouter, draftPerson } from '@aw/brain';
import {
  CreateWorldRequest,
  DEFAULT_CAP_USD,
  DEFAULT_SPEED,
  WORLD_ID_PATTERN,
  encodeMap,
  type AgentDetail,
  type BrainConfig,
  type FamilyNode,
  type LlmCallView,
  type MarketResponse,
  type SpawnRequest,
  type WorldMeta,
  type WorldViewResponse,
} from '@aw/shared';
import {
  SAMPLE_CAST,
  agentDetail,
  agentView,
  allQuotes,
  createWorldState,
  generateCast,
  ownerNames,
  type AgentSpec,
  type TickInput,
} from '@aw/sim';
import { WorldFile } from './worldFile.ts';
import { WorldRunner, type RunnerHooks } from './worldRunner.ts';

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
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

  async create(input: CreateWorldRequest): Promise<WorldMeta> {
    const req = CreateWorldRequest.parse(input);
    const id = `w_${randomBytes(6).toString('hex')}`;
    const seed = req.seed || randomBytes(4).toString('hex');
    const cast = await this.buildCast(req.cast, seed);
    const state = createWorldState({ seed, mapSize: req.mapSize, cast });
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
      spentUsd: 0,
      capUsd: DEFAULT_CAP_USD,
    };
    const file = WorldFile.create(this.pathFor(id), meta, state);
    this.files.set(id, file);
    this.log(`Created world "${meta.name}" (${id}, seed ${seed})`);
    return meta;
  }

  /** Turn the chosen cast option into people specs. */
  private async buildCast(option: CreateWorldRequest['cast'], seed: string): Promise<AgentSpec[]> {
    const opt = option ?? { mode: 'sample' };
    if (opt.mode === 'sample') return SAMPLE_CAST;
    if (opt.mode === 'custom') {
      const names = new Set<string>();
      for (const p of opt.people) {
        if (names.has(p.name))
          throw new ValidationError(
            `Two people are both called ${p.name}; first names must be unique.`,
          );
        names.add(p.name);
      }
      return opt.people.map((p, i) => ({
        ...p,
        household: p.household ?? i,
        occupation:
          p.occupation ||
          (p.age < 1 ? 'baby' : p.age < 3 ? 'toddler' : p.age < 13 ? 'child' : 'villager'),
        parents: p.parents?.filter(Boolean),
        partner: p.partner || undefined,
      }));
    }
    const cast = generateCast(seed, { adults: opt.adults, children: opt.children });
    if (!opt.useAi) return cast;
    // Flesh out each adult with the first AI provider that's set up.
    const order: BrainConfig['provider'][] = ['anthropic', 'openai', 'openai_compatible'];
    const provider = order.find((p) => this.brains.has(p));
    if (!provider) return cast;
    const brain: BrainConfig = { provider, model: '', effort: 'frugal' };
    for (const spec of cast) {
      if (spec.age < 16) continue;
      const partner = spec.partner ? ` Partner: ${spec.partner}.` : '';
      const kids = cast.filter((c) => c.parents?.includes(spec.name)).map((c) => c.name);
      const { draft } = await draftPerson(
        {
          description: `A ${spec.age}-year-old ${spec.sex === 'female' ? 'woman' : 'man'} who works as a ${spec.occupation}. ${spec.traits}${partner}${kids.length ? ` Children: ${kids.join(', ')}.` : ''}`,
          name: spec.name,
          sex: spec.sex,
          age: Math.max(16, Math.round(spec.age)),
        },
        brain,
        this.brains,
      );
      spec.traits = draft.traits;
      spec.background = draft.background;
      spec.personality = draft.personality;
    }
    return cast;
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
      owners: ownerNames(state),
    };
  }

  market(worldId: string): MarketResponse {
    const state = this.requireActive(worldId).state;
    return {
      stock: { ...state.market.stock },
      quotes: allQuotes(state.market),
      moneySupply: state.agents.filter((a) => a.alive).reduce((s, a) => s + a.money, 0),
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

  async setBrain(worldId: string, agentId: string, brain: BrainConfig): Promise<void> {
    const runner = this.requireActive(worldId);
    if (!runner.state.agents.some((a) => a.id === agentId))
      throw new NotFoundError(`No such person ${agentId}`);
    await runner.submit({ kind: 'set_brain', agentId, brain });
  }

  async setDefaultBrain(worldId: string, brain: BrainConfig, applyToAll: boolean): Promise<void> {
    await this.requireActive(worldId).submit({ kind: 'set_default_brain', brain, applyToAll });
  }

  setCap(worldId: string, capUsd: number): void {
    this.requireActive(worldId).setCap(capUsd);
  }

  async setAging(worldId: string, daysPerYear: number): Promise<void> {
    await this.requireActive(worldId).submit({ kind: 'set_days_per_year', value: daysPerYear });
  }

  /** A person with parents/grandparents above and children/grandchildren below. */
  familyTree(worldId: string, agentId: string): FamilyNode {
    const state = this.requireActive(worldId).state;
    const find = (id: string | null) => (id ? state.agents.find((a) => a.id === id) : undefined);
    const root = find(agentId);
    if (!root) throw new NotFoundError(`No such person ${agentId}`);
    const node = (
      a: NonNullable<ReturnType<typeof find>>,
      up: number,
      down: number,
    ): FamilyNode => {
      const partner = find(a.partnerId);
      const mother = find(a.motherId);
      const father = find(a.fatherId);
      return {
        id: a.id,
        name: agentView(a).name,
        sex: a.sex,
        age: Math.floor(a.age),
        alive: a.alive,
        ...(up > 0
          ? {
              mother: mother ? node(mother, up - 1, 0) : null,
              father: father ? node(father, up - 1, 0) : null,
            }
          : {}),
        partner: partner
          ? { id: partner.id, name: agentView(partner).name, alive: partner.alive }
          : null,
        ...(down > 0
          ? {
              children: a.childrenIds
                .map((id) => find(id))
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
                .map((c) => node(c, 0, down - 1)),
            }
          : {}),
      };
    };
    return node(root, 2, 2);
  }

  calls(worldId: string, agentId: string, limit = 10): LlmCallView[] {
    return this.file(worldId).listCalls(agentId, limit);
  }

  /**
   * Spawn a new person from the observer's description, fleshed out by the world's default AI
   * (or offline if none is set up). They arrive on the road, knowing nobody.
   */
  async spawn(worldId: string, req: SpawnRequest): Promise<{ agentId: string; note?: string }> {
    const runner = this.requireActive(worldId);
    const { draft, usage, error } = await draftPerson(
      req,
      runner.state.settings.defaultBrain,
      this.brains,
    );
    if (usage?.costUsd) runner.addSpend(usage.costUsd);
    const before = runner.state.nextAgentNum;
    await runner.submit({
      kind: 'spawn_agent',
      spec: {
        name: draft.name,
        familyName: draft.familyName,
        sex: draft.sex,
        age: draft.age,
        occupation: draft.occupation,
        traits: draft.traits,
        background: draft.background,
        personality: draft.personality,
        knowsVillage: false,
        homeId: null,
      },
    });
    return {
      agentId: `a${before}`,
      note: error ? `The AI couldn't help (${error}); used a simple draft instead.` : undefined,
    };
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
