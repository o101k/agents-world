# Ask a villager about their past

Owner request (Omar, 2026-10-09): "Create a section in each person, where I can ask what they did
(we can use the same AI as their brain to get the response) and it tells me a summary about them.
I can go as far back as I want and check everything about them. Make it good UX/UI."

Branch `claude/ask-villager-history-ptrtqy`. Planned by Opus; built by Haiku 5.5 low-effort
workers in parallel worktrees; reviewed and iterated by Opus until `npm run check` and e2e pass.

## What the owner gets

- **An "Ask about Anna" section** at the top of every person's inspector (living or dead, and in
  replay). A question box ("What did Anna do?"), period chips (Last hour, Today, Yesterday,
  3 days, A year, Whole life, Pick days…), suggestion chips, and the latest answer right there.
- **A full view** (dialog) with every answer ever given about this person as a conversation,
  a custom range back to the day they were born or arrived (two sliders and a strip with one bar
  per day of their life, taller on eventful days), and **the record**: every line the village
  holds about them in that period (what happened, what they said and heard, what they were
  thinking at each decision, their diary, their memories), filterable by kind and paged back as
  far as they lived. Clicking a time jumps the map replay to that moment.
- **Answers come from the person's own brain** (same provider and model), reading a digest of
  their record. They are a third-person summary for the observer, grounded in the record.
  Mock-brain people get a free rule-based summary. The cost counts like any other AI call.

## Hard rules (decided)

1. **Asking never changes the world.** No tick input, no memory, no change to any agent. The
   answer is for the observer only; the person doesn't know they were asked. Determinism, resume
   and replay are untouched.
2. **One voice:** a third-person summary ("Anna spent the morning…"), lead with the direct
   answer, mention days for key moments, never invent anything not in the record.
3. **Cost:** a paid answer adds its cost with `runner.addSpend(cost, coveredByPlan)` (counts
   toward the spending cap and `planUsd`) and logs one `llm_calls` row with `trigger:
   'interview'` for that person (so the Brains dialog's per-person spend and village totals
   include it, and "Raw AI exchanges" shows the prompt). The inspector's Brain line shows
   "+ $0.01 on your questions" from the new `AgentDetail.askedUsd`. Interview prompts are large,
   so they can push older decision prompts out of the 20 kept in "Raw AI exchanges"; accepted.
4. **Never a dead end, never hidden:** whenever their AI can't or mustn't answer, the free
   summary answers instead with a visible note saying why (`fallback`): `mock_brain` (they
   think with the Mock brain; no note needed), `not_set_up`, `cap_reached` (checked before the
   call; no call is made), `rate_limit`, `error`, `refused`. A paid call that failed still counts
   its cost. A rate limit on a question **does not pause the world**.
5. **Through the router:** interview calls go through a new `BrainRouter.generate` that reuses
   the per-provider `PrioritySemaphore` (so `claude_plan` never runs more than 3 processes) and
   the abort/timeout logic, and returns rate-limit info instead of throwing.
