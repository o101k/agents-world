import Database from 'better-sqlite3';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  DEFAULT_CAP_USD,
  DEFAULT_SPEED,
  TICKS_PER_DAY,
  type BrainUsage,
  type InterviewFallback,
  type InterviewView,
  type LlmCallView,
  type ProviderId,
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
  `
  -- Calls made on a Claude subscription: their cost is the API-price value, covered by the plan.
  ALTER TABLE llm_calls ADD COLUMN plan INTEGER NOT NULL DEFAULT 0;
  UPDATE llm_calls SET plan = 1 WHERE provider = 'claude_plan';
  `,
  `
  -- Which map objects each event happened to or at: an object's history.
  CREATE TABLE IF NOT EXISTS event_objects (
    object_id TEXT NOT NULL,
    event_id  INTEGER NOT NULL,
    PRIMARY KEY (object_id, event_id)
  ) WITHOUT ROWID;
  -- A world that already has a history knows its objects' day-to-day use from now on.
  INSERT INTO meta (key, value) SELECT 'objectHistorySince', value FROM meta WHERE key = 'tick' ON CONFLICT(key) DO NOTHING;
  `,
  `
  -- Which people each event involved, so one person's record is an index lookup, not a scan.
  CREATE TABLE IF NOT EXISTS event_actors (
    agent_id TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    PRIMARY KEY (agent_id, event_id)
  ) WITHOUT ROWID;
  INSERT OR IGNORE INTO event_actors (agent_id, event_id)
    SELECT j.value, e.id FROM events e, json_each(e.actors) j;
  -- A person's logged decisions, found without scanning every decision.
  CREATE INDEX IF NOT EXISTS tick_inputs_agent
    ON tick_inputs (json_extract(payload, '$.agentId'), tick) WHERE kind = 'decision';
  -- Questions asked about people and their answers (asking never changes the world).
  CREATE TABLE IF NOT EXISTS interviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id     TEXT NOT NULL,
    asked_tick   INTEGER NOT NULL,
    from_tick    INTEGER NOT NULL,
    to_tick      INTEGER NOT NULL,
    question     TEXT NOT NULL,
    answer       TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    cost_usd     REAL NOT NULL,
    plan         INTEGER NOT NULL DEFAULT 0,
    record_count INTEGER NOT NULL,
    used_count   INTEGER NOT NULL,
    fallback     TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS interviews_agent ON interviews (agent_id, id);
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
  planUsd: 0,
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
  /** Made on a Claude subscription: its cost is the API-price value, not billed. */
  plan: boolean;
  latencyMs: number;
  prompt: string | null;
  response: string | null;
  error: string | null;
}

/** Keep snapshots from the last two in-game days, plus one per day (midnight) and the first. */
const SNAPSHOT_KEEP_TICKS = 2 * TICKS_PER_DAY;

/** A stored event row (`events` table). */
interface EventRow {
  id: number;
  tick: number;
  kind: string;
  actors: string;
  payload: string;
}

function toWorldEvent(r: EventRow): WorldEvent {
  const p = JSON.parse(r.payload) as {
    text?: string;
    importance?: number;
    name?: string;
    objects?: string[];
  };
  return {
    id: r.id,
    tick: r.tick,
    kind: r.kind as WorldEvent['kind'],
    actors: JSON.parse(r.actors) as string[],
    text: p.text ?? (r.kind === 'world_created' ? `The world "${p.name}" was created.` : r.kind),
    importance: p.importance ?? 3,
    ...(p.objects?.length ? { objects: p.objects } : {}),
  };
}

/** Matches `name` as a whole in a text ("House 1" doesn't match "House 12"). */
function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?!\\d)`);
}

/** An object's stored history (see `WorldFile.objectHistory`). */
export interface ObjectHistoryRows {
  milestones: WorldEvent[];
  recent: WorldEvent[];
  uses: number;
  regulars: { agentId: string; count: number }[];
}

export class WorldFile {
  private readonly stmts = new Map<string, Database.Statement>();
  private cachedFirstSnapshotTick: number | null = null;
  private cachedObjectHistorySince: number | null = null;
  private foundingIds: Set<string> | null = null;

  private constructor(
    readonly path: string,
    private readonly db: Database.Database,
  ) {}

