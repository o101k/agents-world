# Agents World

[![CI](https://github.com/omarkar101/agents-world/actions/workflows/ci.yml/badge.svg)](https://github.com/omarkar101/agents-world/actions/workflows/ci.yml)

A browser-based 2D life simulation. Every villager will be an independent AI agent with its own
"brain" (an LLM of your choice). You set up the world, then watch: they're born, grow up, work,
trade, fall in love, have children and die. You can observe everything, but you can't control anyone.

**Status: Phase 6 (replay and scale) — all planned phases are built.** Villagers are born, grow up, learn to talk, work, trade, fall in
love, have children, build houses, grow old and die; children inherit looks, temperament and
aptitudes from their parents, and estates pass to heirs. They farm, fish, forage, chop wood, bake,
make tools, trade at the market, and can also steal and fight. They can grow the village too:
clear and sow fields of their own, quarry stone, put up bakeries, workshops, wells, animal pens
and market stalls, keep hens and sheep, sew warm clothes, sell from their own stalls, hire each
other for a wage, and hold village meetings that pass rules, set a levy and elect a leader. Over a long life they keep a diary,
write a chapter of their life story every year, form beliefs and forget what didn't matter. You can
send droughts, storms, sickness, fires and bumper harvests, search the whole history, and read
anyone's life story. The year turns through spring, summer, autumn and winter; you can scrub the
map back to any moment of a world's history; and villages of 150+ people run on the huge map.
Each person can think with an AI of your choice (Claude through your own Claude Pro/Max
subscription or an API key, OpenAI, or any OpenAI-compatible service such as OpenRouter or a local
Ollama/LM Studio), or with the free rule-based Mock brain. See
[`CLAUDE.md`](CLAUDE.md) for the full plan and [`docs/DESIGN.md`](docs/DESIGN.md) for the design.

## Requirements

- **Bun 1.4 or newer.** Bun installs the packages, runs the helper, the tests and the tools. Node.js
  is no longer needed. The version this project uses is pinned in `package.json`. On macOS install
  it with `brew install oven-sh/bun/bun` or `curl -fsSL https://bun.sh/install | bash`. Check with
  `bun --version`.
- A modern browser (Chrome, Safari, Firefox, Edge).

Everything runs on your own computer. Nothing is uploaded anywhere. (From Phase 2, the prompts
for AI villagers go to whichever AI providers you choose, using your own keys.)

## Run it

```bash
git clone <this repo> agents-world
cd agents-world
bun install      # first time only (and after pulling updates)
bun start
```

`bun start` builds the UI, starts the local helper and opens **http://127.0.0.1:4747** in your
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
- **Places and things**: click a house, tree, bush, field, the well, the bakery… to see its
  **history**: whether it was there when the village was founded or who built it and when, then
  every lasting change (fires, rebuilding, inheritance, births and deaths of the people who live
  there, someone moving in), how often it has been used and by whom most, and its latest uses.
  Times jump the map to that moment; names open the person. Worlds made before this was added
  have their building and fire history recovered; day-to-day use counts from the upgrade on.
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

**With your Claude subscription (Pro or Max), no API key:**

1. Install Claude Code on your Mac: in Terminal run `curl -fsSL https://claude.ai/install.sh | bash`.
2. Run `claude` once and log in with the Claude account that has your plan. You can close it after.
3. In Agents World open **⚙ AI settings**. The **Claude subscription** card should say _Ready_
   (press **Check** if you logged in while the helper was running). Pick a default model there:
   Haiku makes your limits last longest; Sonnet and Opus are smarter but use them faster.
4. Choose **Claude subscription**, a model and an effort when you pick brains for a new world (see
   below), or in a running world with **🧠 Brains** (one person, a few, or everyone at once).

Villagers then share your plan's 5-hour and weekly limits with your own Claude use. It costs no
extra money, but each call is priced at what it would cost on an API key (Claude Code's own
estimate) and that counts toward the world's spending cap, so raise the cap to let a plan village
run longer. **🧠 Brains** and the inspector mark that cost as covered by your plan. When the limit
runs out, time pauses and resumes by
itself when the limit resets (or press Play to try sooner). Agents World never sees your Claude
login: it runs the official `claude` command, which Anthropic allows for your own projects, and
never uses `ANTHROPIC_API_KEY` for these calls. Each decision takes a few seconds longer than with an
API key because it starts a `claude` process. If calls fail with an unknown option, run
`claude update`.

**With API keys:**

1. Click **⚙ AI settings** (on the worlds screen, or ⚙ in a world's top bar) and add a key:
   - **Anthropic**: paste your API key. Default model `claude-haiku-4-5` (the cheapest Claude model).
   - **OpenAI**: paste your key and choose a default model.
   - **OpenAI-compatible**: set the base URL — `https://openrouter.ai/api/v1` for OpenRouter (plus
     your key), or `http://localhost:11434/v1` for Ollama / `http://localhost:1234/v1` for LM Studio
     (no key needed; free, runs on your Mac).
   - **Test connection** lists the models it can see.
     Keys stay in `~/.agents-world/secrets.json` (readable only by you) and are never shown again or
     sent to the browser. You can instead set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or
     `OPENAI_COMPATIBLE_API_KEY` before `bun start`.
2. Pick brains for the villagers (see below).
3. Press Play. The meter in the top bar shows AI spending against the world's cap (default $1); click
   it to change the cap. When the cap is reached, time pauses.

**Rate limits.** If a provider answers "too many requests" (HTTP 429, or a used-up quota) for
anyone's decision, time pauses and a banner says exactly what happened: whose decision, which
provider and model, which limit, the provider's retry-after and its own error message. When the
provider says when the limit lifts, time resumes by itself then; otherwise press Play to try again.
Either way that person's decision is asked again, not skipped. The same note goes in the timeline.

**Choosing who thinks with what.** Creating a world has two steps: fill in the form, press **Next:
choose brains**, and a list of the starting villagers appears. Everyone starts on the first AI
you've set up (or the free Mock brain if none is). Tick people (or **All**, **Adults**,
**Children**), pick a provider, model and effort, and press **Apply**; **Change** on a row does the
same for one person. The default for newborns and spawned people is set at the bottom. Then
**Create world**. Inside a world the same dialog opens from **🧠 Brains** in the top bar, with each
person's AI calls, tokens in and out, and cost so far, plus the whole village's totals. (One
person's brain can also still be set in their inspector.)

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

**Growing the village**: villagers can clear land for fields of their own, cut stone, build new
bakeries, workshops, stone wells, animal pens and market stalls (a building with enough stone in it
can't burn), keep hens and sheep for eggs and wool, make warm clothes, sell from their own stall at
their own price, hire each other for a daily wage, and call village meetings at the market to vote
on rules: a daily levy into the village purse, or a leader who may spend it. The World tab's
**Village** section shows the leader, purse, rules, meetings, stalls, pens, owned fields and work
agreements; click a stall or pen on the map for its goods or animals.

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
long is dropped rather than sent late. To see how your machine copes: `bun run stress` (below).

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
folder: `AGENTS_WORLD_HOME=/path/to/folder bun start`.

### Settings (environment variables)

| Variable            | Default           | Meaning                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `AGENTS_WORLD_HOME` | `~/.agents-world` | Where worlds and settings are stored                 |
| `AW_PORT`           | `4747`            | Port for the local helper                            |
| `AW_NO_OPEN`        | unset             | Set to `1` to stop the browser opening automatically |

## Stress test

```bash
bun run stress                    # 100 adults + 50 children, 3 in-game days, huge map
bun run stress 120 60 8 huge      # adults, children, days, map size
```

Runs a big village headless with the free Mock brain and prints the simulation speed, survival,
and the sizes of snapshots and per-frame updates.

## Development

```bash
bun run dev        # hot reload: helper on :4747, UI on http://localhost:5173
bun run check      # typecheck + lint + unit and integration tests
bun run test       # unit and integration tests only (Vitest)
bun run test:e2e   # end-to-end browser tests (Playwright)
bun run format     # Prettier (optional; CI doesn't check formatting)
```

`bun run check` goes through Turborepo, which runs the typecheck, lint and tests in parallel and
caches the results, so a second run with nothing changed is instant. The cache lives in `.turbo/`
(git-ignored). Turborepo sends anonymous usage data to its makers (Vercel); turn that off once with
`bunx turbo telemetry disable`.

Our tests run with `bun run test` (Vitest). Plain `bun test` is Bun's own test runner and is not
what we use.

For the end-to-end tests, install a browser once with `bunx playwright install chromium`
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
  The workflow installs Bun from the version in `package.json`.

### Project layout

```
packages/shared   types and message formats shared by everything
packages/sim      the simulation: deterministic world rules (no AI, no I/O)
packages/brain    the AI layer: providers, prompts, mock brain, pricing
apps/server       the local helper: saves worlds, runs the simulation, serves the UI
apps/web          the browser UI: React panels + PixiJS map
tests/e2e         Playwright tests
turbo.json        task pipeline (Turborepo): what runs, in what order, what is cached
bunfig.toml       Bun settings (tools run on Bun, npm-style node_modules)
docs/DESIGN.md    design doc
```

### Troubleshooting

- **"Port 4747 is already in use"**: the helper is probably already running in another terminal.
  Open http://127.0.0.1:4747, or stop the other one, or use `AW_PORT=4800 bun start`.
- **The page says it can't reach the helper**: start it with `bun start`; the page reconnects by itself.
- **`bun install` fails**: make sure Bun is 1.4 or newer (`bun --version`; update with `bun upgrade`).
  The native SQLite driver ships ready-built, so nothing needs compiling.
