import Database from 'better-sqlite3';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  DEFAULT_CAP_USD,
  DEFAULT_SPEED,
  TICKS_PER_DAY,
  type LlmCallView,
  type WorldEvent,
  type WorldMeta,
} from '@aw/shared';
import {
  deserializeWorldState,
  serializeWorldState,
  type TickInput,
  type WorldState,
} from '@aw/sim';

/**
 * One world = one SQLite file. Schema changes are applied as numbered migrations
 * tracked in PRAGMA user_version, so old saves keep opening as the game evolves.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- Full world state at a tick (gzipped JSON). Resume = latest snapshot + logged inputs since.
  CREATE TABLE snapshots (
    tick       INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    state      BLOB NOT NULL
  );
  -- Everything the simulation consumes each tick (AI decisions, observer commands). Filled from Phase 1.
  CREATE TABLE tick_inputs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tick    INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX tick_inputs_tick ON tick_inputs(tick);
  -- Human-readable history for the timeline.
  CREATE TABLE events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tick    INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    actors  TEXT NOT NULL DEFAULT '[]',
    payload TEXT NOT NULL
  );
  CREATE INDEX events_tick ON events(tick);
  CREATE INDEX events_kind ON events(kind);
  `,
  `
  -- Every AI call: tokens and cost always; prompt/response text for the latest few per person.
  CREATE TABLE llm_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tick          INTEGER NOT NULL,
    agent_id      TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    trigger       TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    cost_usd      REAL NOT NULL,
    estimated     INTEGER NOT NULL,
    latency_ms    INTEGER NOT NULL,
    prompt        TEXT,
    response      TEXT,
    error         TEXT
  );
  CREATE INDEX llm_calls_agent ON llm_calls(agent_id, id);
  `,
];

const META_KEYS = [
  'id',
  'name',
  'seed',
  'createdAt',
  'updatedAt',
  'tick',
  'mapWidth',
  'mapHeight',
] as const;
/** Meta keys added after Phase 0, with defaults for older files. */
const META_DEFAULTS = {
  population: 0,
  running: false,
  speed: DEFAULT_SPEED,
  spentUsd: 0,
  capUsd: DEFAULT_CAP_USD,
};
/** Full prompts/responses are kept for the most recent calls per person; older rows keep only numbers. */
const KEEP_CALL_TEXT = 20;

export interface CallRecord {
  tick: number;
  agentId: string;
  provider: string;
  model: string;
  trigger: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  estimated: boolean;
  latencyMs: number;
  prompt: string | null;
  response: string | null;
  error: string | null;
}

/** Keep snapshots from the last two in-game days, plus one per day (midnight) and the first. */
const SNAPSHOT_KEEP_TICKS = 2 * TICKS_PER_DAY;

export class WorldFile {
  private constructor(
    readonly path: string,
    private readonly db: Database.Database,
  ) {}

  static create(path: string, meta: WorldMeta, state: WorldState): WorldFile {
    const file = WorldFile.open(path, { create: true });
    file.db.transaction(() => {
      file.writeMeta(meta);
      file.saveSnapshot(state);
      file.appendEvent(state.tick, 'world_created', {
        name: meta.name,
        seed: meta.seed,
        text: `The world "${meta.name}" was created.`,
        importance: 3,
      });
    })();
    return file;
  }

