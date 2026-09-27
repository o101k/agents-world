import Database from 'better-sqlite3';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { WorldMeta } from '@aw/shared';
import { deserializeWorldState, serializeWorldState, type WorldState } from '@aw/sim';

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

export interface StoredEvent {
  id: number;
  tick: number;
  kind: string;
  actors: string[];
  payload: unknown;
}

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
      file.appendEvent(state.tick, 'world_created', { name: meta.name, seed: meta.seed });
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
    return Object.fromEntries(META_KEYS.map((k) => [k, map.get(k)])) as unknown as WorldMeta;
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
  }

  loadLatestSnapshot(): WorldState {
    const row = this.db.prepare('SELECT state FROM snapshots ORDER BY tick DESC LIMIT 1').get() as
      { state: Buffer } | undefined;
    if (!row) throw new Error(`World file ${this.path} has no snapshot`);
    return deserializeWorldState(JSON.parse(gunzipSync(row.state).toString('utf8')));
  }

  appendEvent(tick: number, kind: string, payload: unknown, actors: string[] = []): void {
    this.db
      .prepare('INSERT INTO events (tick, kind, actors, payload) VALUES (?, ?, ?, ?)')
      .run(tick, kind, JSON.stringify(actors), JSON.stringify(payload));
  }

  listEvents(limit = 100): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT id, tick, kind, actors, payload FROM events ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; tick: number; kind: string; actors: string; payload: string }[];
    return rows.map((r) => ({
      ...r,
      actors: JSON.parse(r.actors),
      payload: JSON.parse(r.payload),
    }));
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
