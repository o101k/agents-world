import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainRouter, DEFAULT_QUESTION, askAboutPerson, draftPerson } from '@aw/brain';
import {
  CastPreviewRequest as CastPreviewRequestSchema,
  CreateWorldRequest,
  DEFAULT_CAP_USD,
  DEFAULT_SPEED,
  AskRequest as AskRequestSchema,
  RecordQuery as RecordQuerySchema,
  WORLD_ID_PATTERN,
  WorldEventRequest as WorldEventRequestSchema,
  encodeMap,
  stageOf,
  type AgentDetail,
  type BrainConfig,
  type BrainRow,
  type BrainUsage,
  type BrainsResponse,
  type CastPreviewRequest,
  type CastPreviewResponse,
  type FamilyNode,
  type LlmCallView,
  type MarketResponse,
  type InterviewView,
  type InterviewsResponse,
  type ObjectHistoryResponse,
  type RecordQuery,
  type RecordResponse,
  type AskRequest,
  type VillageResponse,
  type ReplayResponse,
  type SpawnRequest,
  type StoryEntry,
  type WorldEventRequest,
  type WorldMeta,
  type WorldViewResponse,
} from '@aw/shared';
import {
  DEFAULT_BRAIN,
  SAMPLE_CAST,
  agentDetail,
  agentView,
  allQuotes,
  calendarView,
  createWorldState,
  fullName,
  generateCast,
  ownerNames,
  villageView,
  type Agent,
  type AgentSpec,
  type TickInput,
  type WorldState,
  resourceAmount,
} from '@aw/sim';
import { buildDigest, clampPeriod, lifeSpan, recordPage } from './personRecord.ts';
import { Replayer } from './replayer.ts';
import { WorldFile } from './worldFile.ts';
import { WorldRunner, type RunnerHooks } from './worldRunner.ts';

