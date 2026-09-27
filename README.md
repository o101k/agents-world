# Agents World

[![CI](https://github.com/omarkar101/agents-world/actions/workflows/ci.yml/badge.svg)](https://github.com/omarkar101/agents-world/actions/workflows/ci.yml)

A browser-based 2D life simulation. Every villager will be an independent AI agent with its own
"brain" (an LLM of your choice). You set up the world, then watch: they're born, grow up, work,
trade, fall in love, have children and die. You can observe everything, but you can't control anyone.

**Status: Phase 6 (replay and scale) — all planned phases are built.** Villagers are born, grow up, learn to talk, work, trade, fall in
love, have children, build houses, grow old and die; children inherit looks, temperament and
aptitudes from their parents, and estates pass to heirs. They farm, fish, forage, chop wood, bake,
make tools, trade at the market, and can also steal and fight. Over a long life they keep a diary,
write a chapter of their life story every year, form beliefs and forget what didn't matter. You can
send droughts, storms, sickness, fires and bumper harvests, search the whole history, and read
anyone's life story. The year turns through spring, summer, autumn and winter; you can scrub the
map back to any moment of a world's history; and villages of 150+ people run on the huge map.
Each person can think with an AI of your choice (Claude, OpenAI, or any OpenAI-compatible service
such as OpenRouter or a local Ollama/LM Studio), or with the free rule-based Mock brain. See
[`CLAUDE.md`](CLAUDE.md) for the full plan and [`docs/DESIGN.md`](docs/DESIGN.md) for the design.

## Requirements

- **Node.js 22 or newer.** On macOS: `brew install node` (or the installer from nodejs.org).
  Check with `node -v`.
- A modern browser (Chrome, Safari, Firefox, Edge).

Everything runs on your own computer. Nothing is uploaded anywhere. (From Phase 2, the prompts
for AI villagers go to whichever AI providers you choose, using your own keys.)

## Run it

```bash
git clone <this repo> agents-world
cd agents-world
npm install      # first time only (and after pulling updates)
npm start
```

`npm start` builds the UI, starts the local helper and opens **http://127.0.0.1:4747** in your
browser. Leave the terminal window open while you play; press **Ctrl+C** in it to stop.

### Using it

- **Worlds screen**: create a world (name, optional seed, map size, and the starting villagers:
  the sample cast, your own cast written on cards, or a cast generated from the seed — optionally
  fleshed out by an AI), open it, or delete it. The same seed always makes the same map. For a big
  village choose the **Huge** map and generate up to 150 adults and 100 children.
- **World screen**: drag or two-finger scroll to pan; pinch or ⌘+scroll to zoom; arrow keys/WASD
  pan, `+`/`−` zoom, `F` fits the map. **← Worlds** goes back.
- **Time**: ▶ Play / ❚❚ Pause (or Space) and a speed picker (1× = one in-game minute per second, up
  to Max). The world keeps running while the helper runs, even with the browser closed. The top
  bar shows the **season** and year: a year lasts as long as a year of age (the aging slider), so
  by default each in-game day is a season. Winter nights are bitter and almost nothing grows;
  summer is warm and bountiful.
- **⏪ Replay**: scrub the map back to any moment of the world's history with the slider (or
  ±1 hour / ±1 day, or play history at 10×/60×/600×). The map, the people list, the timeline and
  each person's inspector show that moment; click any time in the timeline to jump there. It's
  rebuilt from the saved history (no AI calls, no cost) while the live world carries on. **Back
  to live** returns.
- **People**: the People tab lists everyone; click a person (on the map or in the list) to inspect
  their thoughts, plan, needs, belongings, recent experiences, personality and skills. **Follow**
  keeps the camera on them.
- **Timeline** (bottom): everything that happens, newest first. Filter to important events or to
  the selected person, or **search** the whole history (e.g. `fire`, `Maren`, `born`); click an
  entry to jump to that person.
- **⚡ Events** (top bar): start a **storm** (chills anyone outside; people shelter at home), a
  **drought** (crops stop growing; when severe the river dries up and only the well has water), a
  **sickness** (spreads between people who stay close; rest and nursing help), a **fire** (a building
  burns down and must be rebuilt) or a **bumper harvest**. Choose how severe and how long. Active
  events show under the top bar. You change the world, not the people: they notice what they can
  see and decide for themselves.
- Stopping the helper (Ctrl+C) or even a crash loses nothing: the world resumes at the exact
  in-game minute it had reached.

### Giving villagers AI brains

1. Click **⚙ AI settings** (on the worlds screen, or ⚙ in a world's top bar) and add a key:
   - **Anthropic**: paste your API key. Default model `claude-haiku-4-5` (the cheapest Claude model).
   - **OpenAI**: paste your key and choose a default model.
   - **OpenAI-compatible**: set the base URL — `https://openrouter.ai/api/v1` for OpenRouter (plus
     your key), or `http://localhost:11434/v1` for Ollama / `http://localhost:1234/v1` for LM Studio
     (no key needed; free, runs on your Mac).
   - **Test connection** lists the models it can see.
     Keys stay in `~/.agents-world/secrets.json` (readable only by you) and are never shown again or
     sent to the browser. You can instead set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or
     `OPENAI_COMPATIBLE_API_KEY` before `npm start`.
2. In a world, open the **World** tab → **Default brain**, pick the provider/model/effort, tick
   "Also switch everyone alive", and save. Or set one person's brain in their inspector.
3. Press Play. The meter in the top bar shows AI spending against the world's cap (default $1); click
   it to change the cap. When the cap is reached, time pauses.

**Effort levels**: _Frugal_ (cheapest — routine needs like drinking, eating and going to bed are
handled by instinct without an AI call), _Standard_, _Deep_ (more memories per prompt, more thinking).

**Rough costs** (they depend on the model): a decision is about 1,000–1,500 input tokens and ~150
output tokens. With `claude-haiku-4-5` that's roughly $0.002 per decision; eight Frugal villagers
make a few hundred decisions per in-game day. Local models via Ollama or LM Studio cost nothing.
Check the **Prices** table in settings so the meter matches your provider's prices.

In a person's inspector you can read their current thought, plan, memories and the people they know,
and open **Raw AI exchanges** to see the exact prompt and reply behind recent decisions.

**The economy**: fields grow wheat or vegetables, trees give wood, the bakery turns wheat into bread
and the workshop turns wood into planks and tools. The town market (click it, or see the World tab)
buys and sells everything at prices that follow supply and demand. Villagers can give things to each
other and make trade offers; they only know market prices they've seen themselves.

**Families**: each person's inspector shows their family, relationships (how they feel about whom),
pregnancy, will, inborn aptitudes and a **Family tree** (grandparents to grandchildren). Babies stay
at home and must be fed; children learn from what they're taught and what they watch. The **World**
tab has the **aging speed** slider (in-game days per year of age).

**Memory over a long life**: each night people look back on their day and write a short diary
entry, and on each birthday a chapter of their life story (which replaces that year's diary). They
also note beliefs they've come to. Memories fade night by night unless they mattered (births,
deaths, partners and other core memories last for life), and memories from the first three years
mostly fade. In the inspector's **Memory** section you'll find their life chapters, beliefs,
memories (fainter = fading), diary, and what they have **forgotten** (greyed out — they no longer
know it). **Life story** puts what happened to them (from the village's history) next to what they
wrote about it. Frugal villagers write their nightly diary for free by instinct and use their AI
only for the yearly chapter; Standard/Deep villagers use their AI for both.

**+ Spawn** brings a new person into the world from your description (the world's default AI fleshes
them out). They arrive on the road knowing no one.

**Big villages**: the helper handles 150+ people comfortably with the Mock brain (about 300
in-game minutes per second on a laptop). With AI brains, the AI's speed and your budget set the
pace: requests queue per provider, conversation replies go first, and a request that waits too
long is dropped rather than sent late. To see how your machine copes: `npm run stress` (below).

### Where your worlds are saved

In `~/.agents-world/` (a hidden folder in your home directory):

```
~/.agents-world/
  app.json                 which world is active
  settings.json            provider URLs, default models, price table
  secrets.json             your API keys (only readable by you)
  worlds/<world-id>.sqlite one file per world (its whole history)
```

To back up a world, copy its `.sqlite` file while the helper is stopped. To use a different
folder: `AGENTS_WORLD_HOME=/path/to/folder npm start`.

### Settings (environment variables)

| Variable            | Default           | Meaning                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `AGENTS_WORLD_HOME` | `~/.agents-world` | Where worlds and settings are stored                 |
| `AW_PORT`           | `4747`            | Port for the local helper                            |
| `AW_NO_OPEN`        | unset             | Set to `1` to stop the browser opening automatically |

## Stress test

```bash
npm run stress                    # 100 adults + 50 children, 3 in-game days, huge map
npm run stress -- 120 60 8 huge   # adults, children, days, map size
```

Runs a big village headless with the free Mock brain and prints the simulation speed, survival,
and the sizes of snapshots and per-frame updates.

## Development

```bash
npm run dev        # hot reload: helper on :4747, UI on http://localhost:5173
npm run check      # typecheck + lint + unit and integration tests
npm test           # unit and integration tests only (Vitest)
npm run test:e2e   # end-to-end browser tests (Playwright)
npm run format     # Prettier (optional; CI doesn't check formatting)
```

For the end-to-end tests, install a browser once with `npx playwright install chromium`
(or point `PW_CHROMIUM_PATH` at an existing Chromium).

### Tests and CI

- **Unit tests** sit beside the code (`*.test.ts`): world rules, memory, seasons, world events,
  brains and prompts, the browser's state store, request validation.
- **Integration tests**: `apps/server/src/helper.integration.test.ts` starts the real helper on a
  real port and uses it like the browser does (HTTP + WebSocket): run a world, receive frames and
  events, spawn someone, start a storm, search, replay, restart the helper and resume. Others
  check exact resume/replay and a few in-game days of mock-brain village life.
- **End-to-end** (`tests/e2e`): Playwright drives the built UI in Chromium.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs on pushes to `master` and on every pull
  request (and by hand from the Actions tab):
  typecheck, lint and all Vitest tests on Linux and macOS, a small stress run, then the
  end-to-end tests on Linux (the Playwright report is attached to the run if they fail).

### Project layout

```
packages/shared   types and message formats shared by everything
packages/sim      the simulation: deterministic world rules (no AI, no I/O)
packages/brain    the AI layer: providers, prompts, mock brain, pricing
apps/server       the local helper: saves worlds, runs the simulation, serves the UI
apps/web          the browser UI: React panels + PixiJS map
tests/e2e         Playwright tests
docs/DESIGN.md    design doc
```

### Troubleshooting

- **"Port 4747 is already in use"**: the helper is probably already running in another terminal.
  Open http://127.0.0.1:4747, or stop the other one, or use `AW_PORT=4800 npm start`.
- **The page says it can't reach the helper**: start it with `npm start`; the page reconnects by itself.
- **`npm install` fails building `better-sqlite3`**: make sure you're on Node 22+; on macOS you may
  need the Xcode command line tools (`xcode-select --install`).