  private stmt(sql: string): Database.Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  static create(path: string, meta: WorldMeta, state: WorldState): WorldFile {
    const file = WorldFile.open(path, { create: true });
    try {
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
    } catch (err) {
      file.close();
      throw err;
    }
  }

  static open(path: string, { create = false, readonly = false } = {}): WorldFile {
    const db = new Database(path, { fileMustExist: !create, readonly });
    try {
      db.pragma('busy_timeout = 5000');
      if (!readonly) {
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
      }
      const file = new WorldFile(path, db);
      if (!readonly) file.migrate();
      return file;
    } catch (err) {
      if (db.open) db.close();
      throw err;
    }
  }

  /** Lightweight read-only meta lookup that opens and immediately closes the file. */
  static readMetaOnly(path: string): WorldMeta {
    const file = WorldFile.open(path, { readonly: true });
    try {
      return file.readMeta();
    } finally {
      file.close();
    }
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
    // A world saved before object history (migration 4) gets its old building and fire events
    // matched to their buildings. Never let this stop the world from opening.
    if (current >= 1 && current < 4) {
      try {
        this.backfillObjectEvents();
      } catch (err) {
        console.error(`Could not recover object history for ${this.path}:`, err);
      }
    }
  }

  /** Links existing building and fire events to the buildings they name (by name, once). */
  private backfillObjectEvents(): void {
    const named = this.loadLatestSnapshot()
      .map.objects.filter((o) => o.name)
      .map((o) => ({ id: o.id, pattern: namePattern(o.name!) }));
    if (!named.length) return;
    const events = this.db
      .prepare("SELECT id, payload FROM events WHERE kind IN ('built', 'fire')")
      .all() as { id: number; payload: string }[];
    const insert = this.stmt(
      'INSERT OR IGNORE INTO event_objects (object_id, event_id) VALUES (?, ?)',
    );
    this.db.transaction(() => {
      for (const e of events) {
        const text = (JSON.parse(e.payload) as { text?: string }).text ?? '';
        for (const o of named) {
          if (o.pattern.test(text)) insert.run(o.id, e.id);
        }
      }
    })();
  }

