# Agents World

A browser-based 2D life simulation. Every villager will be an independent AI agent with its own
"brain" (an LLM of your choice). You set up the world, then watch: they're born, grow up, work,
trade, fall in love, have children and die. You can observe everything, but you can't control anyone.

**Status: Phase 3 (work, trade, money).** Villagers live in a generated village with needs (food,
water, sleep, warmth); they farm, fish, forage and chop wood, bake bread and make planks and tools,
buy and sell at the town market, give gifts, make trade offers, talk and remember — and can also
steal, fight and die.
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

- **Worlds screen**: create a world (name, optional seed, map size), open it, or delete it.
  The same seed always makes the same map.
- **World screen**: drag or two-finger scroll to pan; pinch or ⌘+scroll to zoom; arrow keys/WASD
  pan, `+`/`−` zoom, `F` fits the map. **← Worlds** goes back.
- **Time**: ▶ Play / ❚❚ Pause (or Space) and a speed picker (1× = one in-game minute per second, up
  to Max). The world keeps running while the helper runs, even with the browser closed.
- **People**: the People tab lists everyone; click a person (on the map or in the list) to inspect
  their thoughts, plan, needs, belongings, recent experiences, personality and skills. **Follow**
  keeps the camera on them.
- **Timeline** (bottom): everything that happens, newest first. Filter to important events or to
  the selected person; click an entry to jump to that person.
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

**+ Spawn** brings a new person into the world from your description (the world's default AI fleshes
them out). They arrive on the road knowing no one.

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

## Development

```bash
npm run dev        # hot reload: helper on :4747, UI on http://localhost:5173
npm run check      # typecheck + lint + unit tests
npm test           # unit tests only (Vitest)
npm run test:e2e   # end-to-end browser test (Playwright)
npm run format     # Prettier
```

For the end-to-end tests, install a browser once with `npx playwright install chromium`
(or point `PW_CHROMIUM_PATH` at an existing Chromium).

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