  static open(path: string, { create = false, readonly = false } = {}): WorldFile {
    const db = new Database(path, { fileMustExist: !create, readonly });
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
    }
    const file = new WorldFile(path, db);
    if (!readonly) file.migrate();
    return file;
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    if (current > MIGRATIONS.length) {
      throw new Error(`World file ${this.path} was saved by a newer version of the game`);
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v] as string);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  readMeta(): WorldMeta {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as {
      key: string;
      value: string;
    }[];
    const map = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    for (const key of META_KEYS) {
      if (!map.has(key)) throw new Error(`World file ${this.path} is missing meta "${key}"`);
    }
    const meta = Object.fromEntries(META_KEYS.map((k) => [k, map.get(k)])) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(META_DEFAULTS)) meta[k] = map.has(k) ? map.get(k) : v;
    return meta as unknown as WorldMeta;
  }

  writeMeta(meta: Partial<WorldMeta>): void {
    const stmt = this.db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(meta)) stmt.run(k, JSON.stringify(v));
    })();
  }

  saveSnapshot(state: WorldState): void {
    const blob = gzipSync(JSON.stringify(serializeWorldState(state)));
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots (tick, created_at, state) VALUES (?, ?, ?)')
      .run(state.tick, new Date().toISOString(), blob);
    this.db
      .prepare(
        `DELETE FROM snapshots WHERE tick < ? AND tick % ${TICKS_PER_DAY} != 0
         AND tick != (SELECT MIN(tick) FROM snapshots)`,
      )
      .run(state.tick - SNAPSHOT_KEEP_TICKS);
  }

  loadLatestSnapshot(): WorldState {
    const row = this.db.prepare('SELECT state FROM snapshots ORDER BY tick DESC LIMIT 1').get() as
      { state: Buffer } | undefined;
    if (!row) throw new Error(`World file ${this.path} has no snapshot`);
    return deserializeWorldState(JSON.parse(gunzipSync(row.state).toString('utf8')));
  }

  appendInputs(rows: [tick: number, input: TickInput][]): void {
    const stmt = this.db.prepare('INSERT INTO tick_inputs (tick, kind, payload) VALUES (?, ?, ?)');
    for (const [tick, input] of rows) stmt.run(tick, input.kind, JSON.stringify(input));
  }

  /** All logged inputs after `tick`, grouped by tick, in the order they were logged. */
  readInputsAfter(tick: number): Map<number, TickInput[]> {
    const rows = this.db
      .prepare('SELECT tick, payload FROM tick_inputs WHERE tick > ? ORDER BY tick, id')
      .all(tick) as { tick: number; payload: string }[];
    const out = new Map<number, TickInput[]>();
    for (const r of rows) {
      const list = out.get(r.tick) ?? [];
      list.push(JSON.parse(r.payload) as TickInput);
      out.set(r.tick, list);
    }
    return out;
  }

  appendEvent(tick: number, kind: string, payload: unknown, actors: string[] = []): void {
    this.db
      .prepare('INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)')
      .run(tick, kind, JSON.stringify(actors), JSON.stringify(payload));
  }

  /** Stores simulation events; returns them with their ids. */
  appendWorldEvents(events: WorldEvent[]): WorldEvent[] {
    const stmt = this.db.prepare(
      'INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)',
    );
    return events.map((e) => {
      const info = stmt.run(
        e.tick,
        e.kind,
        JSON.stringify(e.actors),
        JSON.stringify({ text: e.text, importance: e.importance }),
      );
      return { ...e, id: Number(info.lastInsertRowid) };
    });
  }

  queryEvents(opts: {
    limit: number;
    beforeId?: number;
    agentId?: string;
    minImportance: number;
  }): WorldEvent[] {
    const where = ["json_extract(payload, '$.importance') >= @minImportance"];
    if (opts.beforeId !== undefined) where.push('id < @beforeId');
    if (opts.agentId)
      where.push('EXISTS (SELECT 1 FROM json_each(events.actors) WHERE value = @agentId)');
    const rows = this.db
      .prepare(
        `SELECT id, tick, kind, actors, payload FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit`,
      )
      .all({ ...opts, beforeId: opts.beforeId ?? null, agentId: opts.agentId ?? null }) as {
      id: number;
      tick: number;
      kind: string;
      actors: string;
      payload: string;
    }[];
    return rows.map((r) => {
      const p = JSON.parse(r.payload) as { text?: string; importance?: number; name?: string };
      return {
        id: r.id,
        tick: r.tick,
        kind: r.kind as WorldEvent['kind'],
        actors: JSON.parse(r.actors) as string[],
        text:
          p.text ?? (r.kind === 'world_created' ? `The world "${p.name}" was created.` : r.kind),
        importance: p.importance ?? 3,
      };
    });
  }

  appendCalls(calls: CallRecord[]): void {
    const insert = this.db.prepare(
      `INSERT INTO llm_calls (tick, agent_id, provider, model, trigger, input_tokens, output_tokens, cached_tokens,
        cost_usd, estimated, latency_ms, prompt, response, error)
       VALUES (@tick, @agentId, @provider, @model, @trigger, @inputTokens, @outputTokens, @cachedTokens,
        @costUsd, @estimated, @latencyMs, @prompt, @response, @error)`,
    );
    const prune = this.db.prepare(
      `UPDATE llm_calls SET prompt = NULL, response = NULL
       WHERE agent_id = ? AND prompt IS NOT NULL AND id <= (
         SELECT id FROM llm_calls WHERE agent_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_CALL_TEXT})`,
    );
    const agents = new Set<string>();
    for (const c of calls) {
      insert.run({ ...c, estimated: c.estimated ? 1 : 0 });
      agents.add(c.agentId);
    }
    for (const a of agents) prune.run(a, a);
  }

  listCalls(agentId: string, limit: number): LlmCallView[] {
    const rows = this.db
      .prepare(
        `SELECT id, tick, provider, model, trigger, input_tokens, output_tokens, cost_usd, latency_ms, prompt, response, error
         FROM llm_calls WHERE agent_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(agentId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      tick: r.tick as number,
      provider: r.provider as string,
      model: r.model as string,
      trigger: r.trigger as string,
      inputTokens: r.input_tokens as number,
      outputTokens: r.output_tokens as number,
      costUsd: r.cost_usd as number,
      latencyMs: r.latency_ms as number,
      prompt: (r.prompt as string | null) ?? null,
      response: (r.response as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