const newSeed = () => randomBytes(4).toString('hex');

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
  /** Replay of the active world's past (cached between scrubs). */
  private replayer: { worldId: string; replayer: Replayer } | null = null;
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
    const seed = req.seed || newSeed();
    const specs = this.castSpecs(req.cast, seed);
    if (req.brains && req.brains.length > specs.length)
      throw new ValidationError(
        `Got ${req.brains.length} brains for a cast of ${specs.length} people.`,
      );
    // Everyone gets the brain picked for them, else the world's default (the free Mock brain).
    const cast = (await this.fleshOutCast(specs, req.cast)).map((spec, i) => ({
      ...spec,
      brain: { ...(req.brains?.[i] ?? req.defaultBrain ?? DEFAULT_BRAIN) },
    }));
    const state = createWorldState({
      seed,
      mapSize: req.mapSize,
      cast,
      defaultBrain: req.defaultBrain,
    });
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
      planUsd: 0,
      capUsd: DEFAULT_CAP_USD,
    };
    const file = WorldFile.create(this.pathFor(id), meta, state);
    this.files.set(id, file);
    this.log(`Created world "${meta.name}" (${id}, seed ${seed})`);
    return meta;
  }

  /**
   * Who the starting villagers of a new world will be, so the observer can pick their brains
   * before creating it. Same people, in the same order, as `create` makes from the same request;
   * generated casts aren't fleshed out by an AI here (that only changes traits and background,
   * never names or order), so previewing is free.
   */
  previewCast(input: CastPreviewRequest): CastPreviewResponse {
    const req = CastPreviewRequestSchema.parse(input);
    const seed = req.seed || newSeed();
    return {
      seed,
      people: this.castSpecs(req.cast, seed).map((spec, index) => ({
        index,
        name: spec.name,
        familyName: spec.familyName ?? '',
        sex: spec.sex,
        age: Math.floor(spec.age),
        occupation: spec.occupation ?? 'villager',
      })),
    };
  }

  /** The people a cast option stands for (no AI involved). Never hands out shared objects. */
  private castSpecs(option: CreateWorldRequest['cast'], seed: string): AgentSpec[] {
    const opt = option ?? { mode: 'sample' };
    if (opt.mode === 'sample') return SAMPLE_CAST.map((spec) => ({ ...spec }));
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
    return generateCast(seed, { adults: opt.adults, children: opt.children });
  }

  /** A generated cast, if the owner asked for it, gets traits and backgrounds written by an AI. */
  private async fleshOutCast(
    cast: AgentSpec[],
    option: CreateWorldRequest['cast'],
  ): Promise<AgentSpec[]> {
    if (option?.mode !== 'generated' || !option.useAi) return cast;
    // Flesh out each adult with the first AI provider that's set up.
    const order: BrainConfig['provider'][] = [
      'anthropic',
      'openai',
      'openai_compatible',
      'claude_plan',
    ];
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
      conditions: state.conditions.map((c) => ({ ...c })),
      calendar: calendarView(state),
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

  village(worldId: string): VillageResponse {
    return villageView(this.requireActive(worldId).state);
  }

  agent(worldId: string, agentId: string): AgentDetail {
    const state = this.requireActive(worldId).state;
    const agent = this.personIn(state, agentId);
    const askedUsd = this.file(worldId).interviewSpend(agentId);
    return { ...agentDetail(state, agent), ...(askedUsd > 0 ? { askedUsd } : {}) };
  }

  events(worldId: string, query: Parameters<WorldFile['queryEvents']>[0]) {
    return this.file(worldId).queryEvents(query);
  }

  /**
   * What the village's history knows about one map object (a house, bush, tree…), as it was at
   * `tick` when replaying. Unknown in that state = NotFoundError.
   */
  objectHistory(worldId: string, objectId: string, tick?: number): ObjectHistoryResponse {
    const state =
      tick === undefined
        ? this.requireActive(worldId).state
        : this.replayState(worldId, tick).state;
    if (!state.map.objects.some((o) => o.id === objectId))
      throw new NotFoundError(`No such object ${objectId}`);
    const file = this.file(worldId);
    const history = file.objectHistory(objectId, tick === undefined ? undefined : state.tick);
    const foundedTick = file.firstSnapshotTick();
    const nameOf = (id: string) => {
      const agent = state.agents.find((a) => a.id === id);
      return agent ? fullName(agent) : id;
    };
    return {
      objectId,
      founded: file.foundingObjectIds().has(objectId),
      foundedTick,
      recordedSince: Math.max(foundedTick, file.objectHistorySince()),
      residents: state.agents
        .filter((a) => a.alive && a.homeId === objectId)
        .map((a) => ({ id: a.id, name: fullName(a) })),
      milestones: history.milestones,
      recent: history.recent,
      uses: history.uses,
      regulars: history.regulars.map((r) => ({
        id: r.agentId,
        name: nameOf(r.agentId),
        count: r.count,
      })),
    };
  }

  /**
   * A person's life story: the important things that happened to them (from the world's history)
   * interleaved with their own diary and life chapters, oldest first.
   */
  story(worldId: string, agentId: string): StoryEntry[] {
    const state = this.requireActive(worldId).state;
    if (!state.agents.some((a) => a.id === agentId))
      throw new NotFoundError(`No such person ${agentId}`);
    const events = this.file(worldId).queryEvents({
      limit: 1500,
      agentId,
      minImportance: 3,
      story: true,
    });
    return events.reverse().map((e) => ({
      tick: e.tick,
      text: e.text,
      kind: e.kind,
      source: e.kind === 'reflected' ? ('memory' as const) : ('event' as const),
    }));
  }

  /** The world as it was at a past tick (replayed from its history; costs nothing). */
  replay(worldId: string, tick: number, viewerMapVersion?: number): ReplayResponse {
    const { state, firstTick, lastTick } = this.replayState(worldId, tick);
    const resources: Record<string, number> = {};
    for (const id of Object.keys(state.resources))
      resources[id] = Math.floor(resourceAmount(state, id) ?? 0);
    return {
      tick: state.tick,
      firstTick,
      lastTick,
      agents: state.agents.map(agentView),
      resources,
      conditions: state.conditions.map((c) => ({ ...c })),
      calendar: calendarView(state),
      owners: ownerNames(state),
      mapVersion: state.mapVersion,
      ...(viewerMapVersion === state.mapVersion ? {} : { map: encodeMap(state.map) }),
    };
  }

  /** One person as they were at a past tick. */
  replayAgent(worldId: string, tick: number, agentId: string): AgentDetail {
    const { state } = this.replayState(worldId, tick);
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) throw new NotFoundError(`${agentId} wasn't born yet at that time`);
    return agentDetail(state, agent);
  }

  private replayState(worldId: string, tick: number) {
    const runner = this.requireActive(worldId);
    runner.persist();
    const file = this.file(worldId);
    const lastTick = runner.state.tick;
    const firstTick = file.firstSnapshotTick();
    if (this.replayer?.worldId !== worldId)
      this.replayer = { worldId, replayer: new Replayer(file) };
    const state = this.replayer.replayer.at(Math.min(Math.max(tick, firstTick), lastTick));
    return { state, firstTick, lastTick };
  }

  /** Observer power: start a drought, storm, disease, fire or bumper harvest. */
  async worldEvent(worldId: string, req: WorldEventRequest): Promise<void> {
    const parsed = WorldEventRequestSchema.parse(req);
    await this.requireActive(worldId).submit({ kind: 'world_event', event: parsed });
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

  /**
   * Give several people the same brain with ONE logged input (so a paused world advances a single
   * tick, not one per person). Unknown ids are refused before anything changes. Returns the
   * brains view with the change in it, even if the world is running and hasn't ticked yet.
   */
  async setBrains(
    worldId: string,
    agentIds: string[],
    brain: BrainConfig,
  ): Promise<BrainsResponse> {
    const runner = this.requireActive(worldId);
    const known = new Set(runner.state.agents.map((a) => a.id));
    const missing = agentIds.find((id) => !known.has(id));
    if (missing) throw new NotFoundError(`No such person ${missing}`);
    const ids = new Set(agentIds);
    await runner.submit({ kind: 'set_brains', agentIds: [...ids], brain });
    const view = this.brainsView(worldId);
    for (const row of view.people) if (ids.has(row.id)) row.brain = { ...brain };
    return view;
  }

  async setDefaultBrain(worldId: string, brain: BrainConfig, applyToAll: boolean): Promise<void> {
    await this.requireActive(worldId).submit({ kind: 'set_default_brain', brain, applyToAll });
  }

  /**
   * Everyone who has lived in the world (the living first), their brain and what it has used,
   * plus the village totals. (Not called `brains`: that's the provider router.)
   */
  brainsView(worldId: string): BrainsResponse {
    const runner = this.requireActive(worldId);
    runner.persist(); // calls still buffered in the runner aren't in the file yet
    const usage = this.file(worldId).usageByAgent();
    const none: BrainUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, planUsd: 0 };
    const row = (a: Agent): BrainRow => ({
      id: a.id,
      name: fullName(a),
      age: Math.floor(a.age),
      stage: stageOf(a.age),
      alive: a.alive,
      brain: { ...a.brain },
      ...(usage.get(a.id) ?? none),
    });
    const people = runner.state.agents.map(row);
    // Totals cover every call in the log, including any not tied to someone in the world.
    const totals = { ...none };
    for (const u of usage.values()) {
      totals.calls += u.calls;
      totals.inputTokens += u.inputTokens;
      totals.outputTokens += u.outputTokens;
      totals.costUsd += u.costUsd;
      totals.planUsd += u.planUsd;
    }
    totals.costUsd = Math.round(totals.costUsd * 1e6) / 1e6;
    totals.planUsd = Math.round(totals.planUsd * 1e6) / 1e6;
    return {
      defaultBrain: { ...runner.state.settings.defaultBrain },
      people: [...people.filter((p) => p.alive), ...people.filter((p) => !p.alive)],
      totals,
    };
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

  /**
   * Everything asked about a person so far (oldest first), and the span of their life the
   * observer can ask about.
   */
  interviews(worldId: string, agentId: string): InterviewsResponse {
    const state = this.requireActive(worldId).state;
    const agent = this.personIn(state, agentId);
    const file = this.file(worldId);
    const span = lifeSpan(file, state, agent);
    return {
      interviews: file.listInterviews(agentId),
      lifeFromTick: span.from,
      lifeToTick: span.to,
      nowTick: state.tick,
      daysPerYear: state.settings.daysPerYear,
    };
  }

  /**
   * The observer asks about a person: their own brain answers from their record for the period
   * (the free summary when it can't). Never changes the world; a paid answer counts toward the
   * spending cap and the person's AI use.
   */
  async ask(worldId: string, agentId: string, req: AskRequest): Promise<InterviewView> {
    const parsed = AskRequestSchema.parse(req);
    const runner = this.requireActive(worldId);
    runner.persist(); // the record must include everything that has happened so far
    const state = runner.state;
    const agent = this.personIn(state, agentId);
    const file = this.file(worldId);
    const askedTick = state.tick;
    const span = lifeSpan(file, state, agent);
    const period = clampPeriod(span, parsed.fromTick, parsed.toTick);
    const digest = buildDigest(file, state, agent, period.from, period.to, agent.brain.effort);
    const question = parsed.question || DEFAULT_QUESTION;
    // Earlier questions about the same period give the answer some conversation context.
    const history = file
      .listInterviews(agentId)
      .filter((i) => i.fromTick === period.from && i.toTick === period.to)
      .slice(-3)
      .map((i) => ({ question: i.question, answer: i.answer }));
    const meta = runner.currentMeta();
    const result = await askAboutPerson(this.brains, agent.brain, digest, question, {
      history,
      capReached: meta.spentUsd >= meta.capUsd,
    });

    const usage = result.usage;
    if (usage && usage.costUsd > 0) runner.addSpend(usage.costUsd, usage.coveredByPlan);
    // Every call made to their AI is logged (also one that failed and the free summary replaced).
    if (result.trace || usage || result.error) {
      const replaced = result.provider === 'mock';
      file.appendCalls([
        {
          tick: askedTick,
          agentId,
          provider: replaced ? agent.brain.provider : result.provider,
          model: replaced ? agent.brain.model : result.model,
          trigger: 'interview',
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedTokens: usage?.cachedInputTokens ?? 0,
          costUsd: usage?.costUsd ?? 0,
          estimated: usage?.estimated ?? false,
          plan: usage?.coveredByPlan ?? false,
          latencyMs: result.trace?.latencyMs ?? 0,
          prompt: result.trace?.prompt ?? null,
          response: result.trace?.response ?? null,
          error: result.error ?? null,
        },
      ]);
    }

    return file.appendInterview({
      agentId,
      askedTick,
      fromTick: period.from,
      toTick: period.to,
      question,
      answer: result.answer,
      provider: result.provider,
      model: result.model,
      costUsd: usage?.costUsd ?? 0,
      plan: usage?.coveredByPlan ?? false,
      recordCount: digest.total,
      usedCount: digest.entries.length,
      ...(result.fallback ? { fallback: result.fallback } : {}),
      ...(result.note ? { note: result.note } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  /** A page of a person's record (what the village holds about them) for a period. */
  record(worldId: string, agentId: string, query: RecordQuery): RecordResponse {
    const runner = this.requireActive(worldId);
    runner.persist();
    const agent = this.personIn(runner.state, agentId);
    return recordPage(this.file(worldId), runner.state, agent, RecordQuerySchema.parse(query));
  }

  private personIn(state: WorldState, agentId: string): Agent {
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) throw new NotFoundError(`No such person ${agentId}`);
    return agent;
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
    if (usage?.costUsd) runner.addSpend(usage.costUsd, usage.coveredByPlan);
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
    this.replayer = null;
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