6. `@aw/brain` reads a server-built `PersonDigest` (one person's record, for the observer). It
   never sees `WorldState`, and the digest never enters anyone's own decision prompts. Record in
   the CLAUDE.md Decision log.
7. Web changes stay in the inspector: new components and a new CSS file
   (`apps/web/src/components/ask.css`, imported by the component). Don't touch the map renderer
   or `styles.css` (another thread, "Faster world rendering", is changing rendering now).

## Data: the record

A person's **life span** in the world: `from = max(agent.bornTick, file.firstSnapshotTick())`,
`to = alive ? state.tick : death tick`. Periods are clamped to it (swap if from > to).

`RecordEntry` (shared) kinds, built by the server:

| kind      | from                                                                                     | importance        |
| --------- | ---------------------------------------------------------------------------------------- | ----------------- |
| `event`   | events where they're an actor, except `said`, `decided`, `reflected`                     | the event's       |
| `said`    | `said` events where they're an actor (spoke or were spoken to)                           | the event's (2)   |
| `diary`   | `reflected` events whose first actor is them (diary entries and life chapters)           | the event's       |
| `thought` | their logged `decision` inputs in `tick_inputs`: text = thought + " (Goal: …)" if a goal | 2                 |
| `memory`  | their current memories + forgotten list (state): kinds `told` and `thought`; `conversation` not starting with "I said"; `experience` with importance ≥ 6 | the memory's |

`decided` events are skipped (the thought entries carry the goal). Empty thoughts are skipped,
consecutive identical thoughts collapse into one. Forgotten memories carry `forgotten: true`.

### World file (migration 5)

```sql
CREATE TABLE IF NOT EXISTS event_actors (
  agent_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  PRIMARY KEY (agent_id, event_id)
) WITHOUT ROWID;
INSERT OR IGNORE INTO event_actors (agent_id, event_id)
  SELECT j.value, e.id FROM events e, json_each(e.actors) j;
CREATE INDEX IF NOT EXISTS tick_inputs_agent
  ON tick_inputs (json_extract(payload, '$.agentId'), tick) WHERE kind = 'decision';
CREATE TABLE IF NOT EXISTS interviews ( ...see InterviewView... );
CREATE INDEX IF NOT EXISTS interviews_agent ON interviews (agent_id, id);
```

Measured on 600k events / 300k decisions: per-person scans took 144 ms and 237 ms; with the
table and the partial index, 5 ms and 0 ms. Backfill + index build < 1.2 s once. Queries on
decisions must repeat exactly `kind = 'decision' AND json_extract(payload, '$.agentId') = ?`
or SQLite won't use the partial index. `appendWorldEvents` and `appendEvent` also insert
`event_actors` rows.

### The digest (what the AI reads)

`buildDigest(file, state, agent, from, to, effort)` → `PersonDigest` (shared type): profile
(name, sex, age, stage, alive/death, occupation, traits, background, temperament words, home,
money, top skills, family lines, top relationships, life chapters, beliefs), the period (ticks,
label, whole life?, ends now?), `activity` (routine events, importance ≤ 2, counted by kind
with plain labels, top 12), `companions` (other actors in their events in the period, top 8),
and `entries` chosen by quota, oldest first, each text ≤ 280 chars (diary ≤ 600):

| quota per effort      | frugal | standard | deep |
| --------------------- | -----: | -------: | ---: |
| diary / chapters      |     10 |       20 |   40 |
| notable events (≥ 3)  |     40 |       80 |  160 |
| thoughts              |     15 |       30 |   60 |
| said                  |     15 |       30 |   60 |
| memories              |     10 |       20 |   40 |
| max characters (all)  |  9 000 |   18 000 | 36 000 |

Over quota: notable events keep importance ≥ 6 first, then **sample evenly across the period**
(`sampleEvenly(items, n)` keeps first and last), so early life survives a "whole life"
question; thoughts, said and memories are sampled evenly; diary keeps the most important then
evenly. If the total is over the character cap, drop evenly from the biggest group until it
fits. `total` = lines in the period, `omitted` = lines left out.

## API (shared types in `packages/shared/src/interview.ts`)

| Method | Path                                         | Body / query                         | Result               |
| ------ | -------------------------------------------- | ------------------------------------ | -------------------- |
| GET    | `/api/worlds/:id/agents/:agentId/interviews` |                                      | `InterviewsResponse` |
| POST   | `/api/worlds/:id/agents/:agentId/ask`        | `AskRequest {question, fromTick, toTick}` | `AskResponse`   |
| GET    | `/api/worlds/:id/agents/:agentId/record`     | `RecordQuery {from?, to?, kinds?, limit, offset}` | `RecordResponse` |

`InterviewsResponse` also carries `lifeFromTick`, `lifeToTick`, `nowTick` and `daysPerYear` so
the inspector section needs one request to draw its chips. `RecordResponse` is newest first,
with `counts` per kind for the whole period (ignoring the filter), `total` for the filter, and
`days` for the person's whole life (`{day, entries, notable}`, day = ⌊tick / 1440⌋ + 1).
Follow-ups: the server passes the last 3 earlier answers about this person **for the same
period** to the AI as conversation context.

## Brain (`packages/brain/src/interview.ts`)

- `interviewPrompt(digest, question, history, effort)` → `{ system, user }`. System: the
  village chronicler in a life simulation of a small pre-industrial village; the observer (who
  watches but can't change anything) asks about one villager; answer only from the record,
  third person, plain warm English, lead with the direct answer, days for key moments, say so
  when the record doesn't tell; word budget 150 / 250 / 400 by effort unless asked for detail;
  the record mixes what happened (complete), what they thought at the time, their diary (their
  words, may be biased) and memories (heard or told; may be untrue). Answer through the
  `answer` tool: `{ answer: string }`.
- `mockInterview(digest, question)` → a free summary built from the digest: leads with what the
  question asks about (feelings → diary and thoughts; who/friends/family/love → companions and
  relationships; want/goal/plan → goals from thoughts; wrong/bad/trouble → events like attacked,
  stole, fell ill, need critical, died; otherwise what they did: top activities, notable
  events), then a line or two of the rest. Uses the right pronouns. Never empty: an empty period
  says "Nothing is recorded about Anna between … and …".
- `askAboutPerson(router, brain, digest, question, { history, capReached, timeoutMs })` →
  `InterviewResult { answer, provider, model, usage?, fallback?, note?, trace?, error? }`.
  Mock brain → mock, `fallback: 'mock_brain'`. Cap reached (paid brain) → mock + note, no call.
  Otherwise `router.generate(...)`; answer = `output.answer` if a string, else the raw `text`
  the provider returned; failures → mock + note, keeping `usage` if the call was paid.
- `BrainRouter.generate(config, req, { priority = 1, timeoutMs = 90_000 })` → `RoutedGenerate`.
- Providers' `generate` also return `text` (any plain text the model wrote) so a model that
  answers in prose instead of the tool still gives an answer.

## Web (`apps/web/src`)

- `ask.ts` (pure, unit-tested): `pronounsFor(sex)`, `suggestionsFor(firstName, sex)`,
  `periodPresets(nowTick, lifeFrom, lifeTo, daysPerYear)`, `periodLabel(from, to, lifeFrom,
  lifeTo)`, `answerBlocks(text)` (paragraphs and "- " bullet lists), `groupRecordByDay`,
  `RECORD_KIND_LABELS`, `describeAnswerSource(interview)`.
- `components/AskSection.tsx` in the inspector right under the head (before Mind), keyed by
  person so its state never resets while the inspector polls every 600 ms; props are the few
  primitives it needs, not the whole `agent`. Drops an in-flight answer if the person changes.
- `components/AskDialog.tsx`: the full view (conversation, period picker with day strip, the
  record with kind tabs and paging, times jump replay).
- `components/AnswerCard.tsx` shared by both.
- `components/ask.css`.
- Brain line in the inspector: "+ $X on your questions" when `askedUsd > 0`.

## Work split

| Who            | Owns                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opus (first)   | Groundwork commit: shared types + Zod, `api.ts` methods, stubs for `askAboutPerson`, `mockInterview`, `interviewPrompt`, `BrainRouter.generate`, the server methods and routes (throwing "not built yet"), this plan |
| Haiku: brain   | `packages/brain/src/interview.ts` + `interview.test.ts`, `router.ts` (`generate`), `types.ts` + the three providers' `generate` returning `text`                   |
| Haiku: server  | `worldFile.ts` (migration 5 + methods), new `worlds/personRecord.ts` + test, `worldManager.ts` (`ask`, `interviews`, `record`, `askedUsd`), routes, integration test |
| Haiku: web     | `ask.ts` + test, `AskSection.tsx`, `AskDialog.tsx`, `AnswerCard.tsx`, `ask.css`, the inspector wiring, `tests/e2e/ask.spec.ts`                                      |
| Opus (last)    | Review, integrate, mock-brain probe, real-UI check in headless Chromium, screenshots, docs (README, DESIGN, CLAUDE.md), PR                                       |

## Checks

- `npm run check` (typecheck + lint + Vitest) and `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`.
- Server integration test with a fake paid provider (`decide` + `generate`): the answer, its
  cost in `meta.spentUsd`, the person's Brains-dialog row and `askedUsd`, one `llm_calls` row
  with `trigger 'interview'`, no new tick input and an unchanged state hash; cap reached → free
  summary with `fallback: 'cap_reached'` and no new cost; a rate-limited `generate` → free
  summary, world not paused.
- Headless Chromium: ask about a Mock villager after a day, open the full view, page the
  record back to day 1, screenshots for the PR.
