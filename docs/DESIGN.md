# Design

A short technical design of what is built so far. The full plan, decisions and roadmap live in
[`../CLAUDE.md`](../CLAUDE.md). Updated at the end of every phase.

_Last updated: Phase 6._

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
- npm workspaces hold the packages, and Turborepo (`turbo.json`) runs the tasks: per-package `typecheck` (tsgo), `build` (the web UI) and `dev`; ESLint and Vitest run once over the whole repo as root tasks. Results are cached in `.turbo/` (git-ignored).

## Packages and boundaries

| Package      | Contents                                                                                                  | May import         |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------------ |
| `@aw/shared` | Types for maps, agents, perceptions, decisions, events; wire protocol (Zod); constants                    | zod                |
| `@aw/sim`    | Seeded RNG, map generator, world state, tick engine, perception, market, life cycle, memory, world events | `@aw/shared`       |
| `@aw/brain`  | Provider interface, router, prompts, decide-tool schema/parser, Mock brain, pricing                       | `@aw/shared`, SDKs |
| `@aw/server` | Config, settings/keys, world files, manager, runner, HTTP routes, WebSocket hub                           | shared, sim, brain |
| `@aw/web`    | React UI, PixiJS renderer, procedural pixel art                                                           | `@aw/shared` only  |

ESLint enforces: the sim can't use `Math.random`, `Date`, `performance`, `fetch` or Node I/O; the
UI can't import the sim, brain or server. A test checks the decide tool offers exactly the actions
the simulation understands.

## Determinism, saving and resuming

- All randomness in the sim comes from `Rng` (sfc32); its state is part of `WorldState`.
- `step(state, inputs)` is the only way the world changes. Inputs are brain decisions (with their
  cost), decision timeouts and observer commands (`spawn_agent`, `set_brain`, `set_brains`, `set_default_brain`,
  `set_days_per_year`, `world_event`).
- The runner logs every input the moment it's queued (tagged with the tick it applies to), commits
  inputs + events + meta in one transaction per loop iteration, and writes a full snapshot every
  6 in-game hours and on pause/stop.
- **Resume** = latest snapshot + replay of logged inputs up to the saved tick; inputs already logged
  for the next tick are re-queued and outstanding decisions re-asked. Tests check that crash-resume
  and stop/restart both match an uninterrupted run exactly.
- World state has a version; older saves are upgraded on load, step by step (v1 → v8).
- **Replay** (`apps/server/src/worlds/replayer.ts`) uses the same mechanism for any past tick: the
  nearest earlier snapshot (one per in-game day is kept forever) plus the logged inputs since, run
  through `step` with no brains and nothing written. The last replayed state is cached, so
  scrubbing forward only steps the difference; going back reloads a snapshot. Worst case is one
  in-game day of ticks (~1–3 s for 150 people). History from before a rules change replays under
  the new rules, so very old stretches of an upgraded world may differ from what happened.

World file (SQLite, WAL, migrations via `PRAGMA user_version`): `meta`, `snapshots` (gzipped JSON,
pruned to one per day after two days), `tick_inputs`, `events`, `event_objects`, `llm_calls`.

**Object history.** An event names the people it involves (`actors`) and the map objects it
happened to or at (`objects`: a house built or burnt, a bush picked, the market traded at, the
home a baby was born into). The sim's `emit` takes them as its last argument, so anything new
only has to pass its object's id to get a history. The world file indexes them in
`event_objects (object_id, event_id)`. `GET /api/worlds/:id/objects/:objectId/history` returns
whether the object was in the world's first snapshot (founded with the village) or made later,
its lasting changes (importance ≥ 3, oldest first), its latest 20 day-to-day uses, a use count,
the five people who used it most and who lives there; with `?tick=` all of it as it was then.
Object ids are never reused. Worlds upgraded to this (migration 4) get their `built` and `fire`
events matched to buildings by name, and meta `objectHistorySince` marks when day-to-day use
started being recorded.

## World state (v9)

