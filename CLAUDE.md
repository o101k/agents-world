# Agents World — project context for Claude

Browser-based 2D life simulation where every human is an independent AI agent. This file holds
the original brief, every decision made with the owner, the agreed architecture and the phased
roadmap. **Keep it updated whenever a decision changes** (add to the Decision log at the bottom).

- Technical design of what's built so far: [`docs/DESIGN.md`](docs/DESIGN.md) (update as we go)
- How to run: [`README.md`](README.md)

## How we work (from the owner)

1. Build phase by phase. **Stop at the end of each phase** so the owner can test it.
2. Keep the README (how to run) and `docs/DESIGN.md` (short design doc) up to date.
3. Keep this file updated whenever a decision changes.
4. Development branch: `claude/life-sim-architecture-dd85a8`. Don't open PRs unless asked.
5. The owner runs on **macOS**. Development happens in a cloud container using the Mock brain
   and headless Chromium; real AI providers are tested on the owner's Mac. Never ask for or
   handle the owner's API keys in chat.

## Current status

| Phase                         | Status                            |
| ----------------------------- | --------------------------------- |
| 0 – Skeleton                  | **Done — awaiting owner testing** |
| 1 – A world that runs (no AI) | Next                              |
| 2 – Minds                     | Planned                           |
| 3 – Work, trade, money        | Planned                           |
| 4 – Life cycle                | Planned                           |
| 5 – A long life               | Planned                           |
| 6 – Replay and scale          | Planned                           |

## Commands

```bash
npm install          # once
npm start            # build UI, start helper, open browser (http://127.0.0.1:4747)
npm run dev          # hot-reload dev mode (UI at http://localhost:5173)
npm run check        # typecheck + lint + unit tests — run before every commit
npm run test:e2e     # Playwright end-to-end (in this container: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium)
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

**Tech stack:** TypeScript everywhere · Node.js 22+ helper with Fastify + WebSocket, loopback only ·
SQLite (better-sqlite3), one file per world · PixiJS map + React panels (Vite) · official SDKs
`@anthropic-ai/sdk` and `openai` (the latter also for OpenRouter/compatible via base URL) · Zod ·
Vitest + Playwright · npm workspaces.

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

| Phase                             | What gets built                                                                                                                                                                                                                                                                             | What the owner sees                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **0 – Skeleton** ✅               | Repo setup; `npm start` launches helper + opens browser; worlds screen (create/switch/delete); generated village map; pan/zoom; CLAUDE.md, README, DESIGN.md                                                                                                                                | Make two worlds with different maps, delete one                                    |
| **1 – A world that runs (no AI)** | Ticks, clock, day/night, needs, health and death, gather/eat/drink/sleep, Mock brains, play/pause/speed, click agents/objects for details, live event log, follow a person, exact save and resume                                                                                           | Villagers survive (or don't) on autopilot; stop and restart the helper → same tick |
| **2 – Minds**                     | Provider layer + key settings, per-agent model/effort + world default, request queue, world waits, cost tracking + cap, perception limits, thoughts/goals/plans, memory stream + recall, conversations + overhearing, mind inspector (incl. raw prompt/reply), spawn agent from description | Real AI villagers plan, talk, remember; read their minds; watch spending           |
| **3 – Work, trade, money**        | Skills, crafting chains, jobs and hiring, town market, trade/gifts/loans, ownership, theft and fights, reputation via gossip                                                                                                                                                                | An economy emerges: prices, jobs, crime                                            |
| **4 – Life cycle**                | Aging slider, life stages, AI-from-birth babies with developmental limits, caretaking, teaching, relationships, partnering, conception/pregnancy/birth, genetics, estates/wills, old-age death, family tree, three starting-cast options                                                    | A couple has a baby that learns to talk from them                                  |
| **5 – A long life**               | Forgetting + nightly consolidation, life chapters, childhood memory fading, world events, timeline search, per-agent life story                                                                                                                                                             | Several generations with bounded memory; trigger a drought                         |
| **6 – Replay and scale**          | Map scrubbing to any past moment, 100–200 agents on bigger maps, seasons, polish                                                                                                                                                                                                            | Scrub back to day 12; ~150-person stress test                                      |

### Known risks

- Budget tension: AI from birth + keep-living + very-low budget → the cap is the safety net.
- Unrestricted content: some models soften/refuse violent actions (OpenRouter offers more permissive models).
- Real providers can only be tested on the owner's Mac.

---

## Decision log

Newest first. Record every change to an agreed decision here.

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