  readMeta(): WorldMeta {
    const rows = this.stmt('SELECT key, value FROM meta').all() as {
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
    const stmt = this.stmt(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(meta)) stmt.run(k, JSON.stringify(v));
    })();
  }

  saveSnapshot(state: WorldState): void {
    const blob = gzipSync(JSON.stringify(serializeWorldState(state)));
    this.stmt('INSERT OR REPLACE INTO snapshots (tick, created_at, state) VALUES (?, ?, ?)').run(
      state.tick,
      new Date().toISOString(),
      blob,
    );
    this.stmt(
      `DELETE FROM snapshots WHERE tick < ? AND tick % ${TICKS_PER_DAY} != 0
         AND tick != (SELECT MIN(tick) FROM snapshots)`,
    ).run(state.tick - SNAPSHOT_KEEP_TICKS);
  }

  loadLatestSnapshot(): WorldState {
    const row = this.stmt('SELECT state FROM snapshots ORDER BY tick DESC LIMIT 1').get() as
      { state: Buffer } | undefined;
    if (!row) throw new Error(`World file ${this.path} has no snapshot`);
    return deserializeWorldState(JSON.parse(gunzipSync(row.state).toString('utf8')));
  }

  /** The latest snapshot at or before `tick` (for replaying the past). */
  loadSnapshotAtOrBefore(tick: number): WorldState {
    const row = this.stmt(
      'SELECT state FROM snapshots WHERE tick <= ? ORDER BY tick DESC LIMIT 1',
    ).get(tick) as { state: Buffer } | undefined;
    if (!row) throw new Error(`World file ${this.path} has no snapshot before tick ${tick}`);
    return deserializeWorldState(JSON.parse(gunzipSync(row.state).toString('utf8')));
  }

  /** Tick of the latest snapshot at or before `tick` (-1 if none). */
  snapshotTickAtOrBefore(tick: number): number {
    const row = this.stmt('SELECT MAX(tick) AS t FROM snapshots WHERE tick <= ?').get(tick) as {
      t: number | null;
    };
    return row.t ?? -1;
  }

  /** The first tick the world's history can be replayed from. */
  firstSnapshotTick(): number {
    if (this.cachedFirstSnapshotTick !== null) return this.cachedFirstSnapshotTick;
    const row = this.stmt('SELECT MIN(tick) AS t FROM snapshots').get() as {
      t: number | null;
    };
    if (row.t !== null) this.cachedFirstSnapshotTick = row.t;
    return row.t ?? 0;
  }

  /** Logged inputs for ticks in (from, to], grouped by tick. */
  readInputsBetween(from: number, to: number): Map<number, TickInput[]> {
    const rows = this.stmt(
      'SELECT tick, payload FROM tick_inputs WHERE tick > ? AND tick <= ? ORDER BY tick, id',
    ).all(from, to) as { tick: number; payload: string }[];
    const out = new Map<number, TickInput[]>();
    for (const r of rows) {
      const list = out.get(r.tick) ?? [];
      list.push(JSON.parse(r.payload) as TickInput);
      out.set(r.tick, list);
    }
    return out;
  }

  appendInputs(rows: [tick: number, input: TickInput][]): void {
    const stmt = this.stmt('INSERT INTO tick_inputs (tick, kind, payload) VALUES (?, ?, ?)');
    for (const [tick, input] of rows) stmt.run(tick, input.kind, JSON.stringify(input));
  }

  /** All logged inputs after `tick`, grouped by tick, in the order they were logged. */
  readInputsAfter(tick: number): Map<number, TickInput[]> {
    const rows = this.stmt(
      'SELECT tick, payload FROM tick_inputs WHERE tick > ? ORDER BY tick, id',
    ).all(tick) as { tick: number; payload: string }[];
    const out = new Map<number, TickInput[]>();
    for (const r of rows) {
      const list = out.get(r.tick) ?? [];
      list.push(JSON.parse(r.payload) as TickInput);
      out.set(r.tick, list);
    }
    return out;
  }

  appendEvent(tick: number, kind: string, payload: unknown, actors: string[] = []): void {
    const info = this.stmt(
      'INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)',
    ).run(tick, kind, JSON.stringify(actors), JSON.stringify(payload));
    const actorStmt = this.stmt(
      'INSERT OR IGNORE INTO event_actors (agent_id, event_id) VALUES (?, ?)',
    );
    for (const actor of actors) actorStmt.run(actor, Number(info.lastInsertRowid));
  }

  /** Stores simulation events; returns them with their ids. */
  appendWorldEvents(events: WorldEvent[]): WorldEvent[] {
    const stmt = this.stmt('INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)');
    const objectStmt = this.stmt(
      'INSERT OR IGNORE INTO event_objects (object_id, event_id) VALUES (?, ?)',
    );
    const actorStmt = this.stmt(
      'INSERT OR IGNORE INTO event_actors (agent_id, event_id) VALUES (?, ?)',
    );
    return events.map((e) => {
      const info = stmt.run(
        e.tick,
        e.kind,
        JSON.stringify(e.actors),
        JSON.stringify({
          text: e.text,
          importance: e.importance,
          ...(e.objects?.length ? { objects: e.objects } : {}),
        }),
      );
      const id = Number(info.lastInsertRowid);
      for (const objectId of e.objects ?? []) objectStmt.run(objectId, id);
      for (const actor of e.actors) actorStmt.run(actor, id);
      return { ...e, id };
    });
  }

  /** A person's events in [fromTick, toTick], oldest first unless `newestFirst`. */
  agentEvents(
    agentId: string,
    fromTick: number,
    toTick: number,
    opts: {
      kinds?: string[];
      excludeKinds?: string[];
      limit?: number;
      offset?: number;
      newestFirst?: boolean;
    } = {},
  ): WorldEvent[] {
    const params: Record<string, unknown> = {
      agentId,
      fromTick,
      toTick,
      limit: opts.limit ?? -1,
      offset: opts.offset ?? 0,
    };
    const where = ['a.agent_id = @agentId', 'e.tick >= @fromTick', 'e.tick <= @toTick'];
    const inList = (list: string[], prefix: string, negate: boolean) => {
      list.forEach((k, i) => (params[`${prefix}${i}`] = k));
      const names = list.map((_, i) => `@${prefix}${i}`).join(', ');
      where.push(`e.kind ${negate ? 'NOT IN' : 'IN'} (${names || 'NULL'})`);
    };
    if (opts.kinds) inList(opts.kinds, 'k', false);
    if (opts.excludeKinds?.length) inList(opts.excludeKinds, 'x', true);
    const rows = this.db
      .prepare(
        `SELECT e.id, e.tick, e.kind, e.actors, e.payload
         FROM event_actors a JOIN events e ON e.id = a.event_id
         WHERE ${where.join(' AND ')}
         ORDER BY e.id ${opts.newestFirst ? 'DESC' : 'ASC'} LIMIT @limit OFFSET @offset`,
      )
      .all(params) as EventRow[];
    return rows.map(toWorldEvent);
  }

  /** How many of a person's events in the period there are of each kind, and the most important. */
  agentEventCounts(
    agentId: string,
    fromTick: number,
    toTick: number,
  ): { kind: string; count: number; maxImportance: number }[] {
    return this.stmt(
      `SELECT e.kind AS kind, COUNT(*) AS count,
           MAX(COALESCE(json_extract(e.payload, '$.importance'), 3)) AS maxImportance
         FROM event_actors a JOIN events e ON e.id = a.event_id
         WHERE a.agent_id = @agentId AND e.tick >= @fromTick AND e.tick <= @toTick
         GROUP BY e.kind`,
    ).all({ agentId, fromTick, toTick }) as {
      kind: string;
      count: number;
      maxImportance: number;
    }[];
  }

  /** Events per in-game day of a person's life (day 1 is the first day). */
  agentEventDays(agentId: string): { day: number; entries: number; notable: number }[] {
    return this.stmt(
      `SELECT e.tick / ${TICKS_PER_DAY} + 1 AS day, COUNT(*) AS entries,
           SUM(CASE WHEN COALESCE(json_extract(e.payload, '$.importance'), 3) >= 3 THEN 1 ELSE 0 END) AS notable
         FROM event_actors a JOIN events e ON e.id = a.event_id
         WHERE a.agent_id = @agentId GROUP BY day ORDER BY day`,
    ).all({ agentId }) as { day: number; entries: number; notable: number }[];
  }

  /** A person's logged thoughts (their decisions) in the period, oldest first. */
  agentDecisions(
    agentId: string,
    fromTick: number,
    toTick: number,
  ): { tick: number; thought: string; goal: string }[] {
    // This WHERE must repeat the partial index's condition exactly so SQLite uses tick_inputs_agent.
    const rows = this.stmt(
      `SELECT tick, json_extract(payload, '$.decision.thought') AS thought,
           json_extract(payload, '$.decision.goal') AS goal
         FROM tick_inputs
         WHERE kind = 'decision' AND json_extract(payload, '$.agentId') = @agentId
           AND tick >= @fromTick AND tick <= @toTick
         ORDER BY tick, id`,
    ).all({ agentId, fromTick, toTick }) as {
      tick: number;
      thought: string | null;
      goal: string | null;
    }[];
    return rows.map((r) => ({ tick: r.tick, thought: r.thought ?? '', goal: r.goal ?? '' }));
  }

  /** Saves a question and its answer; returns it with its id. */
  appendInterview(row: Omit<InterviewView, 'id'>): InterviewView {
    const info = this.stmt(
      `INSERT INTO interviews (agent_id, asked_tick, from_tick, to_tick, question, answer, provider, model,
          cost_usd, plan, record_count, used_count, fallback, note, created_at)
         VALUES (@agentId, @askedTick, @fromTick, @toTick, @question, @answer, @provider, @model,
          @costUsd, @plan, @recordCount, @usedCount, @fallback, @note, @createdAt)`,
    ).run({
      agentId: row.agentId,
      askedTick: row.askedTick,
      fromTick: row.fromTick,
      toTick: row.toTick,
      question: row.question,
      answer: row.answer,
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
      plan: row.plan ? 1 : 0,
      recordCount: row.recordCount,
      usedCount: row.usedCount,
      fallback: row.fallback ?? null,
      note: row.note ?? null,
      createdAt: row.createdAt,
    });
    return { ...row, id: Number(info.lastInsertRowid) };
  }

  /** The last `limit` questions asked about a person, oldest first. */
  listInterviews(agentId: string, limit = 100): InterviewView[] {
    const rows = this.stmt(
      'SELECT * FROM (SELECT * FROM interviews WHERE agent_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    ).all(agentId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      agentId: r.agent_id as string,
      askedTick: r.asked_tick as number,
      fromTick: r.from_tick as number,
      toTick: r.to_tick as number,
      question: r.question as string,
      answer: r.answer as string,
      provider: r.provider as ProviderId,
      model: r.model as string,
      costUsd: r.cost_usd as number,
      plan: Boolean(r.plan),
      recordCount: r.record_count as number,
      usedCount: r.used_count as number,
      ...(r.fallback ? { fallback: r.fallback as InterviewFallback } : {}),
      ...(r.note ? { note: r.note as string } : {}),
      createdAt: r.created_at as string,
    }));
  }

  /** Total the observer has paid for questions about a person (USD). */
  interviewSpend(agentId: string): number {
    const row = this.stmt(
      'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM interviews WHERE agent_id = ?',
    ).get(agentId) as { total: number };
    return Math.round(row.total * 1e6) / 1e6;
  }

  queryEvents(opts: {
    limit: number;
    beforeId?: number;
    agentId?: string;
    minImportance: number;
    /** Only events up to this tick (replay). */
    atOrBeforeTick?: number;
    /** Words to search for in the event text (case-insensitive). */
    q?: string;
    /** Life story: this person's important events and their own diary. */
    story?: boolean;
  }): WorldEvent[] {
    const where = ["COALESCE(json_extract(payload, '$.importance'), 3) >= @minImportance"];
    if (opts.beforeId !== undefined) where.push('id < @beforeId');
    if (opts.atOrBeforeTick !== undefined) where.push('tick <= @atOrBeforeTick');
    if (opts.agentId)
      where.push('id IN (SELECT event_id FROM event_actors WHERE agent_id = @agentId)');
    if (opts.story)
      where[0] = `(${where[0]} OR (kind = 'reflected' AND json_extract(actors, '$[0]') = @agentId))`;
    const words = (opts.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
    const params: Record<string, unknown> = {};
    words.forEach((w, i) => {
      where.push(`json_extract(payload, '$.text') LIKE @q${i} ESCAPE '\\'`);
      params[`q${i}`] = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    });
    const rows = this.db
      .prepare(
        `SELECT id, tick, kind, actors, payload FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit`,
      )
      .all({
        limit: opts.limit,
        minImportance: opts.minImportance,
        beforeId: opts.beforeId ?? null,
        agentId: opts.agentId ?? null,
        atOrBeforeTick: opts.atOrBeforeTick ?? null,
        ...params,
      }) as {
      id: number;
      tick: number;
      kind: string;
      actors: string;
      payload: string;
    }[];
    return rows.map(toWorldEvent);
  }

  /**
   * An object's history up to `atOrBeforeTick` (all of it if omitted): lasting milestones
   * (importance 3+, oldest first, up to 200), the latest 20 routine uses, how many uses in all,
   * and who used it most.
   */
  objectHistory(objectId: string, atOrBeforeTick?: number): ObjectHistoryRows {
    const params = { objectId, atOrBeforeTick: atOrBeforeTick ?? null };
    const importance = "COALESCE(json_extract(e.payload, '$.importance'), 3)";
    const from = `FROM event_objects o JOIN events e ON e.id = o.event_id
      WHERE o.object_id = @objectId AND (@atOrBeforeTick IS NULL OR e.tick <= @atOrBeforeTick)`;
    const milestones = this.stmt(
      `SELECT e.id, e.tick, e.kind, e.actors, e.payload ${from} AND ${importance} >= 3
         ORDER BY e.id DESC LIMIT 200`,
    ).all(params) as EventRow[];
    const recent = this.stmt(
      `SELECT e.id, e.tick, e.kind, e.actors, e.payload ${from} AND ${importance} < 3
         ORDER BY e.id DESC LIMIT 20`,
    ).all(params) as EventRow[];
    const uses = this.stmt(`SELECT COUNT(*) AS n ${from} AND ${importance} < 3`).get(params) as {
      n: number;
    };
    const regulars = this.stmt(
      `SELECT json_extract(e.actors, '$[0]') AS agentId, COUNT(*) AS count ${from}
         AND ${importance} < 3 AND json_extract(e.actors, '$[0]') IS NOT NULL
         GROUP BY agentId ORDER BY count DESC, MIN(e.id) LIMIT 5`,
    ).all(params) as { agentId: string; count: number }[];
    return {
      milestones: milestones.reverse().map(toWorldEvent),
      recent: recent.map(toWorldEvent),
      uses: uses.n,
      regulars,
    };
  }

  /** Ids of the map objects that were there when the world was created (its first snapshot). */
  foundingObjectIds(): Set<string> {
    if (!this.foundingIds) {
      const row = this.stmt('SELECT state FROM snapshots ORDER BY tick ASC LIMIT 1').get() as
        { state: Buffer } | undefined;
      const state = row
        ? deserializeWorldState(JSON.parse(gunzipSync(row.state).toString('utf8')))
        : null;
      this.foundingIds = new Set(state?.map.objects.map((o) => o.id) ?? []);
    }
    return this.foundingIds;
  }

  /** The tick from which object history is complete for day-to-day use (0 if always). */
  objectHistorySince(): number {
    if (this.cachedObjectHistorySince !== null) return this.cachedObjectHistorySince;
    const row = this.stmt("SELECT value FROM meta WHERE key = 'objectHistorySince'").get() as
      { value: string } | undefined;
    this.cachedObjectHistorySince = row ? (JSON.parse(row.value) as number) : 0;
    return this.cachedObjectHistorySince;
  }

  appendCalls(calls: CallRecord[]): void {
    const insert = this.stmt(
      `INSERT INTO llm_calls (tick, agent_id, provider, model, trigger, input_tokens, output_tokens, cached_tokens,
        cost_usd, estimated, plan, latency_ms, prompt, response, error)
       VALUES (@tick, @agentId, @provider, @model, @trigger, @inputTokens, @outputTokens, @cachedTokens,
        @costUsd, @estimated, @plan, @latencyMs, @prompt, @response, @error)`,
    );
    const prune = this.stmt(
      `UPDATE llm_calls SET prompt = NULL, response = NULL
       WHERE agent_id = ? AND (prompt IS NOT NULL OR response IS NOT NULL) AND id <= (
         SELECT id FROM llm_calls WHERE agent_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_CALL_TEXT})`,
    );
    const agents = new Set<string>();
    for (const c of calls) {
      insert.run({ ...c, estimated: c.estimated ? 1 : 0, plan: c.plan ? 1 : 0 });
      agents.add(c.agentId);
    }
    for (const a of agents) prune.run(a, a);
  }

  listCalls(agentId: string, limit: number): LlmCallView[] {
    const rows = this.stmt(
      `SELECT id, tick, provider, model, trigger, input_tokens, output_tokens, cost_usd, plan, latency_ms, prompt, response, error
         FROM llm_calls WHERE agent_id = ? ORDER BY id DESC LIMIT ?`,
    ).all(agentId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      tick: r.tick as number,
      provider: r.provider as string,
      model: r.model as string,
      trigger: r.trigger as string,
      inputTokens: r.input_tokens as number,
      outputTokens: r.output_tokens as number,
      costUsd: r.cost_usd as number,
      plan: Boolean(r.plan),
      latencyMs: r.latency_ms as number,
      prompt: (r.prompt as string | null) ?? null,
      response: (r.response as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
  }

  /**
   * What each person's AI has used so far: one row per `agent_id` in the log of AI calls (calls
   * that aren't tied to anyone show up under their own id). Cost is rounded to a millionth of a
   * dollar so sums of many small prices don't show float noise.
   */
  usageByAgent(): Map<string, BrainUsage> {
    const rows = this.stmt(
      `SELECT agent_id, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd,
          SUM(CASE WHEN plan = 1 THEN cost_usd ELSE 0 END) AS plan_usd
         FROM llm_calls GROUP BY agent_id`,
    ).all() as {
      agent_id: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      plan_usd: number;
    }[];
    return new Map(
      rows.map((r) => [
        r.agent_id,
        {
          calls: r.calls,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          costUsd: Math.round(r.cost_usd * 1e6) / 1e6,
          planUsd: Math.round(r.plan_usd * 1e6) / 1e6,
        },
      ]),
    );
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.stmts.clear();
    if (this.db.open) this.db.close();
  }
}