`seed, tick, rng, settings {daysPerYear, defaultBrain}, map {width, height, tiles, objects},
agents[], resources{}, market {stock}, offers[], requests[], owners{}, nextAgentNum, nextOfferNum,
mapVersion, conditions[], nextConditionNum, calendar {year, progress}, stalls{}, pens{}, contracts[],
meetings[], rules[], leaderId, treasury` (plus the `next…Num` counters for contracts, meetings,
proposals and rules). Agents are never removed (the dead stay for history
and family trees). Map objects may carry `progress` (being built or rebuilt), `burntTick`, and for
buildings `workDone`/`stoneWork`/`stone` (built with stone: fire can't burn it).

An **agent** holds identity (name, family name, sex, age in years), appearance, personality (Big
Five), traits, background, occupation, home, position, needs, health, inventory, money, skills,
knowledge (places seen, last-seen amounts, market prices seen), people (relationships), memory
(recent + long-term stream), brain config, current thought/goal/plan/action, family links,
aptitude, constitution, pregnancy, will, adoptive parents, sickness and immunity, the forgotten list, and the day of
the last reflection and age of the last life chapter, the meetings they've heard of, and what
they last read on the market's notice board.

## The tick engine (`packages/sim/src/engine.ts`)

1. Apply inputs. Decisions are validated with `IntentSchema`; bad steps are dropped. A decision
   replaces the plan, records spending, applies reported feelings and "remember" notes, and
   refreshes the memories it recalled. A **reflection** (answer to a `reflect` request) changes only
   the mind: diary/chapter, beliefs, feelings, maybe the goal — the body keeps sleeping.
   Then world conditions advance (`conditionsTick`: endings, fires burning down, contagion).
2. Hourly: resources regrow (bushes, fields; chopped trees until full), offers/requests expire.
   Daily: the market drifts toward normal stock; a "new day" event.
3. For each living person: age += 1/(1440 × daysPerYear); needs decay (babies, the pregnant and the
   old differ); health suffers at 0 and recovers with constitution; death at health 0; sleep and
   waking; the course of an illness (`sicknessTick`); `lifeTick` (below); `memoryTick` (fading at
   03:00, children's temperament drifting toward their carers, and the night's reflection request);
   the current action advances (walking one tile per tick — half speed
   for toddlers and the very old — gathering, chopping, crafting, building, eating, drinking); the
   next plan step starts; decision points are raised. Outdoors there is **one person per tile**
   (`occupancy.ts`; people indoors don't take room). A line of walkers moves up together and
   walkers whose ways cross (head-on or round a corner) pass at once; someone idling in the way
   (resting, eating) steps aside; otherwise the walker steps round through a short detour, plans a
   new route round a standing blocker, and finally squeezes past (swaps places: after 2 ticks for
   a sleeper, 4 for someone standing, 10 for another walker). Plans prefer free goal tiles and
   route round people standing still. At the end of every tick a deterministic separation pass
   moves anyone still sharing a tile (first in the list keeps it) to the nearest free one.
4. Every 5 ticks each awake person looks around (8 tiles by day, 4 at night) and updates knowledge.

Decision points: spawned, woke up, plan done, action failed, urgent need (once per dip), spoken to,
trade offer / answer, robbed, attacked, proposal / answer, separated, child request, child born,
child needs feeding, grew up, felt ill, a world event they witnessed (storm, fire, their home found
burnt), the night's reflection, and a check-in (8 h / 4 h / 3 h by effort). Repeated failures pause
the person (5 min × streak, max 60) before deciding again, so a confused brain can't loop.

## Perception — no omniscience (`packages/sim/src/perception.ts`)

A person's `Perception` has only: their body, bag, money, skill levels and position; where they are; people in
sight (strangers described by looks until introduced); places they've seen (with food seen there,
crop, owner); prices they saw at the market; recent experiences; recalled memories; people they
know and how they feel about them; family (children's needs only when with them); open offers and
requests; their stage, what they can do, language ability; the unfinished plan; the conditions
they can sense (storm, drought, dry river, fire in sight, sickness going around); whether they're
ill; their latest life chapters and beliefs; their work agreements; what they know of the village
(rules, leader and purse as last read on the market's notice board, meetings they heard called,
proposals at a meeting they're at); rocks in sight; for a reflection, the material to look back on.
Places they couldn't reach recently are flagged, so nobody keeps walking into a wall.

Memory recall ranks the long-term stream by vividness (strength) + recency + relevance (people
present, the speaker, words from the goal): 6 / 12 / 20 memories by effort.

## Memory over a long life (`packages/sim/src/memory.ts`)

- Every memory has a **strength** (starts at its importance, 1–10). Each night at 03:00 it keeps
  `0.85 + 0.014 × importance` of it (importance 2 fades in ~5 nights, 5 in ~19, 8 in ~50); core
  memories (importance ≥ 9) and life chapters never fade. Memories formed before age 3 keep only
  80% a night whatever they were (childhood amnesia). Recalling a memory for a decision adds 0.5.
- Below strength 1 a memory is **forgotten**: gone from the mind (and prompts), kept in a capped
  list of 100 for the observer. The active stream is capped at 500 (the faintest go first).
- **Reflection**: asleep between 21:00 and 05:00, anyone 3+ who had a noteworthy day is asked to
  reflect once per night. They write a **diary** entry (stored as a memory of importance 6) and up
  to 3 **beliefs** (at most 8 kept; the oldest give way). On the first night after a birthday
  (age 4+) the reflection is a **life chapter** for that year instead ("My 35th year: …",
  importance 9); that year's diary entries are folded into it. Every diary entry and chapter is
  also a `reflected` event in the world history, so nothing is lost for the observer.
- Frugal people's nightly diary is written by the free rulebook (instinct); their yearly chapter,
  and every reflection of Standard/Deep people, goes to their AI.
- Children 1–12 drift 2% a night toward the temperament of the adults raising them.

## World events (`packages/sim/src/conditions.ts`)

Observer command `world_event {kind, intensity 0.1–1, hours, targetId?}` → an entry in
`state.conditions` (shown to viewers) with an end tick.

- **Drought**: regrowth × (1 − 0.9 × intensity); outdoor daytime thirst +30% × intensity; at ≥ 0.5
  the river can't be drunk from (only wells).
- **Storm**: outdoors there is no sun warmth and −12 × intensity warmth an hour, energy drains
  faster, sight shrinks to 4 tiles and fishing is impossible (≥ 0.5). Sleepers outside are woken;
  people outside get a decision point. Fires don't spread during a storm.
- **Sickness**: max(1, 15% × intensity of the living) fall ill (or a chosen person). Every 10
  minutes anyone within 2 tiles of a sick person (or indoors with them) may catch it
  (8% × intensity ÷ constitution; ×1.3 for under-3s and over-65s). Symptoms show after 3 hours.
- **Fire**: a house, bakery or workshop burns for an hour. People inside are woken, driven out and
  hurt; at the end it is a ruin (`burntTick`, progress 0.3) until rebuilt with `build_house`.
  Buildings within 3 tiles may catch (25% × intensity).
- **Bumper harvest**: every field and bush is filled at once; regrowth doubles while it lasts.

Illness: severity 0.3–0.8 by intensity (×1.25 for the frail) falls by 0.02 × constitution an hour
(×2 asleep, ×0.6 for the very young and old) and rises when food, water or warmth are low; health
drops 2.5 × severity an hour and doesn't heal while ill; severity 0 → recovered and immune for 30
days. `tend` (nurse): −0.1 × (0.5 + caregiving/100) severity and +8 health, once an hour per
patient. Deaths while ill are recorded as "illness".

Shelter: resting (not just sleeping) at your own front door puts you indoors (warm, out of sight);
visitors knock and the person comes out. Burnt or burning buildings give no shelter and can't be
worked in.

## Seasons (`packages/sim/src/seasons.ts`)

The calendar advances every tick by the same step as age, so a year of seasons lasts one year of
age (4 in-game days by default: a day per season) and the aging slider changes both. Worlds start
in early spring. Each season sets growth (spring ×1.1, summer ×1.3, autumn ×0.9, winter ×0.15;
wood regrows slower in winter), night cold (summer ×0.5, autumn ×1.25, winter ×1.8), daytime sun
warmth outdoors (autumn ×0.8, winter ×0.4) and summer heat (+15% thirst outdoors by day). New
seasons and years are announced as `season` events; everyone awake is told the season and what
it means. The mock brain stocks more food in autumn and winter.

## Scale

- 150+ people run at ~2–3 ms per tick with the Mock brain (`npm run stress`). What made it fast:
  an id → person index (`findAgent`), trees in their own spatial grid (`treesNear`), cheaper recall
  scoring, and chit-chat overheard between strangers kept only in working memory (talk about
  one's family or oneself is still remembered).
- Big villages get bigger and more numerous fields (about one per six people), enough houses for
  every household, and unique full names; family links are resolved within households.
- Perception always includes home, one's own buildings and the landmarks (market, well, bakery,
  workshop, dock) — in a big village the nearest 40 places used to crowd out home.
- AI requests queue per provider with priorities: conversation replies and emergencies first,
  routine planning next, night reflections last. A request that times out while still queued is
  dropped and never sent (so never paid for).
- The map caches each 32×32 ground chunk as a texture, and text labels are only restyled when they
  change. Frames carry ~40 KB for 150 people; a snapshot is ~5–7 MB of JSON (~0.5–0.8 MB gzipped).

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

## Growing the village

Seven kinds of work let villagers change the world itself (plan and specs:
[`docs/plans/growing-the-village.md`](plans/growing-the-village.md)). Each lives in its own sim
module and mock-brain file; the engine, perception, prompt and decide tool were wired for all of
them up front so the modules could be built in parallel.

| Module            | Actions                                                     | In short                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farming.ts`      | `clear_field`, `sow`                                        | Clear a 4×3 plot near home (trees give wood) over several hours; it becomes farmland owned by the clearer and partner (at most 2 each). Sow 2 wheat or vegetables to make it grow. Owners notice people taking crops. |
| `construction.ts` | `build {building}` (`build_house` = house)                  | House, bakery, workshop, well, animal pen, market stall (`BUILDINGS` in `@aw/shared`): skill, planks and stone per one-hour stretch. Spare stone in half the stretches makes a stone building that fire can't burn.   |
| `quarry.ts`       | `quarry`                                                    | Cut 2 stone (3 with tools) from a rock in 45 minutes; a rock holds 6 and refills 0.5 a day.                                                                                                                          |
| `animals.ts`      | `tend_animals` (+ buy hens/sheep, craft `clothes`)          | Pens hold up to 8 animals. Tending every 6 h gives eggs and wool (more with fodder); neglected pens lose animals, tended ones breed. Wool → warm clothes (cold hits 40% less; they wear out).                          |
| `stalls.ts`       | `stock_stall`, `take_from_stall`, `buy_from_stall`          | A villager's own stall at their own prices; coins go to the owner. Passers-by see what's for sale.                                                                                                                   |
| `jobs.ts`         | `hire`, `respond_job`, `end_job`                            | Work agreements for a daily wage over some days, paid at 20:00; an unpaid wage ends the agreement and costs trust. Hired hands may tend their employer's pen.                                                       |
| `governance.ts`   | `call_meeting`, `propose_rule`, `vote`, `pay_from_treasury` | Meetings at the market (called an hour ahead, heard within 12 tiles). Proposals pass with more yes than no and at least 2 yes; rules can set a daily levy into the village purse or elect a leader who spends it.   |

- People only know what they've seen: a stall's goods and a pen's animals when they last looked,
  the rules, leader and purse from the market's notice board, and meetings they heard called.
- Longer body actions use a generic `task` action (`clear_field`, `sow`, `quarry`,
  `tend_animals`) finished by the module that started it. Per-tick hooks (`animalsTick`,
  `jobsTick`, `governanceTick`) return at once unless it's their hour.
- New land comes from `land.ts`: `findFreePlot` (grass, a one-tile margin, a walkable doorstep)
  and `clearPlot` (removes trees, bushes and rocks). Map changes bump `mapVersion`.
- The observer sees it all in the World tab's **Village** section (`GET /api/worlds/:id/village`).

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
- Orphans and adoption: a person under 18 with no living parent (birth or adoptive) is an orphan.
  When the last parent dies, `noticeOrphans` records an `orphaned` event, tells the child, and
  alerts grown-ups in the household, the child's relatives and anyone nearby (`orphaned` trigger).
  An orphan's cry reaches any grown-up in earshot. An adult with a home can `adopt_child`: babies
  and toddlers are taken in at once; a child of 3 or more is asked (`adoption` request →
  `respond_adoption`). The adopter's partner adopts too. The child moves into their home, keeps
  their name and birth parents on record (`motherId`/`fatherId`, genes, tree), gains
  `adoptiveParentIds`, and joins `childrenIds` — so adoptive parents can name, are called by and
  leave their estate to them like birth children.
- `build_house` on a free plot near the market (3 planks per hour-long stretch, ~10 stretches);
  map changes bump `mapVersion`.

## Brains (`packages/brain`)

- `BrainProvider.decide(request, config) → { decision, usage?, trace? }`; providers:
  `AnthropicProvider` (official SDK; system prompt marked for caching; `tool_choice: auto`;
  `output_config.effort` only on models that take it), `OpenAIProvider` (official SDK for OpenAI
  and any OpenAI-compatible base URL; named function call; `reasoning_effort` on reasoning models),
  `ClaudePlanProvider` (the owner's Claude Pro/Max subscription through the official Claude Code CLI,
  see below), and `MockBrain` (a free rulebook over the perception — work by occupation, trade, family care,
  nursing the sick, sheltering from storms, rebuilding after a fire, a plain nightly diary,
  courtship, conflict responses).
- `prompt.ts`: stage-aware system prompt (identity, temperament, how life works, allowed actions)
  and a user message with everything in the perception; at night a separate **reflection** message
  (the day's or year's memories, life so far, beliefs, people) asking for `diary` and `beliefs`.
- `schema.ts`: one flat `decide` tool (`action`, `target`, item/quantity/coins, recipe, trade
  fields, offer id, accept, skill, name; plus `feelings`, `remember`, `diary` and `beliefs`),
  parsed to typed intents (a reflection never carries a plan).
- `router.ts`: per-provider concurrency (6 hosted, 2 local, 3 Claude Code processes), timeout, Mock fallback for providers
  without keys, **instinct** for Frugal people's routine needs (and feeling ill, and the nightly
  diary), errors/refusals → a short pause.
- `claudeCli.ts`: runs `claude -p --output-format json --json-schema <decide schema>` with our own
  system prompt (`--system-prompt`), the user prompt on stdin, `--model` (alias `haiku`/`sonnet`/
  `opus` or a full id), `--effort` low/medium/high from Frugal/Standard/Deep (not on Haiku), and
  everything Claude Code would add switched off (`--tools ""`, `--strict-mcp-config`,
  `--disable-slash-commands`, `--safe-mode`, `--no-session-persistence`, an empty temp folder as
  working directory). `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/base URL are removed from its
  environment so it always uses the subscription login. `--bare` is never used (it ignores
  subscription logins). The helper never reads or stores the login: Anthropic forbids apps from
  using subscription tokens directly but allows running the CLI or Agent SDK in your own projects.
  Usage comes from the result's `modelUsage` (per-model tokens; the top-level `usage` covers the
  main loop only) and its cost from `total_cost_usd` (Claude Code's own estimate at API prices),
  marked `coveredByPlan`. A result with `is_error` that still used tokens throws `NoDecisionError`
  carrying that usage, so it is counted. `checkClaudeCli` runs `claude --version` and
  `claude auth status` (no AI call) at startup and on **Check**; the provider exists only when it
  is signed in with a Claude account. A used-up plan limit throws `RateLimitError` (with the reset
  time when the message has one); concurrency is 3 processes.
- `pricing.ts`: default Claude prices; editable table; unknown models at a pessimistic $3/$15.
- `person.ts`: turns an observer's description into a person (AI or offline).

## Keys, spending and the cap

`SettingsStore` keeps keys in `~/.agents-world/secrets.json` (mode 600) or env vars; URLs, default
models and prices in `settings.json`. The browser only sees hints like `sk-…abcd`. Each decision's
cost travels with the logged input; the world total is `meta.spentUsd`. Before any paid decision
the runner checks it against `meta.capUsd` and pauses with a `cap_reached` event. Claude
subscription calls count too, at their API-price value (the owner's choice: the cap doubles as a
usage throttle). That value is also added to `meta.planUsd` (the plan's share of `spentUsd`) and
logged in `llm_calls` with `plan = 1`, so the UI can mark it as covered by the plan.

**Rate limits** (any provider): `limits.ts` turns an SDK's HTTP 429 into a `RateLimitError` with
the provider's message, which limit ran out (from the `anthropic-ratelimit-*` / `x-ratelimit-*`
headers with nothing remaining, or `insufficient_quota`) and when it lifts (`retry-after`, else the
reset header); the Claude subscription throws the same error for its plan limits. The SDKs are told
not to retry a 429 themselves (a fetch wrapper adds `x-should-retry: false`), since sleeping through
retry-after inside a decision would hit the decision timeout and hide the limit. The router returns
`limit` instead of a decision. The runner pauses with a `limit_reached` event naming the person,
provider, model, status, limit, retry-after and message, and sets `runner.rateLimit` (a
`RateLimitNotice`) for the banner. The requests that hit the limit stay outstanding and the tick
doesn't advance, so they're asked again on resume (other people's decisions from the same tick are
kept). A timer presses Play again when the limit lifts (+2 s; +1 min for the plan); when the
provider didn't say, an API limit waits for Play and the plan is retried after 30 minutes. Play
clears it sooner. The timer doesn't survive a helper restart (the world stays paused).

**Choosing brains** (`apps/web/src/components/BrainsModal.tsx`): one dialog for both a new world
and a running one. Before creating, `/api/cast-preview` returns the starting villagers (same seed
and cast option → same people in the same order; AI flesh-out never changes names), the owner picks
a brain per person or in bulk, and `POST /api/worlds` takes `brains` (in cast order) and
`defaultBrain`. In a world, `GET /api/worlds/:id/brains` sums `llm_calls` per person (calls, tokens
in/out, cost) and the dialog polls it every 3 s; bulk changes are one `set_brains` input.

## API

| Method | Path                                        | Result                                                             |
| ------ | ------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/health`                               | `{ ok, version }`                                                  |
| GET    | `/api/worlds`                               | `{ worlds, activeWorldId }`                                        |
| POST   | `/api/cast-preview`                         | `{ seed?, cast }` → `{ seed, people }` (who a new world will have) |
| POST   | `/api/worlds`                               | create `{ name, seed?, mapSize?, cast?, brains?, defaultBrain? }`  |
| POST   | `/api/worlds/:id/activate`                  | make it the active (running) world                                 |
| GET    | `/api/worlds/:id/view`                      | `{ meta, settings, map, tick, runner, agents, resources, owners }` |
| POST   | `/api/worlds/:id/control`                   | `{ running?, speed? }`                                             |
| GET    | `/api/worlds/:id/events`                    | `?limit&beforeId&agentId&minImportance&q&atOrBeforeTick`           |
| GET    | `/api/worlds/:id/agents/:agentId`           | inspector detail                                                   |
| PUT    | `/api/worlds/:id/agents/:agentId/brain`     | set a person's brain                                               |
| GET    | `/api/worlds/:id/brains`                    | everyone's brain + AI usage, village totals, default brain         |
| PUT    | `/api/worlds/:id/brains`                    | `{ agentIds, brain }`: same brain for many people (one input)      |
| GET    | `/api/worlds/:id/agents/:agentId/calls`     | recent AI exchanges                                                |
| GET    | `/api/worlds/:id/family/:agentId`           | family tree                                                        |
| PUT    | `/api/worlds/:id/default-brain`             | `{ brain, applyToAll }`                                            |
| PUT    | `/api/worlds/:id/cap`                       | `{ capUsd }`                                                       |
| PUT    | `/api/worlds/:id/aging`                     | `{ daysPerYear }`                                                  |
| GET    | `/api/worlds/:id/market`                    | `{ stock, quotes, moneySupply }`                                   |
| GET    | `/api/worlds/:id/village`                   | leader, purse, levy, rules, meetings, stalls, pens, fields, jobs   |
| POST   | `/api/worlds/:id/spawn`                     | `{ description, name?, sex?, age? }` → `{ agentId }`               |
| POST   | `/api/worlds/:id/world-event`               | `{ kind, intensity?, hours?, targetId? }`                          |
| GET    | `/api/worlds/:id/agents/:agentId/story`     | `{ entries }`: their events + diary/chapters, oldest first         |
| GET    | `/api/worlds/:id/objects/:objectId/history` | `?tick` → a map object's history (`ObjectHistoryResponse`)         |
| GET    | `/api/worlds/:id/replay`                    | `?tick&mapVersion` → the world then (map only if it differs)       |
| GET    | `/api/worlds/:id/replay/agents/:agentId`    | `?tick` → a person as they were then                               |
| DELETE | `/api/worlds/:id`                           | delete permanently                                                 |
| GET    | `/api/settings`                             | providers (no keys), prices, data folder                           |
| PUT    | `/api/settings/providers/:id`               | `{ apiKey?, baseUrl?, defaultModel?, cliPath? }`                   |
| POST   | `/api/settings/providers/claude_plan/check` | re-check Claude Code is installed and signed in                    |
| PUT    | `/api/settings/prices`                      | `{ model: { input, output } \| null }`                             |
| GET    | `/api/providers/:id/models`                 | model list (doubles as a connection test)                          |

WebSocket `/ws` pushes `hello`, `worlds_changed`, `frame` (tick, runner status incl. spending,
agent views, changed resources, map version, active conditions, calendar) and `events`. There is deliberately no endpoint that
sets an agent's state or decisions; changing someone's brain changes how they think, not what they
decide.

## Tests and CI

Vitest runs unit tests beside the code and integration tests in `apps/server` (the real helper on
a real port over HTTP + WebSocket; exact resume and replay; mock-brain village life). Playwright
drives the built UI (`tests/e2e`). GitHub Actions (`.github/workflows/ci.yml`):
typecheck, lint and Vitest on Ubuntu and macOS, a small `npm run stress` smoke run (fails if fewer
than half survive), then Playwright on Ubuntu with the report uploaded on failure. CI installs Node 24
with `actions/setup-node` (version from `.nvmrc`). No AI provider
is ever called in tests: everything uses the Mock brain or a fake HTTP server.
The AI-driven suite (`tests/agentic`, Tester Army's `e2e` runner, Node 24.8+) is the one exception:
its tests drive the real helper and browser with Claude Haiku 5.5 when `ANTHROPIC_API_KEY` or
`OPENROUTER_API_KEY` is set, and are skipped without either. With `ANTHROPIC_API_KEY` it calls
Anthropic directly; with `OPENROUTER_API_KEY` it goes through OpenRouter (default
`anthropic/claude-haiku-5.5`). If both are set Anthropic wins unless `E2E_PROVIDER=openrouter`;
`E2E_MODEL` sets the model id for whichever provider is used. Its no-AI test always runs. In CI, a
separate `agentic` job runs it after `check`; the replay cache is git-ignored, so CI starts without
one and only reads it, and `tests/agentic/.e2e/` is uploaded on failure.

## Rendering (`apps/web/src/map/`)

- `pixelArt.ts` paints every sprite in code (16 px tiles) into one atlas; people get a sprite strip
  (down/up/side × 2 walk frames) painted from their own colours, with an outline.
- `renderer.ts` (PixiJS v8): ground in 32×32-tile chunks with cull areas; objects and people in one
  depth-sorted layer; people tween between frames; children drawn smaller; sleepers lie down;
  nobody is ever hidden: a house with someone inside is drawn cut away (roof off, `house_open*`; other buildings turn see-through) and its occupants stand on distinct spots in the room (`layout.ts` `interiorSpots`, sorted by id); sprites in front of a person (roofs, tree canopies) fade to 40% via a per-tile object grid; the dead become gravestones; half-built houses fade in; speech
  bubbles (laid out together each frame by `layoutBubbles` so none overlap, tails pointing at the speaker), name labels and "z z"/"…" in a screen-space overlay; night tint; follow mode. Weather:
  storms darken the map and draw falling rain (screen space); droughts give a hot, bleached tint;
  burning buildings get flickering flames and smoke; ruins are drawn blackened; the sick look pale
  green; winter frosts the land and autumn warms it. It animates only while something moves (or
  burns, or rains). In replay mode it is fed the replayed moment instead of live frames.
- `camera.ts`: pure camera maths (tested).
