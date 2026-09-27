# Design

A short technical design of what is built so far. The full plan, decisions and roadmap live in
[`../CLAUDE.md`](../CLAUDE.md). Updated at the end of every phase.

_Last updated: Phase 4._

## Processes

```
Browser tab (apps/web)  ──HTTP /api/* + WebSocket /ws──►  Local helper (apps/server, Node)
                                                           ├─ WorldManager → one SQLite file per world
                                                           ├─ WorldRunner (the active world's clock)
                                                           ├─ @aw/sim  (pure world rules)
                                                           └─ @aw/brain (Mock / Anthropic / OpenAI-style)
```

- The helper listens on **127.0.0.1 only** (default port 4747). It serves the built UI from
  `apps/web/dist`; in dev mode Vite serves the UI on :5173 and proxies `/api` and `/ws`.
- **Local-only guard** (`apps/server/src/security.ts`): every request must have a loopback `Host`
  (prevents DNS rebinding) and, if it has an `Origin`, it must be the app's own origin. No CORS
  headers are ever sent.
- TypeScript runs directly via `tsx` in the helper; internal packages export their TS source.

## Packages and boundaries

| Package      | Contents                                                                               | May import         |
| ------------ | -------------------------------------------------------------------------------------- | ------------------ |
| `@aw/shared` | Types for maps, agents, perceptions, decisions, events; wire protocol (Zod); constants | zod                |
| `@aw/sim`    | Seeded RNG, map generator, world state, tick engine, perception, market, life cycle    | `@aw/shared`       |
| `@aw/brain`  | Provider interface, router, prompts, decide-tool schema/parser, Mock brain, pricing    | `@aw/shared`, SDKs |
| `@aw/server` | Config, settings/keys, world files, manager, runner, HTTP routes, WebSocket hub        | shared, sim, brain |
| `@aw/web`    | React UI, PixiJS renderer, procedural pixel art                                        | `@aw/shared` only  |

ESLint enforces: the sim can't use `Math.random`, `Date`, `performance`, `fetch` or Node I/O; the
UI can't import the sim, brain or server. A test checks the decide tool offers exactly the actions
the simulation understands.

## Determinism, saving and resuming

- All randomness in the sim comes from `Rng` (sfc32); its state is part of `WorldState`.
- `step(state, inputs)` is the only way the world changes. Inputs are brain decisions (with their
  cost), decision timeouts and observer commands (`spawn_agent`, `set_brain`, `set_default_brain`,
  `set_days_per_year`).
- The runner logs every input the moment it's queued (tagged with the tick it applies to), commits
  inputs + events + meta in one transaction per loop iteration, and writes a full snapshot every
  6 in-game hours and on pause/stop.
- **Resume** = latest snapshot + replay of logged inputs up to the saved tick; inputs already logged
  for the next tick are re-queued and outstanding decisions re-asked. Tests check that crash-resume
  and stop/restart both match an uninterrupted run exactly.
- World state has a version; older saves are upgraded on load (v1 → v5).

World file (SQLite, WAL, migrations via `PRAGMA user_version`): `meta`, `snapshots` (gzipped JSON,
pruned to one per day after two days), `tick_inputs`, `events`, `llm_calls`.

## World state (v5)

`seed, tick, rng, settings {daysPerYear, defaultBrain}, map {width, height, tiles, objects},
agents[], resources{}, market {stock}, offers[], requests[], owners{}, nextAgentNum, nextOfferNum,
mapVersion`. Agents are never removed (the dead stay for history and family trees).

An **agent** holds identity (name, family name, sex, age in years), appearance, personality (Big
Five), traits, background, occupation, home, position, needs, health, inventory, money, skills,
knowledge (places seen, last-seen amounts, market prices seen), people (relationships), memory
(recent + long-term stream), brain config, current thought/goal/plan/action, family links,
aptitude, constitution, pregnancy, will.

## The tick engine (`packages/sim/src/engine.ts`)

1. Apply inputs. Decisions are validated with `IntentSchema`; bad steps are dropped. A decision
   replaces the plan, records spending, applies reported feelings and "remember" notes.
