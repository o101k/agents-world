import { performance } from 'node:perf_hooks';
import { instinctApplies, type BrainRouter, type RateLimitInfo } from '@aw/brain';
import type {
  ActiveCondition,
  CalendarView,
  AgentView,
  DecisionRequest,
  RateLimitNotice,
  RunnerStatus,
  WorldEvent,
  WorldMeta,
} from '@aw/shared';
import { PROVIDER_NAMES, TICKS_PER_HOUR, rateLimitFacts } from '@aw/shared';
import {
  agentView,
  calendarView,
  fullName,
  pendingRequests,
  step,
  type TickInput,
  type WorldState,
  resourceAmount,
} from '@aw/sim';
import type { CallRecord, WorldFile } from './worldFile.ts';

/** Full snapshot every 6 in-game hours (and on pause/stop). Resume replays at most that many ticks. */
const SNAPSHOT_EVERY = 6 * TICKS_PER_HOUR;
const FRAME_INTERVAL_MS = 66;
const SLICE_MS = 40;
const DECISION_TIMEOUT_MS = 60_000;

export interface RunnerHooks {
  onFrame?: (frame: {
    tick: number;
    runner: RunnerStatus;
    agents: AgentView[];
    resources: Record<string, number>;
    mapVersion: number;
    conditions: ActiveCondition[];
    calendar: CalendarView;
  }) => void;
  onEvents?: (events: WorldEvent[]) => void;
  onStatus?: (meta: WorldMeta) => void;
}

/**
 * Runs one world: advances ticks at the chosen speed, asks brains for decisions (the world waits
 * for them), logs every input, stores events and snapshots, and restores exactly on load.
 */
export class WorldRunner {
  readonly state: WorldState;
  private running: boolean;
  private speed: number;
  private stopped = false;
  private loopDone: Promise<void> | null = null;
  private wakeLoop: (() => void) | null = null;

  /** Inputs for the next tick (already written to the batch log). */
  private pending: TickInput[] = [];
  /** Requests from the last tick still to be answered before the next tick. */
  private outstanding: DecisionRequest[] = [];
  private thinking = 0;

  private batch = {
    inputs: [] as [number, TickInput][],
    events: [] as WorldEvent[],
    calls: [] as CallRecord[],
    snapshot: false,
    dirty: false,
  };
  private capReached = false;
  private rateLimit: RateLimitNotice | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private changedResources = new Set<string>();
  private lastFrameAt = 0;
  private tickTimes: number[] = [];

  private constructor(
    private readonly file: WorldFile,
    private meta: WorldMeta,
    state: WorldState,
    private readonly brains: BrainRouter,
    private readonly hooks: RunnerHooks,
  ) {
    this.state = state;
    this.running = false;
    this.speed = meta.speed;
  }

  /** Restores the world to exactly its last saved tick: latest snapshot + replayed inputs. */
  static open(file: WorldFile, brains: BrainRouter, hooks: RunnerHooks = {}): WorldRunner {
    const meta = file.readMeta();
    const state = file.loadLatestSnapshot();
    const inputs = file.readInputsAfter(state.tick);
    const target = Math.max(meta.tick, state.tick);
    while (state.tick < target) step(state, inputs.get(state.tick + 1) ?? []);
    const runner = new WorldRunner(file, { ...meta, tick: state.tick }, state, brains, hooks);
    // Inputs already logged for the next tick (e.g. decisions received just before shutdown).
    runner.pending = inputs.get(state.tick + 1) ?? [];
    const answered = new Set(
      runner.pending.flatMap((i) => ('agentId' in i && i.kind === 'decision' ? [i.agentId] : [])),
    );
    runner.outstanding = pendingRequests(state).filter((r) => !answered.has(r.agentId));
    runner.loopDone = runner.loop();
    if (meta.running) runner.setRunning(true);
    return runner;
  }

  get id(): string {
    return this.meta.id;
  }

  status(): RunnerStatus {
    const now = performance.now();
    this.tickTimes = this.tickTimes.filter((t) => now - t < 1000);
    return {
      running: this.running,
      speed: this.speed,
      actualSpeed: this.running ? this.tickTimes.length : 0,
      thinking: this.thinking,
      spentUsd: this.meta.spentUsd,
      planUsd: this.meta.planUsd,
      capUsd: this.meta.capUsd,
      capReached: this.capReached,
      rateLimit: this.rateLimit,
    };
  }

  currentMeta(): WorldMeta {
    return { ...this.meta };
  }

  resourceAmounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of Object.keys(this.state.resources))
      out[id] = Math.floor(resourceAmount(this.state, id) ?? 0);
    return out;
  }

  agentViews(): AgentView[] {
    return this.state.agents.map(agentView);
  }

  /** Record spending that happened outside decisions (e.g. drafting a spawned person). */
  addSpend(costUsd: number, coveredByPlan = false): void {
    const cost = Math.max(0, costUsd);
    if (coveredByPlan) {
      this.meta = { ...this.meta, planUsd: this.meta.planUsd + cost };
      this.file.writeMeta({ planUsd: this.meta.planUsd });
    } else {
      this.meta = { ...this.meta, spentUsd: this.meta.spentUsd + cost };
      this.file.writeMeta({ spentUsd: this.meta.spentUsd });
    }
  }

  setCap(capUsd: number): void {
    this.meta = { ...this.meta, capUsd: Math.max(0, capUsd) };
    this.file.writeMeta({ capUsd: this.meta.capUsd });
    if (this.meta.spentUsd < this.meta.capUsd) this.capReached = false;
    this.hooks.onStatus?.(this.currentMeta());
    this.emitFrame(true);
  }

  setRunning(running: boolean): void {
    if (running) {
      this.capReached = false; // re-checked before the next paid decision
      this.clearRateLimit();
    }
    if (this.stopped || this.running === running) return;
    this.running = running;
    this.meta = { ...this.meta, running };
    this.file.writeMeta({ running });
    if (!running) this.saveNow();
    this.wakeLoop?.();
    this.hooks.onStatus?.(this.currentMeta());
    this.emitFrame(true);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, Math.round(speed));
    this.meta = { ...this.meta, speed: this.speed };
    this.file.writeMeta({ speed: this.speed });
    this.wakeLoop?.();
    this.hooks.onStatus?.(this.currentMeta());
    this.emitFrame(true);
  }

  /**
   * Queue an input for the next tick (observer commands). It is logged immediately.
   * If time is paused, the world advances one tick so the command takes effect now.
   */
  async submit(input: TickInput): Promise<void> {
    this.enqueue(input);
    if (!this.running && !this.stopped) {
      await this.tickOnce();
      this.flush();
      this.emitFrame(true);
    }
  }

  /** Advance exactly `ticks` ticks while paused (used by tests and the "step" control). */
  async advance(ticks: number): Promise<void> {
    if (this.running || this.stopped) return;
    for (let i = 0; i < ticks && !this.rateLimit; i++) {
      await this.tickOnce();
      if (i % 200 === 199) this.flush();
    }
    this.flush();
    this.emitFrame(true);
  }

  /** Write everything logged so far (so readers of the file, like replay, see it all). */
  persist(): void {
    this.flush();
  }

  /** Stop the loop and write a final snapshot. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearRateLimit();
    this.wakeLoop?.();
    await this.loopDone;
    this.saveNow();
  }

  // ------------------------------------------------------------------ internals

  private enqueue(input: TickInput): void {
    this.pending.push(input);
    this.batch.inputs.push([this.state.tick + 1, input]);
    this.batch.dirty = true;
  }

  private async loop(): Promise<void> {
    let last = performance.now();
    let carry = 0;
    while (!this.stopped) {
      if (!this.running) {
        await new Promise<void>((resolve) => (this.wakeLoop = resolve));
        this.wakeLoop = null;
        last = performance.now();
        carry = 0;
        continue;
      }
      const now = performance.now();
      let due: number;
      if (this.speed === 0) {
        due = Number.POSITIVE_INFINITY;
      } else {
        carry += ((now - last) * this.speed) / 1000;
        carry = Math.min(carry, Math.max(1, this.speed * 0.25)); // no catch-up bursts after a stall
        due = Math.floor(carry);
      }
      last = now;
      const sliceStart = performance.now();
      let done = 0;
      while (
        done < due &&
        this.running &&
        !this.stopped &&
        performance.now() - sliceStart < SLICE_MS
      ) {
        await this.tickOnce();
        done++;
      }
      if (this.speed !== 0) carry -= done;
      this.flush();
      const wait = this.speed === 0 ? 0 : Math.max(4, Math.min(50, 1000 / this.speed));
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait);
        this.wakeLoop = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.wakeLoop = null;
    }
  }

  /** Would answering these requests spend money (a real AI, not instinct or the mock)? */
  private needsPaidCall(requests: DecisionRequest[]): boolean {
    const byId = new Map(this.state.agents.map((a) => [a.id, a]));
    return requests.some((r) => {
      const brain = byId.get(r.agentId)?.brain;
      return (
        brain &&
        brain.provider !== 'mock' &&
        brain.provider !== 'claude_plan' && // paid for by the owner's subscription, not the cap
        this.brains.has(brain.provider) &&
        !instinctApplies(r.perception)
      );
    });
  }

  /** Pause and tell everyone the spending cap was hit. Returns true if it did. */
  private enforceCap(): boolean {
    if (this.meta.spentUsd < this.meta.capUsd) return false;
    if (!this.capReached) {
      this.capReached = true;
      this.batch.events.push({
        tick: this.state.tick,
        kind: 'cap_reached',
        actors: [],
        text: `Spending cap reached ($${this.meta.spentUsd.toFixed(2)} of $${this.meta.capUsd.toFixed(2)}). Time is paused — raise the cap or switch people to cheaper brains to continue.`,
        importance: 5,
      });
      this.batch.dirty = true;
    }
    if (this.running) this.setRunning(false);
    this.capReached = true;
    this.emitFrame(true);
    return true;
  }

  /**
   * A provider hit a rate or usage limit while someone was deciding: pause and say exactly what
   * happened. Time resumes by itself when the provider said when the limit lifts (the Claude
   * subscription is retried every 30 minutes when it didn't say); otherwise it waits for Play.
   * The decision that hit the limit is asked again when time resumes.
   */
  private pauseForRateLimit(
    agentId: string,
    provider: RateLimitNotice['provider'],
    model: string,
    info: RateLimitInfo,
  ): void {
    const now = Date.now();
    const agent = this.state.agents.find((a) => a.id === agentId);
    let resumeAt: number | null = null;
    if (info.resetsAt !== undefined)
      resumeAt = Math.max(
        now + 1_000,
        info.resetsAt + (provider === 'claude_plan' ? 60_000 : 2_000),
      );
    else if (provider === 'claude_plan') resumeAt = now + 30 * 60_000;
    const notice: RateLimitNotice = {
      agentId,
      agentName: agent ? fullName(agent) : agentId,
      provider,
      model,
      status: info.status,
      limit: info.limit,
      retryAfterSec: info.retryAfterSec,
      message: info.message,
      at: now,
      resumeAt,
    };
    const facts = rateLimitFacts(notice);
    const when =
      resumeAt === null
        ? 'press Play to try again'
        : `it resumes by itself around ${new Date(resumeAt).toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
            second: resumeAt - now < 3_600_000 ? '2-digit' : undefined,
          })}, or press Play to try sooner`;
    this.batch.events.push({
      tick: this.state.tick,
      kind: 'limit_reached',
      actors: [agentId],
      text: `Time is paused: ${PROVIDER_NAMES[provider]} (${model}) hit a limit while ${notice.agentName} was thinking${facts ? ` [${facts}]` : ''}: "${info.message.slice(0, 200)}" ${when[0]!.toUpperCase()}${when.slice(1)}.`,
      importance: 5,
    });
    this.batch.dirty = true;
    if (this.running) this.setRunning(false);
    this.clearRateLimit();
    this.rateLimit = notice;
    if (resumeAt !== null)
      this.limitTimer = setTimeout(
        () => {
          if (this.rateLimit && !this.stopped) this.setRunning(true);
        },
        Math.min(resumeAt - now, 2 ** 31 - 1),
      );
    this.emitFrame(true);
  }

  private clearRateLimit(): void {
    clearTimeout(this.limitTimer);
    this.limitTimer = undefined;
    this.rateLimit = null;
  }

  private async tickOnce(): Promise<void> {
    if (this.outstanding.length > 0) {
      if (this.needsPaidCall(this.outstanding) && this.enforceCap()) return;
      // Decisions that hit a rate limit stay outstanding and are asked again when time resumes;
      // the tick doesn't advance without them.
      this.outstanding = await this.resolve(this.outstanding);
      if (this.outstanding.length > 0) return;
    }
    const inputs = this.pending;
    this.pending = [];
    const res = step(this.state, inputs);
    this.tickTimes.push(performance.now());
    this.outstanding = res.requests;
    if (res.events.length) this.batch.events.push(...res.events);
    for (const id of res.changedResources) this.changedResources.add(id);
    if (this.state.tick % SNAPSHOT_EVERY === 0) this.batch.snapshot = true;
    this.batch.dirty = true;
  }

  /**
   * The world waits here until every agent due to decide has decided (or timed out). Returns the
   * requests that hit a rate limit (the world is then paused).
   */
  private async resolve(requests: DecisionRequest[]): Promise<DecisionRequest[]> {
    this.thinking = requests.length;
    if (requests.length > 1 || this.speed <= 20) this.emitFrame(false);
    const byId = new Map(this.state.agents.map((a) => [a.id, a]));
    const results = await Promise.all(
      requests.map(async (request) => {
        const agent = byId.get(request.agentId);
        const routed = await this.brains.decide(request, agent!.brain, DECISION_TIMEOUT_MS);
        return { request, routed };
      }),
    );
    const limited: { request: DecisionRequest; routed: (typeof results)[number]['routed'] }[] = [];
    for (const { request, routed } of results) {
      if (routed.limit) limited.push({ request, routed });
      const usage = routed.result?.usage;
      const cost = usage?.costUsd ?? 0;
      const plan = Boolean(usage?.coveredByPlan);
      if (cost > 0 && plan) this.meta = { ...this.meta, planUsd: this.meta.planUsd + cost };
      else if (cost > 0) this.meta = { ...this.meta, spentUsd: this.meta.spentUsd + cost };
      if (routed.provider !== 'mock' || routed.fallback || routed.error) {
        const trace = routed.result?.trace;
        this.batch.calls.push({
          tick: this.state.tick,
          agentId: request.agentId,
          provider: routed.fallback
            ? `mock (${byId.get(request.agentId)?.brain.provider} not set up)`
            : routed.provider,
          model: routed.model || trace?.model || '',
          trigger: request.perception.trigger.kind,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedTokens: usage?.cachedInputTokens ?? 0,
          costUsd: cost,
          estimated: Boolean(usage?.estimated),
          plan,
          latencyMs: trace?.latencyMs ?? 0,
          prompt: trace?.prompt ?? null,
          response: trace?.response ?? null,
          error: routed.error ?? null,
        });
      }
      if (routed.result && cost > 0) {
        this.enqueue({
          kind: 'decision',
          agentId: request.agentId,
          decision: routed.result.decision,
          usage: { costUsd: cost },
        });
        continue;
      }
      if (routed.result)
        this.enqueue({
          kind: 'decision',
          agentId: request.agentId,
          decision: routed.result.decision,
        });
      else if (!routed.limit) this.enqueue({ kind: 'decision_timeout', agentId: request.agentId });
    }
    this.thinking = 0;
    const first = limited[0];
    if (first)
      this.pauseForRateLimit(
        first.request.agentId,
        first.routed.provider,
        first.routed.model,
        first.routed.limit!,
      );
    return limited.map((l) => l.request);
  }

  /** Commit everything since the last flush in one transaction, then notify listeners. */
  private flush(): void {
    if (!this.batch.dirty) return;
    const { inputs, events, calls, snapshot } = this.batch;
    this.batch = { inputs: [], events: [], calls: [], snapshot: false, dirty: false };
    const population = this.state.agents.filter((a) => a.alive).length;
    let stored: WorldEvent[] = [];
    this.file.transaction(() => {
      this.file.appendInputs(inputs);
      stored = this.file.appendWorldEvents(events);
      if (calls.length) this.file.appendCalls(calls);
      if (snapshot) this.file.saveSnapshot(this.state);
      this.file.writeMeta({
        tick: this.state.tick,
        population,
        spentUsd: this.meta.spentUsd,
        planUsd: this.meta.planUsd,
      });
    });
    const popChanged = population !== this.meta.population;
    this.meta = { ...this.meta, tick: this.state.tick, population };
    if (stored.length) this.hooks.onEvents?.(stored);
    if (popChanged) this.hooks.onStatus?.(this.currentMeta());
    this.emitFrame(false);
  }

  private saveNow(): void {
    this.flush();
    this.file.transaction(() => {
      this.file.saveSnapshot(this.state);
      this.file.writeMeta({ tick: this.state.tick, updatedAt: new Date().toISOString() });
    });
  }

  private emitFrame(force: boolean): void {
    if (!this.hooks.onFrame) return;
    const now = performance.now();
    if (!force && now - this.lastFrameAt < FRAME_INTERVAL_MS) return;
    this.lastFrameAt = now;
    const resources: Record<string, number> = {};
    for (const id of this.changedResources)
      resources[id] = Math.floor(resourceAmount(this.state, id) ?? 0);
    this.changedResources.clear();
    this.hooks.onFrame({
      mapVersion: this.state.mapVersion,
      tick: this.state.tick,
      runner: this.status(),
      agents: this.agentViews(),
      resources,
      conditions: this.state.conditions.map((c) => ({ ...c })),
      calendar: calendarView(this.state),
    });
  }
}
