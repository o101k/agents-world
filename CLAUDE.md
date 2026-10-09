# Agents World — project context for Claude

Browser-based 2D life simulation where every human is an independent AI agent. This file holds
the original brief, every decision made with the owner, the agreed architecture and the phased
roadmap. **Keep it updated whenever a decision changes** (add to the Decision log at the bottom).

- Technical design of what's built so far: [`docs/DESIGN.md`](docs/DESIGN.md) (update as we go)
- How to run: [`README.md`](README.md)

## How we work (from the owner)

1. Build phase by phase, committing and pushing at the end of each phase. **Don't stop between
   phases and don't ask questions** (owner instruction, 2026-09-27): make sensible decisions,
   record them in the Decision log, and keep going.
2. Keep the README (how to run) and `docs/DESIGN.md` (short design doc) up to date.
3. Keep this file updated whenever a decision changes.
4. Development branch: `claude/life-sim-architecture-dd85a8`. Don't open PRs unless asked.
5. The owner runs on **macOS**. Development happens in a cloud container using the Mock brain
   and headless Chromium; real AI providers are tested on the owner's Mac. Never ask for or
   handle the owner's API keys in chat.

## Current status

| Phase                         | Status |
| ----------------------------- | ------ |
| 0 – Skeleton                  | Done   |
| 1 – A world that runs (no AI) | Done   |
| 2 – Minds                     | Done   |
| 3 – Work, trade, money        | Done   |
| 4 – Life cycle                | Done   |
| 5 – A long life               | Done   |
| 6 – Replay and scale          | Done   |

## Commands

```bash
npm install          # once
npm start            # build UI, start helper, open browser (http://127.0.0.1:4747)
npm run dev          # hot-reload dev mode (UI at http://localhost:5173)
npm run check        # typecheck + lint + unit/integration tests — run before every commit

npm test             # Vitest unit and integration tests
npm run test:e2e     # Playwright end-to-end (in this container: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium)
npm run test:agentic # Tester Army e2e, AI-driven (AI steps need ANTHROPIC_API_KEY or OPENROUTER_API_KEY; skipped without)
npm run stress       # headless big-village stress test (args: adults children days mapSize)
npm run bench:render # map rendering benchmark in headless Chromium (250 people, huge map; --json, --shots)
```

Data lives in `~/.agents-world/` (override with `AGENTS_WORLD_HOME`). Port override: `AW_PORT`.

## Code rules (enforced by ESLint where possible)

- `packages/sim` is **pure and deterministic**: no `Math.random`, `Date`, I/O, or AI. All randomness
  goes through the seeded `Rng`. Same state + same inputs ⇒ same result. This is what makes exact
  resume and replay possible.
- `packages/brain` (Phase 2) never sees world state — only what one agent perceives and remembers.
- `apps/web` imports only `@aw/shared`; it talks to the helper via HTTP + WebSocket.
- The browser has **no command that sets an agent's state or decision**. Observer commands are
  limited to: time controls, world events, spawning agents, and model settings.
- Match surrounding style; Prettier + ESLint; tests with Vitest (`*.test.ts` beside the code).

---

## The original brief (verbatim)