2. Hourly: resources regrow (bushes, fields; chopped trees until full), offers/requests expire.
   Daily: the market drifts toward normal stock; a "new day" event.
3. For each living person: age += 1/(1440 × daysPerYear); needs decay (babies, the pregnant and the
   old differ); health suffers at 0 and recovers with constitution; death at health 0; sleep and
   waking; `lifeTick` (below); the current action advances (walking one tile per tick — half speed
   for toddlers and the very old — gathering, chopping, crafting, building, eating, drinking); the
   next plan step starts; decision points are raised.
4. Every 5 ticks each awake person looks around (8 tiles by day, 4 at night) and updates knowledge.

Decision points: spawned, woke up, plan done, action failed, urgent need (once per dip), spoken to,
trade offer / answer, robbed, attacked, proposal / answer, separated, child request, child born,
child needs feeding, grew up, and a check-in (8 h / 4 h / 3 h by effort). Repeated failures pause
the person (5 min × streak, max 60) before deciding again, so a confused brain can't loop.

## Perception — no omniscience (`packages/sim/src/perception.ts`)

A person's `Perception` has only: their body, bag, money and position; where they are; people in
sight (strangers described by looks until introduced); places they've seen (with food seen there,
crop, owner); prices they saw at the market; recent experiences; recalled memories; people they
know and how they feel about them; family (children's needs only when with them); open offers and
requests; their stage, what they can do, language ability; the unfinished plan.

Memory recall ranks the long-term stream by importance + recency + relevance (people present,
the speaker, words from the goal): 6 / 12 / 20 memories by effort. The stream is capped at 300.

## Work, trade and conflict

- Items with nutrition and base prices; recipes at the bakery (bread) and workshop (planks, tools);
  tools boost yields and sometimes break; skill (× aptitude) speeds crafting and adds bonus output.
- The town market prices by stock (0.5–2× base, spread ~85%/115%), refuses to buy beyond 3× normal
  stock, and drifts 30%/day toward normal. Coins enter the economy when villagers sell.
- Between people: `give`; `offer_trade` → `respond_offer`; `steal` (random success/detection by the
  victim and witnesses); `attack` (8–25 damage, +5 with tools; can kill). Everyone first walks up to
  the other person (`approach`, three catch-up attempts).
- Conversation: `talk_to` within 2 tiles; bystanders within 5 overhear; replies until 6 turns;
  talking takes time; young speakers are simplified and young listeners understand only part.

## Life cycle (`packages/sim/src/life.ts`)

- Stages (baby < 1, toddler < 3, child < 13, teen < 18, adult < 60, elder) with allowed actions
  (`ABILITIES`); prompts are framed per stage and list only allowed actions.
- Babies live indoors at home and must be fed (`feed`); hungry little ones cry and alert family in
  earshot. Language grows with age and with speech heard.
- Relationships: familiarity, affection, trust, romance, role — changed by events and feelings.
- Partnership (`propose_partnership` → `respond_proposal`, moving in, `end_partnership`); children
  by mutual consent (`try_for_child` → `respond_child_request`), fertility by age, pregnancy 0.75
  years, `giveBirth` + `inherit` (appearance, temperament, aptitude, constitution); parents
  `name_child` (automatic name after a day).
- `teach` and learning by watching (`observeWork`); `train` scales gains by aptitude.
- Old-age hazard 0.3%/year at 50 doubling every 8 years ÷ constitution. `settleEstate`: will heir →
  partner → children → housemates; buildings become co-owned by heirs. `mournDeath` informs family
  and those nearby.
- `build_house` on a free plot near the market (3 planks per hour-long stretch, ~10 stretches);
  map changes bump `mapVersion`.

## Brains (`packages/brain`)

- `BrainProvider.decide(request, config) → { decision, usage?, trace? }`; providers:
  `AnthropicProvider` (official SDK; system prompt marked for caching; `tool_choice: auto`;
  `output_config.effort` only on models that take it), `OpenAIProvider` (official SDK for OpenAI
  and any OpenAI-compatible base URL; named function call; `reasoning_effort` on reasoning models),
  and `MockBrain` (a free rulebook over the perception — work by occupation, trade, family care,
  courtship, conflict responses).
- `prompt.ts`: stage-aware system prompt (identity, temperament, how life works, allowed actions)
  and a user message with everything in the perception.
- `schema.ts`: one flat `decide` tool (`action`, `target`, item/quantity/coins, recipe, trade
  fields, offer id, accept, skill, name; plus `feelings` and `remember`), parsed to typed intents.
- `router.ts`: per-provider concurrency (6 hosted, 2 local), timeout, Mock fallback for providers
  without keys, **instinct** for Frugal people's routine needs, errors/refusals → a short pause.
- `pricing.ts`: default Claude prices; editable table; unknown models at a pessimistic $3/$15.
- `person.ts`: turns an observer's description into a person (AI or offline).

## Keys, spending and the cap

`SettingsStore` keeps keys in `~/.agents-world/secrets.json` (mode 600) or env vars; URLs, default
models and prices in `settings.json`. The browser only sees hints like `sk-…abcd`. Each decision's
cost travels with the logged input; the world total is `meta.spentUsd`. Before any paid decision
the runner checks it against `meta.capUsd` and pauses with a `cap_reached` event.

## API

| Method | Path                                    | Result                                                             |
| ------ | --------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/health`                           | `{ ok, version }`                                                  |
| GET    | `/api/worlds`                           | `{ worlds, activeWorldId }`                                        |
| POST   | `/api/worlds`                           | create `{ name, seed?, mapSize?, cast? }` → `{ world }`            |
| POST   | `/api/worlds/:id/activate`              | make it the active (running) world                                 |
| GET    | `/api/worlds/:id/view`                  | `{ meta, settings, map, tick, runner, agents, resources, owners }` |
| POST   | `/api/worlds/:id/control`               | `{ running?, speed? }`                                             |
| GET    | `/api/worlds/:id/events`                | `?limit&beforeId&agentId&minImportance` → `{ events }`             |
| GET    | `/api/worlds/:id/agents/:agentId`       | inspector detail                                                   |
| PUT    | `/api/worlds/:id/agents/:agentId/brain` | set a person's brain                                               |
| GET    | `/api/worlds/:id/agents/:agentId/calls` | recent AI exchanges                                                |
| GET    | `/api/worlds/:id/family/:agentId`       | family tree                                                        |
| PUT    | `/api/worlds/:id/default-brain`         | `{ brain, applyToAll }`                                            |
| PUT    | `/api/worlds/:id/cap`                   | `{ capUsd }`                                                       |
| PUT    | `/api/worlds/:id/aging`                 | `{ daysPerYear }`                                                  |
| GET    | `/api/worlds/:id/market`                | `{ stock, quotes, moneySupply }`                                   |
| POST   | `/api/worlds/:id/spawn`                 | `{ description, name?, sex?, age? }` → `{ agentId }`               |
| DELETE | `/api/worlds/:id`                       | delete permanently                                                 |
| GET    | `/api/settings`                         | providers (no keys), prices, data folder                           |
| PUT    | `/api/settings/providers/:id`           | `{ apiKey?, baseUrl?, defaultModel? }`                             |
| PUT    | `/api/settings/prices`                  | `{ model: { input, output } \| null }`                             |
| GET    | `/api/providers/:id/models`             | model list (doubles as a connection test)                          |

WebSocket `/ws` pushes `hello`, `worlds_changed`, `frame` (tick, runner status incl. spending,
agent views, changed resources, map version) and `events`. There is deliberately no endpoint that
sets an agent's state or decisions; changing someone's brain changes how they think, not what they
decide.

## Rendering (`apps/web/src/map/`)

- `pixelArt.ts` paints every sprite in code (16 px tiles) into one atlas; people get a sprite strip
  (down/up/side × 2 walk frames) painted from their own colours, with an outline.
- `renderer.ts` (PixiJS v8): ground in 32×32-tile chunks with cull areas; objects and people in one
  depth-sorted layer; people tween between frames; children drawn smaller; sleepers lie down;
  babies and indoor sleepers hidden; the dead become gravestones; half-built houses fade in; speech
  bubbles, name labels and "z z"/"…" in a screen-space overlay; night tint; follow mode. It
  animates only while something moves.
- `camera.ts`: pure camera maths (tested).
