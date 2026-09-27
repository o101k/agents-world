# Design

A short technical design of what is built so far. The full plan, decisions and roadmap live in
[`../CLAUDE.md`](../CLAUDE.md). Updated at the end of every phase.

_Last updated: Phase 2._

## Processes

```
Browser tab (apps/web)  ──HTTP /api/* + WebSocket /ws──►  Local helper (apps/server, Node)
                                                           ├─ WorldManager → one SQLite file per world
                                                           └─ @aw/sim (pure world rules)
```

- The helper listens on **127.0.0.1 only** (default port 4747). In production it also serves the
  built UI from `apps/web/dist`; in dev mode Vite serves the UI on :5173 and proxies `/api` and `/ws`.
- **Local-only guard** (`apps/server/src/security.ts`): every request must have a loopback `Host`
  (prevents DNS rebinding) and, if it has an `Origin`, it must be the app's own origin (prevents
  other websites from driving the helper). No CORS headers are ever sent.
- TypeScript runs directly via `tsx` in the helper; internal packages export their TS source,
  so there is no build step except for the UI (Vite).

## Packages and boundaries

| Package      | Contents                                                                        | May import   |
| ------------ | ------------------------------------------------------------------------------- | ------------ |
| `@aw/shared` | Map/tile types, world meta, wire protocol (Zod schemas), time constants, base64 | zod          |
| `@aw/sim`    | Seeded RNG, noise, A* pathfinding, walkability, village generator, `WorldState` | `@aw/shared` |
| `@aw/server` | Config, world files, world manager, HTTP routes, WebSocket hub                  | shared, sim  |
| `@aw/web`    | React UI, PixiJS renderer, procedural pixel art                                 | shared only  |

ESLint enforces the important rules: the sim can't use `Math.random`, `Date`, `performance`,
`fetch` or Node I/O modules; the UI can't import the sim or server.

## Determinism

All randomness in the simulation comes from `Rng` (sfc32 seeded by a cyrb128 string hash). Its
state (`[a, b, c, d]`) is part of `WorldState`, so a snapshot captures it and a world continues
identically after loading. Map generation uses its own stream (`<seed>:map`) and stateless
hash-based value noise, so the same seed always yields the same map (covered by tests).

## World state

```ts
interface WorldState {
  version: 1;
  seed: string;
  tick: number; // 1 tick = 1 in-game minute
  rng: [number, number, number, number];
  settings: { daysPerYear: number };
  map: { width; height; tiles: Uint8Array; objects: MapObject[] };
}
```

Tiles are one byte each (`Grass, Water, Sand, Path, Farmland, Bridge`). Objects have a kind
(`tree, berry_bush, rock, house, bakery, workshop, market, well, field, dock`), a footprint
(x, y, w, h) and, for buildings, a doorway tile. On the wire and in snapshots, tiles are base64.

## Map generation (`packages/sim/src/mapgen.ts`)

1. A river meanders top-to-bottom in the western third (fbm noise), with sandy banks.
2. The village centre sits east of the river; a 9×7 dirt plaza holds the town market and well.
3. Bakery, workshop and houses (≈ map area / 512, min 6) are placed on rings around the plaza,
   each with a clear 1-tile margin and a free doorstep.
4. Farm fields (3, or 5 on large maps) are placed further out; a fishing dock sits on the east bank.
5. Paths are carved with A* from every doorstep, field and the dock to the plaza, plus a road
   across the map (crossing the river as a bridge). Existing paths are cheap, so paths merge.
6. Forest density rises with distance from the village (fbm noise); scattered trees, berry
   bushes and rocks fill the rest.

Tests check, for many seeds and all sizes, that every door, field and the dock is reachable on
foot from the well and that buildings never overlap water or each other.

## Persistence (`apps/server/src/worlds/`)

```
~/.agents-world/app.json                 { activeWorldId }
~/.agents-world/worlds/<id>.sqlite       one world
```

World file schema (migrations tracked with `PRAGMA user_version`; WAL mode):

| Table                                     | Purpose                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `meta(key, value)`                        | id, name, seed, createdAt, updatedAt, tick, map size (JSON values) |
| `snapshots(tick, created_at, state)`      | gzipped JSON `WorldState`                                          |
| `tick_inputs(id, tick, kind, payload)`    | everything the sim consumes each tick (from Phase 1)               |
| `events(id, tick, kind, actors, payload)` | readable history for the timeline                                  |

Snapshots are pruned to the last two in-game days plus one per day and the first. Deleting a
world removes its `.sqlite`, `-wal` and `-shm` files. World ids match `^w_[a-z0-9]{8,32}$`,
which also prevents path tricks.

## API (Phase 0)

| Method | Path                       | Result                                           |
| ------ | -------------------------- | ------------------------------------------------ |
| GET    | `/api/health`              | `{ ok, version }`                                |
| GET    | `/api/worlds`              | `{ worlds, activeWorldId }`                      |
| POST   | `/api/worlds`              | create `{ name, seed?, mapSize? }` → `{ world }` |
| POST   | `/api/worlds/:id/activate` | make it the active world                         |
| GET    | `/api/worlds/:id/view`     | `{ meta, settings, map }` (map tiles base64)     |
| DELETE | `/api/worlds/:id`          | delete permanently                               |

WebSocket `/ws` pushes `hello` on connect and `worlds_changed` after any change, so every open tab
stays in sync. Client → server messages are validated with Zod (only `ping` exists so far).

## Rendering (`apps/web/src/map/`)

- `pixelArt.ts` paints every sprite in code at 16 px/tile into one shelf-packed atlas canvas.
  Sprites are requested by name, so a real tileset can replace them later.
- `renderer.ts` (PixiJS v8): ground tiles in 32×32-tile chunk containers with explicit cull areas;
  objects in one layer sorted by their bottom edge (depth); nearest-neighbour scaling. It renders
  **on demand** (no continuous loop) so an idle map uses no CPU/GPU.
- `camera.ts` is pure maths (tested): zoom snaps to fixed steps and keeps the point under the
  cursor fixed; the camera can't lose the map off-screen.
- People: each person's sprite strip (down/up/side × 2 walk frames) is painted from their
  appearance colours. Positions tween between frames (duration = observed frame interval), so
  walking looks smooth at any speed. Sleepers lie down with "z z"; people asleep indoors are
  hidden; the dead become gravestones. Name labels live in a screen-space overlay (shown at zoom ≥ 2
  or when selected). A world-sized overlay darkens the map at night.
- The animation loop runs only while something moves or the camera follows someone.