> I want to build a browser-based 2D life simulation game. Before writing any code, read this brief, ask me any clarifying questions, then propose an architecture and a phased build plan for my approval. You choose the tech stack and frameworks, but explain your choices briefly and favor ones that will scale to bigger worlds later.
>
> ### The concept
>
> A world populated by humans, where each human is an independent AI agent with its own "brain" (an LLM). I set up the starting conditions, then I cannot control what anyone does. They're born, grow up, learn, work, trade, form relationships, have children, and die. I watch it unfold.
>
> ### POC scope
>
> - 10–20 humans in the first world, but the design must not assume a small population.
> - The POC is a foundation to build on, not a throwaway. Keep the simulation logic, AI layer, and UI cleanly separated.
>
> ### Agents
>
> - Each agent can use a different AI model and provider. Build a provider-agnostic layer so I can plug in Claude, OpenAI, local models, etc., and pick the model and effort/cost level per agent. Newborns get a world-level default model that I can change.
> - I manage my own API keys and costs. Keys stay on my machine only.
> - Every agent has: name, age, personality, background, needs, memories, relationships, skills, money, and possessions.
> - Agents should only know what they've experienced or been told. No omniscience.
>
> ### Life cycle
>
> - The world starts with a mix: a few adults I describe in detail, plus some babies.
> - Babies are genuinely limited (can't work, limited speech, dependent on caretakers) and gain abilities as they age.
> - They learn both from their own experiences and from parents and others around them, so what adults teach matters.
> - Adults can pair up and have children. Agents age and eventually die. Children inherit something from their parents (define what, and propose it to me).
> - Memories must stay manageable over a long life. Propose how agents remember and forget.
>
> ### World and survival
>
> - Agents have survival needs: food, water, shelter, sleep. Neglecting them has consequences, including death.
> - There are jobs, trade, and money. Resources come from the world and must be gathered, produced, or bought.
> - Time runs in ticks. I control play, pause, and speed.
>
> ### My role (observer with limited powers)
>
> - I can watch everything and inspect any agent's mind: current thoughts, goals, memories, relationships, needs, money, and family tree.
> - I can trigger world events (drought, storm, disease, etc.).
> - I can spawn a new agent with a custom description at any time, outside the normal birth process.
> - I cannot directly command or edit any agent's decisions.
>
> ### UI
>
> - Top-down 2D pixel/tile world where I can clearly see individual people, objects, and their colors.
> - Click any person or object to see details.
> - A live event log / timeline of what's happening, plus a way to follow a specific person.
> - Controls for time, world events, spawning agents, and per-agent model settings.
>
> ### Persistence
>
> - Everything is stored locally on my laptop. No cloud, no accounts.
> - I must be able to close the browser, shut down my laptop, and resume the same world exactly where it left off the next day.
> - I can have multiple completely independent worlds, each saved separately, with a way to create, switch between, and delete them.
> - Keep a history so I can replay or review what happened in a world.
> - If a small local helper process is needed (for example, to call AI providers), it must run on my laptop only.
>
> ### How I want you to work
>
> 1. Treat this first session as planning only: do not create or edit any files until I approve the plan.
> 2. Ask me your clarifying questions first.
> 3. Propose the architecture and a phased roadmap where each phase ends with something I can run and see. Get my approval.
> 4. Once I approve, save this brief plus the agreed plan and decisions into the repo as CLAUDE.md, so every future session starts with the full context. Keep it updated whenever we change a decision.
> 5. Build phase by phase, and stop at the end of each phase so I can test it.
> 6. Keep a README with how to run the project and a short design doc that you update as we go.

---

## Owner decisions (answers to the clarifying questions)

| Topic                  | Decision                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How it runs            | `npm start` launches a **local helper process** (Node) that runs the simulation, saves worlds, holds keys and calls AI providers; the browser is only the viewer/controller. |
| Owner's OS             | macOS                                                                                                                                                                        |
| AI providers first     | Anthropic (Claude), OpenAI, OpenRouter / other OpenAI-compatible APIs — plus a free offline **Mock brain** (always).                                                         |
| Lifespan / aging speed | **An adjustable aging slider** (in-game days per year), changeable any time.                                                                                                 |
| AI vs rules            | **AI from birth**: the AI decides intentions; a rule-based body executes steps. Babies call their AI from day one, limited by developmental stage.                           |
| Slow AI                | **World waits**: a tick completes only when due decisions are back (with a timeout → agent continues current plan and is asked again).                                       |
| Budget                 | **Very low.** Cheapest models by default, sparse decision points, caching, hard cap.                                                                                         |
| Tab closed             | **Keep living**: the active world runs while the helper runs, until paused or the cap is hit.                                                                                |
| Spending cap reached   | **Pause the world** and show a notice (raise the cap or switch models).                                                                                                      |
| Setting                | **Pre-industrial village**: farms, well, river, forest, bakery, workshop, market.                                                                                            |
| Economy bootstrap      | **Land + town market**: anyone can work land/resources; one non-agent town market buys/sells basic goods at supply-and-demand prices. Everything else is agent-driven.       |
| Darkness               | **Unrestricted**: lying, theft, fights, cheating, and violent death are possible. Having children stays off-screen and needs both partners' consent.                         |
| Long-term scale        | **~100–200 agents** (POC 10–20).                                                                                                                                             |
| Art                    | Free tileset + per-person colour tinting. (See Decision log: procedural pixel art for now.)                                                                                  |
| Starting cast          | **Chosen per world** from three options: sample cast, write your own, or AI-generated from a seed + knobs.                                                                   |
| Replay                 | **Timeline now, map replay later**: searchable timeline + life stories first; scrub-the-map replay in Phase 6. Storage records everything from day one.                      |
| Worlds                 | One world runs at a time; the others stay saved.                                                                                                                             |
| Language               | English.                                                                                                                                                                     |

---

## Agreed architecture

```
Browser (the viewer)                        Local helper process (Node, on the Mac only)
┌────────────────────────┐   WebSocket   ┌──────────────────────────────────────────────┐
│ Map (PixiJS)           │◄──localhost──►│ World manager: create / switch / delete      │
│ Panels (React):        │     only      │ Tick loop ─► SIMULATION (world rules only)   │
│  inspector, log,       │               │               │ "Agent X needs to decide"    │
│  controls, settings    │               │               ▼                              │
└────────────────────────┘               │             BRAIN (AI layer) ─► Anthropic /  │
                                         │               │ intended action   OpenAI /   │
                                         │               ▼                   OpenRouter │
                                         │ One SQLite database file per world           │
                                         └──────────────────────────────────────────────┘
```

| Part                       | Job                                                                            | Knows nothing about                                   |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `packages/shared`          | Shared types and message formats                                               | —                                                     |
| `packages/sim`             | World rules: time, map, needs, actions, economy, births/deaths. Deterministic. | AI, storage, UI                                       |
| `packages/brain` (Phase 2) | Provider adapters, prompts, memory, request queue, cost tracking               | World state (sees only one agent's senses + memories) |
| `apps/server`              | Local helper: tick loop, saving, keys, talks to browser                        | —                                                     |
| `apps/web`                 | UI                                                                             | Keys, AI, rules                                       |

**Tech stack:** TypeScript everywhere · Node.js 24 LTS helper with Fastify + WebSocket, loopback only ·
SQLite (better-sqlite3), one file per world · PixiJS map + React panels (Vite) · official SDKs
`@anthropic-ai/sdk` and `openai` (the latter also for OpenRouter/compatible via base URL) · Zod ·
Vitest + Playwright · npm workspaces + Turborepo.

**Storage:** `~/.agents-world/secrets.json` (keys, user-only permissions; env vars also work) and
`~/.agents-world/worlds/<id>.sqlite`.

### Time and speed

- 1 tick = 1 in-game minute; 1,440 ticks/day. Walking = 1 tile/tick; the map animates between ticks.
- Speed slider = target ticks/second. The UI shows actual vs target speed (AI latency limits top speed).
- Aging slider = in-game days per year (default 4). Age accumulates tick by tick, so changing the
  slider never breaks ages. Needs follow in-game hours; growing up follows age.
- World waits for due decisions (timeout → continue current plan, re-ask later).
- Keep living with the tab closed. One active world at a time.

### Agents and brains

- The AI decides (thought, goal, plan for the next few hours, speech, action); the body executes
  (pathfinding, timing, bookkeeping). AI is called at **decision points**: waking up, plan step
  done/failed, urgent need, spoken to, surprise, maximum-quiet-time check-in.
- The sim validates every action; invalid actions fail and the agent remembers the failure.
- Actions: move, gather, eat, drink, sleep, craft, work, buy/sell, offer trade, give, lend, talk,
  teach, care for child, propose partnership, try for a child, build, steal, attack, explore.
  Injury and killing are possible; consequences are social at first (witnesses remember,
  reputation spreads by gossip).
- **Babies: AI from birth, genuinely limited.** Stage-specific instructions and action lists:
  0–1 cry/coo/look/reach/sleep · 1–3 toddle, first words · 3–12 play, chores, learning ·
  13–17 apprentice work · 18+ everything. Language is a skill both ways: what a baby says is cut
  down to words it knows; speech it hears is partly garbled by comprehension
  ("[warm voice] …milk… good…"). Babies think rarely with tiny prompts.
- **No omniscience:** perception within vision/hearing radius (less indoors/at night); names learned
  only on introduction; places learned by visiting or being told; what they're told is a belief
  (others can lie).
- **Model + effort per agent:** Frugal (default) / Standard / Deep — sets model tier, reasoning
  effort, memories per prompt, thinking frequency, reflection depth. World default for newborns;
  per-agent override.
- **Providers:** Anthropic, OpenAI, OpenAI-compatible (OpenRouter etc.), Mock. Request queue with
  per-provider concurrency, backoff, priorities (conversation replies first), structured JSON
  output with one repair-and-retry; a refusal = the agent hesitates this turn (logged).
- **Cost:** provider-reported tokens × an editable price table; per agent, per world, live $/hour.
  Per-world spending cap (default $1, editable); hitting it pauses the world. Cost levers: prompt
  caching of stable prefixes, multi-hour plans, conversation turn limits, one reflection/agent/day.

### Memory: remembering and forgetting

1. Working memory: the last few in-game hours, always in the prompt.
2. Memory stream: text, time, place, people, emotion, importance (rated by the AI while deciding,
   no extra call), source ("I saw it" / "Mom told me"), strength.
3. Recall: top memories by recency + importance + relevance (people present, place, current goal).
   Entity/keyword matching first; embeddings can plug in later behind the same interface.
4. Sleep consolidation: one cheap AI call per night → short diary entry, new/updated beliefs,
   updated opinions of people.
5. Forgetting: strength decays unless important or recalled; forgotten memories leave the agent's
   mind but stay in world history (shown greyed out to the observer).
6. Compression and limits: days roll up into "life chapters" (seasons → years); core memories
   (births, deaths, marriages) last for life; hard cap ≈500 active memories per agent; memories
   from the first ~3 years mostly fade, surviving as leanings in personality/attachment.
7. Knowledge and skills are kept separately (prices, where people live, recipes, skill levels);
   updated/corrected rather than fading.

### Inheritance

| Genetic (at conception)                                                                                              | From family (social)                                                 | Not inherited                               |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Appearance: skin, hair, eye colour, height (drives sprite tinting)                                                   | Family name — parents' AIs agree; parents **choose the baby's name** | Memories                                    |
| Learning speed per skill group (physical, craft, social, intellectual): parents' average + randomness                | Home and household                                                   | Skill levels (only learning speed)          |
| Personality baseline (Big Five): parents' average pulled slightly to town average; upbringing shifts it in childhood | Estate at death: declared will, else partner, then children equally  | Relationships (start with family ties only) |
| Constitution: base health, disease resistance, small lifespan adjustment                                             | Culture: whatever parents and others teach and tell them             |                                             |

Reproduction: partnership needs both to agree; conception needs both to agree to "try for a child",
a male/female pair, fertile ages and good health; pregnancy ≈0.75 years; orphans can be adopted.
Learning: by doing, by watching someone nearby, and by being taught (better with a more skilled
teacher and a closer relationship).

### World and survival

- Map: seeded village — river, forest, fields, well, market, houses, bakery, workshop, dock.
  POC ≈64×64 tiles, stored/rendered in 32×32 chunks for bigger maps later.
- Needs: hunger, thirst, energy, warmth/shelter drive health; health 0 = death (cause recorded).
  Comfort/social needs later.
- Resources regrow (berries, trees, fish, crops). Chains: wheat → flour → bread; wood → planks → house.
  Crafted quality depends on skill.
- Economy: anyone works the land; town market with supply/demand prices; agents hire, trade, give,
  lend; homes and plots are owned.
- Observer world events: drought, storm, disease (spreads by proximity; agents feel symptoms),
  fire, bumper harvest, a stranger arriving — each with intensity, duration, area.

### Saving, resuming and history

- Each tick's inputs (AI decisions with full prompt/reply, observer commands) are logged in one
  transaction; readable events go to a searchable events table.
- Full snapshot every in-game hour and on pause/exit.
- Resume = latest snapshot + deterministic re-run of logged inputs → exactly the last saved tick,
  even after a sudden shutdown. Pending AI requests are simply re-asked.
- Replay uses the same mechanism (no new AI calls).
- New world: choose the starting cast (sample / write your own / AI-generated).

---

## Roadmap (each phase ends with something runnable)

| Phase                                | What gets built                                                                                                                                                                                                                                                                             | What the owner sees                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **0 – Skeleton** ✅                  | Repo setup; `npm start` launches helper + opens browser; worlds screen (create/switch/delete); generated village map; pan/zoom; CLAUDE.md, README, DESIGN.md                                                                                                                                | Make two worlds with different maps, delete one                                    |
| **1 – A world that runs (no AI)** ✅ | Ticks, clock, day/night, needs, health and death, gather/eat/drink/sleep, Mock brains, play/pause/speed, click agents/objects for details, live event log, follow a person, exact save and resume                                                                                           | Villagers survive (or don't) on autopilot; stop and restart the helper → same tick |
| **2 – Minds** ✅                     | Provider layer + key settings, per-agent model/effort + world default, request queue, world waits, cost tracking + cap, perception limits, thoughts/goals/plans, memory stream + recall, conversations + overhearing, mind inspector (incl. raw prompt/reply), spawn agent from description | Real AI villagers plan, talk, remember; read their minds; watch spending           |
| **3 – Work, trade, money** ✅        | Skills, crafting chains, jobs and hiring, town market, trade/gifts/loans, ownership, theft and fights, reputation via gossip                                                                                                                                                                | An economy emerges: prices, jobs, crime                                            |
| **4 – Life cycle** ✅                | Aging slider, life stages, AI-from-birth babies with developmental limits, caretaking, teaching, relationships, partnering, conception/pregnancy/birth, genetics, estates/wills, old-age death, family tree, three starting-cast options                                                    | A couple has a baby that learns to talk from them                                  |
| **5 – A long life** ✅               | Forgetting + nightly consolidation, life chapters, childhood memory fading, world events, timeline search, per-agent life story                                                                                                                                                             | Several generations with bounded memory; trigger a drought                         |
| **6 – Replay and scale** ✅          | Map scrubbing to any past moment, 100–200 agents on bigger maps, seasons, polish                                                                                                                                                                                                            | Scrub back to day 12; ~150-person stress test                                      |

### Known risks

- Budget tension: AI from birth + keep-living + very-low budget → the cap is the safety net.
- Unrestricted content: some models soften/refuse violent actions (OpenRouter offers more permissive models).
- Real providers can only be tested on the owner's Mac.

---

## Decision log

Newest first. Record every change to an agreed decision here.

- **2026-10-09 — Faster map rendering (owner request).** Measured first with a new benchmark,
  `npm run bench:render` (`tests/perf/bench-render.mjs`: 150 adults + 100 children on the huge map,
  headless Chromium; its frames per second are meaningless because it draws in software, so
  compare JavaScript time per frame and per map update). The renderer is split into layers
  (`ground.ts`, `objectLayer.ts`, `people.ts`; `renderer.ts` keeps scene, camera, input, effects).
  Map changes no longer rebuild the scene: ground chunks are painted onto canvases and only
  changed chunks repainted; map objects are diffed by id and look; the page fetches only the map
  (`GET /api/worlds/:id/map`), one request at a time. Per frame: camera input only moves the
  camera and the work runs once per animation frame; ground, world and overlay are separate Pixi
  render groups; people's depth is their tile row (exact against objects, which sit on row
  boundaries; two walkers in one row may overlap in either order); each layer culls itself
  (Pixi's culler and pointer events are off); people off screen skip labels and bubbles. The
  people list and timeline re-render only changed rows. Screenshots at the same tick and camera
  match the old renderer (walking-frame timing aside). Planned in
  `/mnt/project-files/plans/faster-rendering.md`; ground, objects, lists and map fetch built by
  Haiku workers in parallel, reviewed and integrated by Opus.
- **2026-10-09 — Crash fix:** clearing land for a field or building no longer crashes the helper when
  someone is gathering from or chopping a bush or tree that the clearing removed; they fail the
  action and remember why.

- **2026-10-08 — Opus as the Claude Code advisor (owner request).** `.claude/settings.json` (project
  settings, committed) sets `"advisorModel": "opus"`, so Claude Code sessions in this repo consult
  Opus through the advisor tool.

- **2026-10-08 — AI-driven tests with Tester Army e2e (owner request).** New workspace package
  `tests/agentic` (`@aw/agentic-tests`) runs Tester Army's open-source `e2e` runner (pinned exactly:
  `e2e` 0.18.0, `@e2e-dev/web` 0.13.0; pre-1.0). Tests are `tests/agentic/*.e2e.ts`: locators with
  `expect` (no AI), `agent.act` (an AI drives the browser; recorded clicks replay from
  `tests/agentic/.e2e/cache/` without a model call until the UI changes), and `agent.assert` /
  `agent.extract` (always a live AI call). `worlds.e2e.ts` is no-AI; `villagers.e2e.ts` is AI.
  The model is Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10/$0.50 per million tokens) via the Vercel
  AI SDK, read from `ANTHROPIC_API_KEY` (`E2E_MODEL` overrides it). e2e doesn't use the keys saved in
  Agents World's settings and can't use a Claude Pro/Max plan. Without the key the AI tests are
  skipped and the no-AI test runs. e2e's telemetry is off (`E2E_TELEMETRY_DISABLED=1` in the package
  scripts). e2e needs Node 24.8+, which `.nvmrc` gives. Run it with `npm run test:agentic`; results
  go to `tests/agentic/.e2e/` (git-ignored). CI: a new `agentic` job after `check` always runs the
  no-AI test, and the AI tests run only when the repository has an `ANTHROPIC_API_KEY` or
  `OPENROUTER_API_KEY` secret (not for forks). In CI e2e retries once and only reads the replay
  cache. The replay cache stays git-ignored for now: committing it would let CI replay clicks
  without model calls (asserts still call the model). The AI tests haven't run with a real key
  yet; the owner runs them on his Mac. **OpenRouter too (owner request, same day):** an
  `OPENROUTER_API_KEY` works instead of the Anthropic key, through `@openrouter/ai-sdk-provider`,
  default model `anthropic/claude-haiku-5.5` (inferred from OpenRouter's naming; openrouter.ai is
  blocked from the dev container, so the id is unchecked). Anthropic wins when both keys are set
  unless `E2E_PROVIDER=openrouter`; `E2E_MODEL` sets the model for either.

