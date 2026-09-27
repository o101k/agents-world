import { performance } from 'node:perf_hooks';
import type { BrainRouter } from '@aw/brain';
import type { AgentView, DecisionRequest, RunnerStatus, WorldEvent, WorldMeta } from '@aw/shared';
import { TICKS_PER_HOUR } from '@aw/shared';
import { agentView, pendingRequests, step, type TickInput, type WorldState } from '@aw/sim';
import type { WorldFile } from './worldFile.ts';

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
  }) => void;
  onEvents?: (events: WorldEvent[]) => void;
  onStatus?: (meta: WorldMeta) => void;
  /** Called with every brain result, e.g. to record costs and traces (Phase 2). */
  onDecision?: (info: {
    request: DecisionRequest;
    provider: string;
    error?: string;
    timedOut?: boolean;
  }) => void;
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
    snapshot: false,
    dirty: false,
  };
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
    };
  }

  currentMeta(): WorldMeta {
    return { ...this.meta };
  }

  resourceAmounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, r] of Object.entries(this.state.resources)) out[id] = Math.floor(r.amount);
    return out;
  }

  agentViews(): AgentView[] {
    return this.state.agents.map(agentView);
  }

  setRunning(running: boolean): void {
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
    for (let i = 0; i < ticks; i++) {
      await this.tickOnce();
      if (i % 200 === 199) this.flush();
    }
    this.flush();
    this.emitFrame(true);
  }

  /** Stop the loop and write a final snapshot. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
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

  private async tickOnce(): Promise<void> {
    if (this.outstanding.length > 0) {
      await this.resolve(this.outstanding);
      this.outstanding = [];
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

  /** The world waits here until every agent due to decide has decided (or timed out). */
  private async resolve(requests: DecisionRequest[]): Promise<void> {
    this.thinking = requests.length;
    if (requests.length > 1 || this.speed <= 20) this.emitFrame(false);
    const byId = new Map(this.state.agents.map((a) => [a.id, a]));
    const results = await Promise.all(
      requests.map(async (request) => {
        const agent = byId.get(request.agentId);
        const routed = await this.brains.decide(request, agent!.brain, DECISION_TIMEOUT_MS);
        this.hooks.onDecision?.({
          request,
          provider: routed.provider,
          error: routed.error,
          timedOut: routed.timedOut,
        });
        return { request, routed };
      }),
    );
    for (const { request, routed } of results) {
      if (routed.result)
        this.enqueue({
          kind: 'decision',
          agentId: request.agentId,
          decision: routed.result.decision,
        });
      else this.enqueue({ kind: 'decision_timeout', agentId: request.agentId });
    }
    this.thinking = 0;
  }

  /** Commit everything since the last flush in one transaction, then notify listeners. */
  private flush(): void {
    if (!this.batch.dirty) return;
    const { inputs, events, snapshot } = this.batch;
    this.batch = { inputs: [], events: [], snapshot: false, dirty: false };
    const population = this.state.agents.filter((a) => a.alive).length;
    let stored: WorldEvent[] = [];
    this.file.transaction(() => {
      this.file.appendInputs(inputs);
      stored = this.file.appendWorldEvents(events);
      if (snapshot) this.file.saveSnapshot(this.state);
      this.file.writeMeta({ tick: this.state.tick, population });
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
      resources[id] = Math.floor(this.state.resources[id]?.amount ?? 0);
    this.changedResources.clear();
    this.hooks.onFrame({
      tick: this.state.tick,
      runner: this.status(),
      agents: this.agentViews(),
      resources,
    });
  }
}