- **2026-10-08 — Back to npm and Node, keep Turborepo (owner request).** Tester Army's `e2e`
  test runner (https://tester.army/e2e) only runs on Node.js 24.8+: its TypeScript loader needs
  `module.registerHooks`, which Bun lacks. The owner chose one runtime: "revert the bun changes and
  make it npm node again, but keep the mono repo and turborepo". Back to npm and Node 24:
  `package-lock.json` (npm 11, bundled with Node 24), `.nvmrc` pinned to 24.21.0, `tsx` runs the
  helper and scripts, `cross-env` sets dev variables, `allowScripts` (better-sqlite3 and esbuild
  run their install scripts, fsevents denied) instead of `trustedDependencies`, and CI uses
  `actions/setup-node` from `.nvmrc`. Bun's `bun.lock`, `bunfig.toml` and Bun-only scripts are gone.
  What stays: Turborepo (`turbo.json`) runs the tasks: per-package typecheck, the web build and dev;
  ESLint and Vitest stay single runs over the whole repo; `npm run check` (`turbo run typecheck lint
  test`) caches, so an unchanged re-run is near-instant; `npm run dev` is `turbo run dev` (server via
  `tsx watch`, web via Vite); Turborepo's env mode is loose so `AW_PORT` and API-key variables reach
  dev. `concurrently` stays out. This replaces the Bun half of the 2026-10-08 "Bun and Turborepo"
  entry below, whose Turborepo notes still stand.

- **2026-10-08 — Bun and Turborepo (owner request).** Bun replaces npm and Node: it installs
  packages (`bun.lock`, with npm-style hoisted `node_modules` as before), runs the scripts, the
  helper, the tests (Vitest on Bun) and the tools. `tsx`, `cross-env` and `concurrently` are gone,
  and so is the Node pin (`.nvmrc`); Bun is pinned by `packageManager` in `package.json` and
  `bunfig.toml` makes the root tools run on Bun. This replaces "Node 24 LTS, pinned" (2026-10-03)
  and the 2026-10-07 note that Bun was rejected. Turborepo (`turbo.json`) runs the tasks: per-package
  typecheck, the web build and dev; ESLint and Vitest stay single runs over the whole repo (splitting
  Vitest per package overloaded the CPU and timed out a slow test); `bun run check` caches, so an
  unchanged re-run takes well under a second. Turborepo's env mode is loose so `AW_PORT` and API-key
  variables still reach `bun run dev`. Our tests are `bun run test`; `bun test` is Bun's own runner.
  Real AI providers, the Claude subscription route (the helper launches `claude` from Bun) and
  auto-opening the browser are untested on the owner's Mac.

- **2026-10-07 — Growing the village (owner request).** Seven new kinds of work, planned in
  [`docs/plans/growing-the-village.md`](docs/plans/growing-the-village.md) and built in parallel
  (one sim module + one mock-brain file each, after shared groundwork wired every action into the
  engine, perception, prompt and decide tool): (1) `clear_field` / `sow`: fields of one's own
  near home, at most 2 per person, owned with the partner; owners notice crop takers. (2) `build
  {building}`: house, bakery, workshop, well (stone), animal pen, market stall; `build_house`
  stays as the house shortcut. Spare stone in at least half the stretches makes a stone building
  that fire can't burn. (3) `quarry`: stone from rocks. (4) `tend_animals`: hens and sheep bought
  at the market live in pens (eggs, wool; neglect loses them, care breeds them); wool → warm
  clothes that cut the night cold by 40% and wear out. (5) Own market stalls at one's own prices.
  (6) `hire` / `respond_job` / `end_job`: daily wages paid at 20:00, no enforcement beyond trust.
  (7) `call_meeting` / `propose_rule` / `vote` / `pay_from_treasury`: meetings at the market; a
  rule passes with more yes than no and at least 2 yes; rules may set a daily levy into a village
  purse or elect a leader who alone spends it. People learn rules from the market's notice board.
  No courts or enforcement: rules are social, as theft already is. World state v9. Fire can now
  also burn pens and stalls (never stone buildings). The observer gets a **Village** section in
  the World tab. Found in review: villagers never saw their own skill levels, so they tried to
  build without the skill and failed (a paid call each time); the prompt now lists their skills
  (0–100) and the skill a new building needs. The Mock brain gives each feature its own roll (rare
  ones like meetings were swallowed by small talk) and only starts a building it has the skill
  for and can pay for to the end, so none are left half-built. In 8-day mock runs of 16 people
  each village now builds a stall or pen, hires, and sometimes holds a meeting; deaths unchanged.
  New fields, buildings, pens, stalls and quarried rocks get object histories like everything else.

- **2026-10-07 — Every map object has a history (owner request).** Clicking a house, bush, tree,
  field, the well, a workshop… shows whether it was there when the village was founded or who
  built it, then its lasting changes (built, burnt, rebuilt, inherited, someone moving in, births
  and deaths of the people living there), how often it was used and by whom most, and its latest
  uses. Events now carry the ids of the objects they're about (`WorldEvent.objects`, the last
  argument of the sim's `emit`), indexed per world file; new kinds of object get a history by
  passing their id. Building work now logs each stretch ("worked on House 3 (40% done)", importance
  2), and a partner moving in is named in the `partnered` event. Worlds made before this keep
  their building and fire history (matched by name); their day-to-day use is recorded from the
  upgrade on. Object ids must never be reused within a world.

- **2026-10-07 — Claude-plan calls show their real cost (owner request).** Calls on the Claude
  subscription were recorded at $0. They now carry the price Claude Code reports for each call
  (`total_cost_usd`, its estimate at API prices), and their tokens come from its per-model
  `modelUsage` (the top-level `usage` misses helper calls). That cost shows per call, per person,
  in the Brains dialog totals and on the spending meter, marked as covered by the plan
  (`planUsd` is the plan's share). The owner chose to **count it toward the spending cap** (this
  replaces "plan calls cost $0 against the cap" from 2026-10-03), so the cap now also limits how
  much plan usage a world takes; raise it to let a plan village run longer. Plan calls that ran
  but gave no answer are counted too. Plan calls made before this change stay at $0.

- **2026-10-07 — Typecheck with the native TypeScript compiler (owner request).** `npm run typecheck`
  runs `tsgo` (TypeScript 7 native preview, pinned to an exact version) instead of `tsc`, about 5×
  faster (11.6 s → 2.1 s for all five projects). `typescript` 6 stays for ESLint, Vite and editors.
  Bun was measured and rejected: only install and helper start got faster; typecheck, tests and sim
  speed were about the same. If tsgo misbehaves, switch the five `typecheck` scripts back to `tsc`.

- **2026-10-06 — Nobody is ever hidden (owner request).** (a) Outdoors there is one person per
  tile, enforced by the engine (not just drawn apart): lines of walkers move up together, people
  passing swap places, idlers step aside, others are routed round and finally squeezed past, and
  a separation pass at the end of every tick fixes anything else (two people leaving one door,
  spawns, old saves). People indoors don't take room. Crowds now cost time: in the 250-person
  stress town deaths over three days went from about 11 to about 22 across five seeds (most in
  one seed whose only water is a narrow riverbank); 150-person and smaller villages are
  unchanged. (b) A house with someone inside is drawn cut away, with its occupants on distinct
  spots in the room (sleepers lying down); other buildings turn see-through. Roofs and tree
  canopies in front of a person fade. (c) Speech bubbles are laid out together each frame so they
  never overlap, each with a tail pointing at its speaker. (d) `findPathToAny` no longer returns
  the start object itself as a path (it could have made a saved walk refer to the person).

- **2026-10-06 — Rate limits from any provider pause the world (owner request).** A 429 or used-up
  quota from the Anthropic, OpenAI or OpenAI-compatible API (and the Claude subscription's plan
  limit, as before) pauses time with a banner and a timeline entry naming the person, provider,
  model, HTTP status, which limit, retry-after and the provider's message. Time resumes by itself
  when the provider said when the limit lifts (retry-after or a reset header); otherwise an API
  limit waits for Play (the subscription keeps its 30-minute retry). The decision that hit the
  limit is asked again on resume instead of the person carrying on with their old plan. The SDKs
  no longer retry 429s themselves, so a limit is never hidden behind a decision timeout.

- **2026-10-06 — Pick brains when creating a world, and a brains dialog in the world (owner
  request).** New worlds no longer start everyone on the Mock brain without asking: after the form,
  **Next: choose brains** shows the starting villagers (previewed by the helper from the seed and
  cast option, so it matches what gets created) and the owner sets a brain per person or in bulk
  (select all / adults / children), plus the default for newborns and spawns. Everyone starts on
  the first configured provider (frugal, provider's default model), else Mock. The same dialog
  opens in a world from **🧠 Brains**, adding each person's AI calls, tokens in/out and cost, and
  village totals (from the `llm_calls` log, refreshed every 3 s; the dead are hidden but counted).
  Bulk changes are one `set_brains` input. Bug fixed on the way: babies born in the world got the
  Mock brain instead of the world's default brain; they now get the default (replays of old
  stretches follow today's rule).

- **2026-10-03 — Claude subscription as a provider (owner request).** New provider `claude_plan`:
  villagers can think on the owner's Claude Pro/Max plan (its 5-hour and weekly limits) instead of
  an API key; API keys stay as before. Anthropic forbids apps from offering claude.ai login or
  using subscription tokens, but allows running the unmodified Claude Code CLI / Agent SDK signed
  in with your own plan for your own projects (and that usage draws on plan limits). So the helper
  runs `claude -p` with structured output and all of Claude Code's tools, MCP, skills and CLAUDE.md
  switched off, and never touches the login. Model = Claude Code alias (default `haiku`) chosen in
  the usual brain editor; effort Frugal/Standard/Deep also sets Claude's effort low/medium/high.
  Plan calls cost $0 against the spending cap. A used-up limit pauses the world and auto-resumes at
  the reset time (30 min if unknown). Setup steps are in Settings and the README.

- **2026-10-03 — Node 24 LTS, pinned (owner request).** `.nvmrc` pins Node 24.21.0, the latest
  stable (LTS) release; Node 26 is still "Current" until it turns LTS. CI reads its version from
  `.nvmrc`, `engines` is `>=24` and `@types/node` follows 24. npm 11 (bundled with Node 24) only runs
  dependency install scripts listed in `allowScripts`, so `package.json` approves `better-sqlite3`
  (its build step is a no-op when a prebuilt binary fits the machine) and `esbuild`, and denies
  `fsevents` (macOS-only; it ships its binary prebuilt and has nothing to run).

- **2026-10-03 — Minimum nap.** Someone who goes to sleep by day while already rested now sleeps
  at least an hour before getting up. Before, they woke and asked for a new decision every couple
  of minutes (babies did this for about an hour every dawn), wasting AI calls: a test adult made 60
  calls in 2 hours, now 2.

- **2026-09-27 — Orphan adoption.** An orphan is anyone under 18 with no living birth or adoptive
  parent. When the last parent dies the child, the household, the child's relatives and grown-ups
  nearby are told (new `orphaned` trigger and event), and an orphan's cry reaches any adult in
  earshot. New adult action `adopt_child` (needs a home): babies and toddlers are taken in at
  once, a child of 3+ must agree (`respond_adoption`, which children and teens can do). The
  adopter's partner adopts too, so same-sex couples can now raise children. Birth parents stay
  on record (genes, family tree) and the child keeps their name; adoptive parents are listed
  separately (`adoptiveParentIds`) but otherwise count as parents: naming, crying, estates and
  the child's `mother`/`father` relationship role. The mock brain accepts most offers and a kind
  adult with a home sometimes adopts. State v8.

- **2026-09-27 — No formatting check (owner).** The owner doesn't care about formatting: CI no
  longer checks it and `format:check` is gone. `npm run format` (Prettier) stays as an optional
  tool. Lint stays in CI because it enforces code rules (deterministic sim, UI imports), not style.

- **2026-09-27 — Tests and CI (owner request).** GitHub Actions workflow `.github/workflows/ci.yml`
  on pushes to `master` and every PR (not every branch push, which ran everything twice for a
  branch with an open PR): typecheck, lint and all Vitest tests on Ubuntu and macOS
  (the owner plays on a Mac, and the SQLite driver is native), a small stress run, then Playwright
  end-to-end on Ubuntu (report uploaded on failure). New simple tests: the helper end to end over a
  real port (HTTP + WebSocket, restart and resume, replay, observer powers, the origin guard),
  shared request validation and time helpers, and the browser's world store. Tests never call a
  real AI provider. No retries on e2e, so flaky tests show up rather than hide.

- **2026-09-27 — Phase 6 details.** (a) Replay rebuilds any past tick from the nearest daily
  snapshot plus logged inputs (no AI calls, nothing written), cached so scrubbing forward is cheap.
  The live world keeps running while you replay; the map, people list, timeline (events up to
  that moment) and inspector show the past; clicking a time in the timeline jumps there. Replaying
  stretches recorded before a rules change uses today's rules (documented, not fixed). (b) Seasons
  follow the aging slider: a year of seasons = a year of age (so by default one in-game day per
  season), starting in early spring; winter nearly stops growth and makes nights ~1.8× colder,
  summer halves night cold and speeds growth. State v7 adds `calendar`. (c) Scale: a new **Huge**
  map (128×128); generated casts up to 150 adults + 100 children with unique full names; big
  villages get bigger fields, about one per six people; family links are matched within
  households. Performance work: id index for people, a tree grid, cheaper recall, overheard chatter
  between strangers kept only in working memory, ground chunks cached as textures, labels restyled
  only on change. Result: 150 people ≈ 2–3 ms/tick with the Mock brain, population stable over two
  years. (d) Bug found at scale: perception listed only the 40 nearest known places, so in a big
  village people forgot where home was and slept outside; home, owned buildings and landmarks are
  now always included (and in the prompt). (e) AI request queue: priorities (replies and
  emergencies first, night reflections last), and a request that times out while queued is
  dropped instead of being sent and paid for later. (f) `npm run stress` added for the owner's
  ~150-person test.

- **2026-09-27 — Phase 5 details.** (a) Memory strength starts at importance and each night keeps
  `0.85 + 0.014 × importance`; importance ≥ 9 (core) and life chapters never fade; memories from
  before age 3 keep 80% a night whatever they were. Below 1 a memory is forgotten (the observer
  still sees the last 100 greyed out). Recalling a memory in a decision strengthens it (+0.5). The
  active cap rises from 300 to the planned 500. (b) Reflection happens asleep at night, once per
  night, only after a day with something worth remembering (saves calls); it's a separate prompt
  and never changes the plan or wakes the person. Diary = memory of importance 6; beliefs at most 8.
  (c) "Days → seasons → years" became **days → years**: with the default 4 in-game days per year a
  day already is a season, so the nightly diary plays the season's role and the yearly chapter
  (written the first night after a birthday, from age 4) folds that year's diary in. Every entry
  is also a `reflected` event, so the history keeps them all. (d) Budget: Frugal people's nightly
  diary is written by the free rulebook; their yearly chapter uses their AI. Feeling ill is an
  instinct case too. (e) The "leanings" left by early childhood are the relationships (attachment)
  and a nightly 2% drift of a child's temperament toward the adults raising them. (f) World events
  as designed, plus: fire only targets houses, the bakery and the workshop (never the market or
  well, which keep the economy bootstrapped); burnt buildings are ruins rebuilt with `build_house`
  by an owner; fire doesn't spread in a storm. Disease numbers: 15% × intensity initially ill,
  8% × intensity per 10 minutes within 2 tiles, 30 days' immunity; nursing = new `tend` action.
  (g) New shelter rule: resting (not only sleeping) at your own door puts you indoors; visitors
  knock and the person comes out. Needed so people can sit out a storm or an illness at home.
  (h) Places a person couldn't find a way to are flagged for two days (the mock brain once starved
  walking at an unreachable bush), and someone desperately hungry or thirsty can drag themselves up
  from exhaustion (a collapse loop once killed a villager). (i) World state v6; upgrades now chain
  version by version (a v3 save previously skipped the v4 upgrade).

- **2026-09-27 — Process note.** Some scripted doc edits in Phases 1–3 silently failed after Prettier
  reformatted tables, leaving this status table and `docs/DESIGN.md` stale; both were rewritten at
  the end of Phase 4. Edits are now checked (they fail loudly if the text to replace isn't found).
- **2026-09-27 — Phase 4 details.** (a) Stages: baby < 1, toddler < 3, child < 13, teen < 18, adult
  < 60, elder. Each stage has an allowed action list enforced by the sim (babies: rest, sleep,
  babble; toddlers add walking, eating, drinking, simple gathering; children can't craft, fight or
  do adult-only things; teens can't start partnerships or families, build, or make wills).
  (b) Babies live indoors at home and must be fed (feeding covers thirst for babies); little ones cry
  when hungry and family members within earshot (or at home with them) are alerted. (c) Language
  ability rises with age (baseline ≈ 28 points per year after the first) and with speech heard;
  speech is simplified for young speakers and garbled for young listeners. (d) Relationships:
  familiarity, affection, trust, romance, family role; changed by events and by the `feelings` the
  brain reports (±3 units of 5 points). (e) Partnership: propose → respond; accepter/homeless partner
  moves in. Conception needs a mutual yes (`try_for_child` + `respond_child_request`), partners of
  opposite sex, mother 18–45 (fertility declines after 35), health; ~35% per try at best; pregnancy
  0.75 years (tracked in age-years, so the aging slider applies); ~3% of births harm the mother.
  Same-sex couples can partner but not conceive (they can adopt: see Orphan adoption). (f) Genetics: skin
  from either parent or blended, hair from a parent (5% new), temperament = parents' average pulled
  25% to the middle ± noise, aptitude and constitution averaged ± noise. Family name: the father's if
  the parents are partners, else the mother's. Babies get a name from their parents (or an automatic
  one after a day). (g) Old age: annual death risk 0.3% at 50 doubling every 8 years, divided by
  constitution. (h) Estates: will heir → partner → children (money split, goods dealt out, buildings
  co-owned) → housemates. (i) Houses: `build_house` picks a free plot near the market, 3 planks and
  an hour per stretch, ~10 stretches; map changes bump `mapVersion` so viewers reload the map.
  (j) Starting cast per world: sample (11 people), write your own (card editor), or generated from
  the seed (optionally fleshed out by the first configured AI provider). (k) Bug found and fixed:
  the decide tool's action list had silently missed the Phase 3 actions; a test now checks it
  matches the simulation's actions.
- **2026-09-27 — Phase 3 details.** (a) Fields are common land anyone may harvest; odd-numbered
  fields grow wheat, even ones vegetables. Trees give wood (4 each, regrowing 1/day). (b) Recipes:
  bread (3 wheat → 2) at the bakery, planks (2 wood → 2) and tools (3 planks → 1, building skill ≥ 15)
  at the workshop; skill ≥ 50 adds a bonus unit; carrying tools boosts gathering/chopping/fishing and
  tools occasionally break. (c) The town market prices each good by its stock (0.5×–2× base, with a
  buy/sell spread), drifts 30% back toward normal stock each day, and refuses to buy beyond 3× normal
  stock. It has unlimited coins, so money enters the economy when villagers sell. (d) Ownership:
  households own their houses, the baker the bakery and the carpenter the workshop; using someone
  else's building isn't blocked. (e) No formal employment contracts or enforced loans: hiring and
  lending happen through conversation, gifts and trade offers, and are remembered by those involved.
  (f) No police or courts: theft and violence have social consequences only (victims and witnesses
  remember, and talk). Theft success/detection and fight damage are random; a fight can kill.
  (g) Repeated failed actions make an agent pause (5 min per failure, up to an hour) before its next
  decision, so a confused AI can't burn money in a loop. (h) Building new houses moves to Phase 4,
  alongside families that need homes.
- **2026-09-27 — Phase 2 details.** (a) **Instinct:** at the Frugal effort level, routine bodily needs
  (a need dropping low, or bedtime when a plan ends) are handled by the free rulebook instead of an AI
  call; everything social, surprising or open-ended still goes to the AI. Standard/Deep send
  everything to the AI. This is the main lever for the very-low budget. (b) New worlds start on the
  free Mock brain; the owner switches people (or the world default) to an AI in the World tab. The
  suggested cheap Claude model is `claude-haiku-4-5`. (c) The spending cap is a per-world total
  (default $1), raised by hand; the world pauses before the next paid decision once it's reached, so
  the overshoot is at most one batch of simultaneous decisions. (d) Models with no known price are
  costed at a pessimistic $3/$15 per million tokens so they can't slip past the cap. (e) Decisions
  use a single `decide` tool: `tool_choice: auto` on Anthropic (forced tool choice is rejected by some
  newer Claude models) and a named function on OpenAI-style APIs; text JSON is accepted as a
  fallback; failures and refusals become a 15-minute hesitation, never a stall. (f) Prompt/reply text
  is kept for each person's 20 most recent AI calls; token counts and costs are kept for all.
  (g) Conversations: talk range 2 tiles, bystanders within 5 tiles overhear, replies stop after 6
  turns; speaking takes about a minute per 15 words. (h) Villagers of the starting cast know each other
  by name; newcomers know nobody and learn names when people speak to them. (i) The memory stream is
  capped at 300 per person (weakest dropped) until proper forgetting in Phase 5.
- **2026-09-27 — Phase 1 details.** (a) Full snapshots every 6 in-game hours (not every hour) plus
  on pause/stop; resume replays at most 360 ticks, which takes milliseconds. Old snapshots are pruned
  to one per in-game day after two days. (b) Inputs are logged the moment they are queued (tagged
  with the tick they apply to), so decisions received just before a shutdown aren't re-asked.
  (c) Phase 1 starts every world with the eight adults of the sample cast; babies, children and the
  three cast options arrive in Phase 4. (d) Observer commands sent while paused advance the world
  by one tick so they take effect immediately. (e) World starts at 07:00 on day 1.
- **2026-09-27 — Don't stop between phases.** The owner asked me to keep building without stopping
  at phase ends or asking questions. Each phase is still committed and pushed separately.

- **2026-09-27 — Art: procedural pixel art for now.** kenney.nl and opengameart.org are blocked from
  the development container, so all sprites are painted in code (`apps/web/src/map/pixelArt.ts`).
  The renderer asks for sprites by name, so a real CC0 tileset can be dropped in later without
  touching the rest of the code. Per-person colour tinting arrives with villagers in Phase 1.
- **2026-09-27 — Helper security: no per-launch token.** The plan mentioned a per-launch token.
  Instead the helper (bound to 127.0.0.1) rejects any request whose `Host` isn't a loopback name
  (blocks DNS rebinding) and any request whose `Origin` isn't the app's own page (blocks other
  websites; no CORS headers are ever sent). A token held by the page would add nothing on top of
  those checks. Revisit if the helper ever needs to serve non-browser clients.
- **2026-09-27 — Trackpad-first map controls.** Two-finger scroll pans; pinch or ⌘+scroll zooms
  (owner is on a Mac). Zoom snaps to fixed steps to keep pixel art crisp.
- **2026-09-27 — Plan approved** by the owner as written above.
