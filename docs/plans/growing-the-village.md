# Growing the village — plan

Seven new things villagers can do so the world can grow past its starting layout. Requested by
the owner on 2026-10-07 ("plan all of them"). Built by parallel teammates on top of a shared
groundwork commit; reviewed and iterated until `npm run check` and the e2e tests pass.

| #   | Feature                   | New actions                                                    | Sim module        | Mock brain                    |
| --- | ------------------------- | -------------------------------------------------------------- | ----------------- | ----------------------------- |
| 1   | Fields of one's own       | `clear_field`, `sow`                                           | `farming.ts`      | `mockVillage/farming.ts`      |
| 2   | Build any building        | `build {building}` (house, bakery, workshop, well, pen, stall) | `construction.ts` | `mockVillage/construction.ts` |
| 3   | Quarry stone              | `quarry`                                                       | `quarry.ts`       | `mockVillage/quarry.ts`       |
| 4   | Animals and warm clothes  | `tend_animals` (+ buy hens/sheep, craft `clothes`)             | `animals.ts`      | `mockVillage/animals.ts`      |
| 5   | Own market stalls         | `stock_stall`, `take_from_stall`, `buy_from_stall`             | `stalls.ts`       | `mockVillage/stalls.ts`       |
| 6   | Hiring for a wage         | `hire`, `respond_job`, `end_job`                               | `jobs.ts`         | `mockVillage/jobs.ts`         |
| 7   | Meetings, rules, a leader | `call_meeting`, `propose_rule`, `vote`, `pay_from_treasury`    | `governance.ts`   | `mockVillage/governance.ts`   |
| 8   | The observer's view       | Village panel, sprites for pens/stalls/cleared land            | `apps/web`        | —                             |

The storehouse mentioned in the first suggestion list is left out (it needs deposit/withdraw
actions of its own); it can come later.

## The groundwork (already done — do not change it without asking)

Everything the features share is in place, so each teammate edits only their own files:

- **Goods** (`packages/shared/src/brain.ts`): `stone`, `eggs` (food, 12), `wool`, `clothes`
  ("Warm clothes"), `hen`, `sheep`. Market targets in `packages/sim/src/market.ts`. Recipe
  `clothes`: 3 wool → 1 at the workshop (building skill, no skill bonus).
- **Buildings**: `BUILDINGS` / `BuildingKind` / `STONEWORK_STONE` in shared `brain.ts`. New map
  kinds `pen` and `stall` (solid, see `walkability.ts`). `MapObject` gains `workDone`,
  `stoneWork` and `stone` (stone-built: fire can't take hold — already enforced in
  `conditions.ts`, which now also lets pens and stalls burn).
- **Intents, triggers, perception**: every new intent is in `Intent` + `IntentSchema` +
  `describeIntent`; new triggers `job_offer`, `job_answered`, `job_ended`, `meeting_called`,
  `meeting_open`, `rule_proposed`; `RequestKind` has `'job'` (requests carry `terms`);
  `KnownPlace` has `progress`, `forSale`, `animals`; `Perception` has `rocksNearby`, `jobs`
  (`JobView`), `village` (`VillageKnowledge`).
- **World state v9** (`packages/sim/src/world.ts`): `stalls`, `pens`, `contracts`,
  `meetings`, `rules`, `leaderId`, `treasury` and id counters (`emptyVillage()`); agents gain
  `knownMeetings` and `noticeBoard`. Old saves are upgraded.
- **Body action** `{ type: 'task'; task: 'clear_field' | 'sow' | 'quarry' | 'tend_animals';
objectId; until; item? }` (`TaskAction` in `agent.ts`). The engine calls your finish function
  when `state.tick >= until`.
- **Engine wiring** (`engine.ts`): `startIntent` sends each new intent to its module; every tick
  calls `animalsTick`, `jobsTick`, `governanceTick`; warmth loss outdoors is multiplied by
  `clothingWarmth(agent)`; `look()` stores `stallListing` / `penAnimals` in the agent's knowledge
  and calls `readNoticeBoard` at the market; field harvests call `onFieldHarvest`.
- **Abilities** (`life.ts`): `build`, `hire`, `call_meeting`, `propose_rule`, `vote`,
  `pay_from_treasury` are grown-up only; children can't `clear_field`, `sow`, `quarry`,
  `stock_stall`, `take_from_stall`, `respond_job`, `end_job`; children can `tend_animals` and
  `buy_from_stall`.
- **Brain**: the decide tool (`schema.ts`) and prompt (`prompt.ts`) already describe and parse
  every new action, trigger and perception field. Mock brain: `mockVillage/index.ts` calls each
  feature's `reply(p, roll)` right after family matters and `plan(p, roll)` just before ordinary
  work.
- **Observer**: `GET /api/worlds/:id/village` returns `VillageResponse` (built by `villageView`
  in `views.ts`); `api.village(id)` in the web app.
- Each feature module exists as a stub with the exact exported signatures. Keep the signatures.

## Rules for every teammate

1. **Edit only the files listed for your feature.** If you believe a shared file needs a change,
   don't make it: say so in your final report.
2. **The sim is deterministic**: no `Math.random`, `Date`, I/O. Randomness only from `ctx.rng`
   (`next()`, `chance(p)`, `int(a, b)`, `pick(list)`). Iterate in a fixed order (arrays as stored;
   sort object keys).
3. **Helpers to use** (all exported):
   - `engine.ts`: `fail(ctx, agent, reason)` (cancels the plan, remembers why, asks the brain
     again), `emit(ctx, kind, actorIds, text, importance)`, `approach(ctx, agent, other, intent,
range, verb)` (true = close enough now; otherwise it walked or failed — just `return`),
     `objName(state, id)`, `facingTo(from, to)`, `useTools(ctx, agent)`, `cheb(a, b)`,
     `witnesses(state, a, b)`, `TALK_RANGE`, `OVERHEAR_RANGE`, `wake`, and `ctx.walkTo(agent,
goalTiles, thenIntent, whatForMessages)`.
   - `agent.ts`: `remember(agent, tick, text, importance, kind?, peopleIds?)`, `fullName(agent)`.
   - `life.ts`: `train(agent, skill, amount)`, `observeWork(state, agent, skill)`,
     `feel(viewer, other, tick, { affection?, trust? })`, `canDo`.
   - `perception.ts`: `nameAsKnown(viewer, other)` — always use it for names in memories.
   - `spatial.ts`: `mapCache(map).byId`, `interactionTiles(map, o)`, `isAt(agent, tiles)`,
     `distanceToObject(o, p)`, `invalidateMapCaches(map)`.
   - `land.ts`: `findFreePlot(state, near, w, h, door)`, `clearPlot(state, plot, w, h)`,
     `nextObjectId(state, kind)`.
   - `world.ts`: `findAgent(state, id)`; `conditions.ts`: `usable(state, objectId)`.
4. **Walk-then-act pattern** (see `startChop` / `startCraft` in `engine.ts`):
   ```ts
   const tiles = interactionTiles(map, o);
   if (!arrived && !isAt(agent, tiles)) {
     ctx.walkTo(agent, tiles, intent, objName(state, o.id));
     return;
   }
   if (!isAt(agent, tiles)) return fail(ctx, agent, `I couldn't reach ${objName(state, o.id)}.`);
   ```
   On arrival the engine runs your start function again with `arrived = true`.
5. **Long work**: `agent.action = { type: 'task', task: 'quarry', objectId: o.id, until:
state.tick + 45 }`. In the finish function set `agent.action = null` first.
   **Short actions** (a trade, a word): finish at once, then `agent.action = { type: 'rest',
until: state.tick + 3 }` so the body takes a moment.
6. **Events**: use the new kinds — `farmed`, `quarried`, `animals`, `stall`, `job`, `meeting`,
   `rule_passed`, `treasury` — or `built`. Importance 1 routine … 5 life-changing.
   **Memories**: first person, importance 2 routine, 3–5 notable, 6–8 big; use `nameAsKnown`.
7. **Decision triggers**: to make someone think, set `other.awaiting = { kind: ..., ... }` only
   if `!other.awaiting && !other.asleep && other.alive`.
8. **Mock brain files** only read the `Perception` (never world state). Use the `roll` argument
   (0–1, fixed for this person and tick) for odds, and keep `plan` odds low (≤ 0.15) so ordinary
   work, food and sleep still happen. Return `null` when the feature has nothing to do.
9. **Tests**: a Vitest file beside your module (`<module>.test.ts`). Copy the `run`/`fresh`
   helpers from `packages/sim/src/economy.test.ts`. Never call a real AI provider.
10. **Before you finish**, from the repo root (the folder you are working in):
    ```bash
    export PATH=/opt/node24/bin:$PATH
    npm ci                       # once, in a fresh worktree
    npm run typecheck
    npx eslint <your files>
    npx vitest run <your test file>
    npm test                     # everything still passes
    ```
    Then `git add` your files and `git commit -m "<feature>: <what>"`. Don't push.

## 1. Fields of one's own — `farming.ts`

Files: `packages/sim/src/farming.ts`, `packages/sim/src/farming.test.ts`,
`packages/brain/src/mockVillage/farming.ts`.

**`clear_field`** (teens and grown-ups):

- If the agent owns an unfinished field (`kind === 'field'`, `progress !== undefined`, owners
  include them), keep working on it. Otherwise start a new one:
  - At most 2 fields of their own (finished or not) — else fail "I already have two fields of my
    own to look after."
  - Plot: `findFreePlot(state, nearPoint, 4, 3, false)` where `nearPoint` is the home object's
    `{x, y}` if they have a home, else their own position. None → fail "There's no free land
    near here to clear."
  - `const removed = clearPlot(state, spot, 4, 3)`; each removed tree gives 2 wood (at most 8
    in all) into the agent's bag.
  - Add the object `{ id: nextObjectId(state, 'field'), kind: 'field', x, y, w: 4, h: 3, name:
'Field N' (N = the number in the id), progress: 0 }` to `state.map.objects`; owners = the
    agent (+ partner if alive); `agent.knowledge[id] = { lastSeenTick: tick }`;
    `invalidateMapCaches(map)`; `state.mapVersion += 1`.
  - Emit `farmed` "X started clearing land for a field." (3); remember (5).
- Walk to the field's interaction tiles (its own footprint), then `task: 'clear_field'` for 60
  ticks.
- Finish: `progress += 0.25 * (0.6 + farming / 100)` (+0.1 more if `useTools`), capped at 1;
  `train(agent, 'farming', 0.5)`; `observeWork`; `state.mapVersion += 1`. At 1: delete
  `progress`; set every footprint tile to `Tile.Farmland`; `invalidateMapCaches`; emit `farmed`
  "X cleared a new field (Field N)." (4); remember (7) "I cleared a field of my own. Now it needs
  sowing." Otherwise remember (2) "I cleared more land (NN% done)."
- A field being cleared has no resource entry, so `gather` there fails as "nothing left".

**`sow {item: wheat | vegetables, objectId?}`** (teens and grown-ups):

- Field = `objectId`, or the nearest finished field the agent owns. Fail if: no such field;
  not finished; common land (no owners) — "Common fields grow by themselves."; owned by others —
  "That field isn't mine to sow."; fewer than 2 of the item — "I need 2 wheat to sow."
- Walk there, then `task: 'sow', item` for 40 ticks. Finish: take 2 of the item; set
  `state.resources[id] = { amount: 0, max: size * 1.2, regenPerDay: size * 0.5, item }` (size =
  w × h; re-sowing switches the crop and starts again from 0); `ctx.changed.add(id)`;
  `train(agent, 'farming', 0.4)`; emit `farmed` "X sowed Field N with wheat." (2); remember (4).
- From then on the field regrows like the common fields (the engine's `regrowResources`).

**`onFieldHarvest(ctx, agent, field, got)`**: if the field has owners and the gatherer isn't
one, each owner who is alive, awake, outdoors and within 8 tiles (`cheb`) notices:
`feel(owner, agent, tick, { trust: -10, affection: -5 })` and remembers (6) "I saw NAME take N
wheat from my field." The gatherer remembers (3) "I took N wheat from NAME's field." (owner
named as the gatherer knows them).

**Tests**: clearing finishes after enough stretches (tiles become farmland, owner set); can't
own a third field; sowing needs 2 seed and creates the resource with the crop; crops then regrow
(step a day); an owner nearby notices someone else harvesting; a child can't clear land.

**Mock** (`plan`): own unfinished field (`kind 'field'`, `owner === 'you'`, `progress !==
undefined`) and roll < 0.5 → `clear_field`. Own finished field with no `produce` and ≥ 2 wheat or
vegetables in the bag → `sow` it. A farmer (occupation includes "farm") with no own field and
roll < 0.08 → `clear_field`.

## 2. Build any building — `construction.ts`

Files: `packages/sim/src/construction.ts`, `packages/sim/src/construction.test.ts`,
`packages/brain/src/mockVillage/construction.ts`.

The stub holds the old house-only code; generalise it. `build_house` behaves exactly like
`build {building: 'house'}`, except that `build_house` may also continue any burnt building of
one's own (as before). Existing tests about houses must keep passing.

- `info = BUILDINGS[kind]`. Carry on first: an unfinished or burnt building of this kind owned by
  the agent.
- New site: building skill ≥ 10 (≥ 20 for bakery and workshop) — else fail "I don't know enough
  about building to start a bakery."; materials for the first stretch in the bag (`info.planks`
  planks and `info.stone` stone) — else fail "I need 3 planks to start building."
- Where: near the agent's home for a pen (else their position); near the town market for
  everything else. `findFreePlot(state, near, info.w, info.h, info.door)`; `clearPlot`.
- Object: `id = nextObjectId(state, kind)`, name `House N` for houses, otherwise
  `${info.label} N` (e.g. "Bakery 2", "Animal pen 1", "Market stall 1", "Well 2"); `door` =
  `{ x: x + floor(w/2), y: y + h - 1 }` when `info.door`; `progress: 0, workDone: 0, stoneWork:
0`. Owners = the agent. `invalidateMapCaches`, `mapVersion += 1`, emit `built` (4), remember (7).
- Work tile: the doorstep `{door.x, door.y + 1}` when there is a door, else any of
  `interactionTiles(map, site)`.
- Each stretch: take `info.planks` planks and `info.stone` stone (fail if short: "I need 3 planks
  for the next stretch of building."). If `info.stone === 0` and the agent carries
  `STONEWORK_STONE` stone, take that too and `stoneWork += 1`. `workDone += 1`. Then
  `action = { type: 'build', objectId, until: tick + 60 }` (as now).
- `finishBuild`: `progress += 0.1 * (0.5 + building / 100) / info.work`. On completion (as now,
  plus): set `site.stone = true` when `stoneWork * 2 >= workDone` (and always for a well);
  a pen gets `state.pens[id] = { hens: 0, sheep: 0, wool: 0, lastTendedTick: tick }`, a stall
  `state.stalls[id] = { stock: {} }` (only if missing); a house becomes home if they have none.
  Rebuilding a burnt building keeps the old messages.
- Burnt buildings use their own kind's materials (a burnt bakery costs bakery planks).

**Tests**: a skilled builder with planks builds a bakery that `craft bread` can then use; a well
needs stone; stonework makes `stone === true` and a fire event aimed at it finds nothing to burn;
a pen creates `state.pens[id]`; a stall creates `state.stalls[id]`; low skill can't start a
bakery; `build_house` still builds a house.

**Mock** (`plan`): an own unfinished building (owner `'you'`, `progress !== undefined`, kind in
`BUILDING_KINDS` but not `field`) and enough planks/stone for a stretch → `build` it (roll <
0.6). With ≥ 2 planks: a trader with no stall of their own → `build stall` (roll < 0.15); a
shepherd or weaver, or anyone carrying a hen or sheep, with no pen of their own → `build pen`
(roll < 0.15).

## 3. Quarry stone — `quarry.ts`

Files: `packages/sim/src/quarry.ts`, `packages/sim/src/quarry.test.ts`,
`packages/brain/src/mockVillage/quarry.ts`.

- `rocksNear(map, p, radius)`: rocks (`kind 'rock'`, 1×1) within `radius` (Chebyshev). Rocks
  are not in `mapCache` cells; build your own grid cached in a `WeakMap` keyed by the
  `map.objects` array (it is replaced whenever objects are removed, so the cache can't go stale).
- Stone on a rock: 6 when untouched. Track it in `state.resources[rockId] = { amount, max: 6,
regenPerDay: 0.5, item: 'stone' }` from the first quarrying on (like trees).
- `quarry {objectId?}`: the given rock, else the nearest rock within 25 tiles with ≥ 1 stone and
  a reachable side. None → fail "I couldn't find a rock to quarry nearby." Walk to its interaction
  tiles, then `task: 'quarry'` for 45 ticks (facing the rock).
- Finish: `got = min(2 + (useTools ? 1 : 0), floor(amount))`; none → fail "That rock is worked
  out for now."; take from the rock, add `stone` to the bag; `train(agent, 'building', 0.15)`;
  `observeWork`; emit `quarried` "X cut N stone." (1); remember (2) "I cut N stone.";
  `ctx.changed.add(rockId)`.

**Tests**: `rocksNear` finds a rock; quarrying yields stone and depletes the rock; no rock →
failure; tools add one.

**Mock** (`plan`): a carpenter, odd-jobber or woodcutter with fewer than 4 stone, `rocksNearby >
0` and roll < 0.12 → `quarry` twice, then sell any stone beyond 4 at the market (only if they
know the market).

## 4. Animals and warm clothes — `animals.ts`

Files: `packages/sim/src/animals.ts`, `packages/sim/src/animals.test.ts`,
`packages/brain/src/mockVillage/animals.ts`.

Hens and sheep are bought at the town market (existing `buy`) and live in pens
(`state.pens[penId]`, created when a pen is finished; create it lazily if missing).

- `tend_animals {objectId?}`: the pen given, else the first usable pen the agent owns. May tend:
  an owner, someone sharing an owner's home, or someone hired by an owner (a contract in
  `state.contracts` with `worker === agent.id` and `employer` an owner). Else fail "That pen
  isn't mine to tend." No pen → fail "I have no animal pen." Walk to its interaction tiles (its
  door), then `task: 'tend_animals'` for 30 ticks.
- Finish, in order:
  1. Hens and sheep in the bag go into the pen, up to 8 animals in all (remember "I put 2 hens
     in the pen.").
  2. Pen empty → fail "The pen is empty — I need hens or sheep from the market."
  3. If at least 6 hours passed since `lastTendedTick`: fodder = 1 berries, else vegetables,
     else wheat from the bag (fed = had some). Each hen lays an egg with chance 0.7 (fed) or 0.35;
     `wool += sheep * (fed ? 0.35 : 0.15)` and the whole part goes into the bag as wool. If less
     than 6 hours: no produce ("The animals were already seen to.").
  4. `lastTendedTick = tick`; `train(agent, 'farming', 0.3)`; `observeWork`; emit `animals`
     "X tended the animals at PEN: 2 eggs, 1 wool." (1); remember (2).
- `animalsTick(ctx)`: only at 06:00 each day (`tick % TICKS_PER_DAY === 6 * 60`). For each pen
  (ids sorted): untended for more than 2 days → one animal (a sheep if `rng.chance(sheep/total)`,
  else a hen) strays; owners remember (5); emit `animals` (2). Tended within the last day: hens
  ≥ 2 and total < 8 → a new hen with chance 0.25; sheep ≥ 2 and total < 8 → a lamb with chance
  0.15. Then every living person carrying clothes: chance 0.04 that one set wears out (remember
  (3) "My warm clothes wore out.").
- `clothingWarmth(agent)`: 0.6 when carrying at least one `clothes`, else 1.
- `penAnimals(state, id)`: `{ hens, sheep }` of that pen (zeros if none).

**Tests**: buying a hen and tending puts it in the pen; tending with fodder after 6 h gives eggs
(fix the seed); a second tend within 6 h gives nothing; neglect for 3 days loses an animal;
breeding adds one over a few tended days (seeded); someone with clothes loses less warmth over a
night outdoors than someone without; `craft clothes` at the workshop turns 3 wool into 1 clothes.

**Mock** (`plan`): with a finished pen of one's own (`kind 'pen'`, owner `'you'`, no
`progress`): empty pen (`animals` all 0 or missing) and money ≥ 2 × the known hen price → buy 2
hens, then `tend_animals` (roll < 0.3); otherwise `tend_animals` (roll < 0.35). With ≥ 3 wool →
`craft clothes`. In autumn or winter with no clothes, money ≥ the known clothes price and roll <
0.1 → buy 1 clothes.

## 5. Own market stalls — `stalls.ts`

Files: `packages/sim/src/stalls.ts`, `packages/sim/src/stalls.test.ts`,
`packages/brain/src/mockVillage/stalls.ts`.

A stall (`kind 'stall'`, 2×1, no door) is built with `build {building: 'stall'}`. Its goods are
in `state.stalls[stallId].stock[item] = { quantity, price }` (create the entry lazily).

- The agent's own stall = the first usable stall (`usable`) they own.
- `stock_stall {item, quantity, price}`: own stall (else fail "I have no market stall."); walk
  there; move `min(quantity, have)` (0 → fail "I have no bread to put on the stall.") from the bag
  to the stall and set that item's price; emit `stall` "X put 3 bread on their stall at 9 coins
  each." (2); remember (2); refresh `agent.knowledge[id].lastSeenForSale`; rest 5.
- `take_from_stall {item, quantity}`: own stall; walk there; move back `min(quantity, stock)`
  (0 → fail); delete the item's entry at 0.
- `buy_from_stall {objectId, item, quantity}`: must be a usable stall (else fail "There's no
  stall there." / "That stall can't be used now."); not one's own (fail "That's my own stall.");
  walk there; `qty = min(quantity, stock, floor(money / price))`; none → fail "The stall had no
  eggs." or "I couldn't afford eggs (9 coins each; I have 4)." The coins go to the first living
  owner (no living owner → fail "Nobody minds that stall any more."). The owner remembers (3)
  "BUYER bought 2 eggs at my stall for 18 coins." and `train(owner, 'trading', 0.2)`; the buyer
  remembers (2); emit `stall` "X bought 2 eggs at Y's stall for 18 coins." (2); refresh the
  buyer's `lastSeenForSale`; rest 5.
- `stallListing(state, id)`: `[{ item, quantity, price }]` with quantity > 0, sorted by item.

**Tests**: stocking moves goods and sets the price; buying moves coins to the owner and goods to
the buyer, limited by stock and money; can't buy at one's own stall; taking back; a passer-by's
perception shows `forSale` after `look`.

**Mock**: `plan` — a trader or baker with a finished stall of their own and more than 3 of a
good (bread, vegetables, fish, eggs, wool, clothes, planks, stone) → `stock_stall` the surplus at
(known market buy price − 1, at least 1) (roll < 0.3). Anyone with fewer than 4 food units who
knows a stall selling food at or below the known market buy price, with the money → `buy_from_stall`
2 of it (roll < 0.3).

## 6. Hiring for a wage — `jobs.ts`

Files: `packages/sim/src/jobs.ts`, `packages/sim/src/jobs.test.ts`,
`packages/brain/src/mockVillage/jobs.ts`.

- `hire {agentId, wage, days}` (grown-ups): the other must be alive, not oneself, 13 or older
  (else fail "NAME is too young to work for me."), not already working for them (fail); the
  employer needs at least one day's wage (fail "I can't afford to pay a wage."). `approach(...,
TALK_RANGE, 'speak with')`. Replace any earlier job request between the two, then push
  `{ kind: 'job', from, to, tick, terms: { wage, days } }`. Speech bubble "Will you work for me?
  W coins a day, for D days." Emit `job` (2); both remember (4); `job_offer` trigger for the
  other. Rest 3.
- `respond_job {fromId, accept}`: find the request (else fail "That offer is no longer open.");
  remove it. Declined: both remember (4), the employer gets `job_answered` (false). Accepted:
  push `{ id: 'j' + nextContractNum++, employer, worker, wage, startTick: tick, endTick: tick +
days * TICKS_PER_DAY, lastPaidDay: today - 1 }`; emit `job` "Y agreed to work for X for W coins
  a day." (3); both remember (5); `feel` trust +3 both ways; employer gets `job_answered` (true).
- `end_job {agentId}`: an agreement between the two either way round (else fail "We have no work
  agreement."); remove it; both remember (4); the other gets `job_ended` (reason "NAME ended
  it"); emit `job` (2).
- `jobsTick(ctx)`: on the hour (`tick % 60 === 0`) drop agreements whose `endTick` has passed
  (both remember; the worker gets `job_ended` "the agreed days are up") or where either person
  died (the living one remembers). At 20:00 each day pay every agreement not yet paid today:
  employer has the wage → move it, `lastPaidDay = today`, both remember (2), emit `job` (1);
  can't pay → the agreement ends: the worker remembers (6) "NAME couldn't pay my wage.",
  `feel(worker, employer, tick, { trust: -15 })`, `job_ended` "they could not pay"; the employer
  remembers (5).
- `jobsFor(state, agent)`: their agreements as `JobView` (`untilDay = tickToClock(endTick).day`,
  names via `nameAsKnown`).

**Tests**: hire → `job_offer` → accept creates the agreement; 20:00 pays the wage; an employer
without money loses the worker; `end_job`; the agreement lapses after its days; a death ends it;
too young.

**Mock**: `reply` — on `job_offer`: accept when the wage is at least 4 or money < 15, else decline.
`plan` — a baker, farmer or carpenter with ≥ 60 coins who employs nobody (no `jobs` with role
`employer`) and roll < 0.03 → hire the nearest visible person they know by name (not a stranger)
for 5 coins a day, 3 days. A worker (role `worker`) with more than 4 of a good and roll < 0.1 →
`give` 2 of it to the employer.

## 7. Meetings, rules, a leader and the purse — `governance.ts`

Files: `packages/sim/src/governance.ts`, `packages/sim/src/governance.test.ts`,
`packages/brain/src/mockVillage/governance.ts`.

Meetings are held at the town market (the first `market` object). One meeting at a time.

- `call_meeting {topic}`: fail if a meeting is already called ("A meeting has already been
  called."). Push `{ id: 'm' + nextMeetingNum++, caller, topic, placeId: market.id, startTick:
tick + 60, endTick: tick + 150, proposals: [], attendees: [] }`. The caller and everyone alive,
  awake, outdoors within 12 tiles hear it: add the id to `knownMeetings`, remember (4) "NAME
  called a village meeting at the market about “TOPIC”, in an hour."; those 13 or older get a
  `meeting_called` trigger (`place` = the market's name, `startsInMinutes` 60). Speech bubble on
  the caller; emit `meeting` (4); rest 3.
- `governanceTick(ctx)` (keep it cheap: return at once when there are no meetings, except the
  levy below):
  - At `startTick`: attendees = living, awake, outdoors people aged 13+ within 4 tiles of the
    market (`distanceToObject`). Fewer than 2 → the meeting fizzles: emit `meeting` "Nobody came
    to the meeting about TOPIC." (2), the caller remembers (4), remove it. Otherwise each attendee
    gets `meeting_open` and remembers (3); emit `meeting` "The village meeting about TOPIC began
    with N people." (3).
  - While open, every 10 ticks newcomers within 4 tiles join (and get `meeting_open`).
  - At `endTick`: for each proposal count the votes of attendees: passed when yes > no and yes
    ≥ 2. Passed → push to `state.rules` (`id 'r' + nextRuleNum++`, text, tax, leaderId, proposer,
    passedTick); a passed `leaderId` who is alive becomes `state.leaderId`; emit `rule_passed`
    "The village agreed: TEXT" (4). Failed → emit `meeting` "The village voted down: TEXT" (2).
    Every attendee remembers each outcome (6 passed / 4 failed) and gets their `noticeBoard`
    refreshed. Remove the meeting and drop its id from everyone's `knownMeetings`.
  - The levy: at 06:00 each day, if the latest rule with `tax` defined has tax > 0, every living
    person aged 18+ with at least that much pays it into `state.treasury` (those who can't
    remember (3) "I couldn't pay the village levy."); emit `treasury` "N people paid the levy (C
    coins)." (2) when anyone paid.
- `propose_rule {text, tax?, leaderId?}`: only at an open meeting within 4 tiles of the market
  (else fail "There is no meeting here to propose that at."); at most 5 proposals per meeting
  (fail "There is no time left for more proposals."); a `leaderId` must be a living grown-up
  (fail). Push `{ id: 'p' + nextProposalNum++, by, text, tax, leaderId, votes: { [agent.id]: true } }`;
  add the agent to attendees; speech bubble; emit `meeting` "X proposed: TEXT" (3); every other
  attendee who is awake and within 4 tiles remembers (4) and gets `rule_proposed`.
- `vote {proposalId, accept}`: the proposal must be in an open meeting within 4 tiles (else fail
  "There is no such proposal here."); `votes[agent.id] = accept` (a new vote replaces the old);
  add to attendees; emit `meeting` (1); remember (2).
- `pay_from_treasury {agentId, coins}`: only `state.leaderId` (fail "Only the village leader can
  spend the village purse."); coins ≤ treasury (fail "The purse doesn't hold that much.");
  paying someone else needs `approach(..., TALK_RANGE, 'pay')`; move the coins; emit `treasury`
  "X paid N coins from the village purse to Y." (4); both remember (5); witnesses remember (4).
- `readNoticeBoard(state, agent)`: `agent.noticeBoard = { tick, ruleIds, leaderId, treasury,
taxPerDay }` (current values) and add any called meeting ids to `knownMeetings` (the meeting
  is posted on the board).
- `villageKnowledge(state, agent)`: undefined when they've never read the board, know no
  meeting and aren't at an open one. Else `VillageKnowledge`: leader and rules from their
  `noticeBoard` (rules that still exist; leader only if alive, named via `nameAsKnown`);
  `treasury`/`taxPerDay` from the board (null/0 if never read); `meetings` = known meetings still
  in `state.meetings` (`startsInMinutes = startTick - tick`, `open = tick >= startTick`);
  `proposals` = those of the open meeting they are within 4 tiles of (`voted` = they voted;
  `leaderName` via `nameAsKnown`). Called for every perception, so keep it cheap.

**Tests**: calling a meeting reaches people nearby (knownMeetings + trigger); the meeting opens
with attendees and fizzles with fewer than 2; a proposal passes with 2 yes votes at the end and
becomes a rule; a leader proposal elects the leader; the levy is collected at 06:00; only the
leader can pay from the purse; reading the notice board updates `village` in the perception.

**Mock**: `reply` — `meeting_called`: a grown-up with roll < 0.6 goes to the meeting place
(`village.meetings` gives `placeId`) and rests 90 minutes there. `meeting_open`: no proposals yet
and agreeableness > 55 → propose one of a few rules ("Nobody takes crops from another's field.",
"Every grown-up pays 1 coin a day into the village purse." with tax 1, "Elect [the most trusted
person they know]" with leader); else vote on any proposal they haven't voted on. `rule_proposed`:
vote yes when agreeableness > 40 or roll < 0.5, but no on a tax over 2 when money < 20. `plan` —
the leader with a purse of 20+ and roll < 0.05 pays 5 coins to the poorest-looking person they
know who is visible (or skip); otherwise an extraverted grown-up (extraversion > 70) who knows of
no meeting and roll < 0.004 calls one ("How to share the fields", "Building a new well", "A
village purse").

## 8. The observer's view — `apps/web`

Files: `apps/web/src/map/pixelArt.ts`, `apps/web/src/map/renderer.ts`,
`apps/web/src/screens/WorldScreen.tsx`, `apps/web/src/components/VillagePanel.tsx` (new),
`apps/web/src/components/WorldEventsDialog.tsx`, `apps/web/src/styles.css`,
`tests/e2e/worlds.spec.ts`.

- Sprites (procedural, same style as the others): `pen` (48×48: wooden fence on all sides,
  straw floor, a gate at the bottom middle, two hens and a sheep), `stall` (32×20: a small
  counter with a striped awning), `plot` (64×48: bare tilled dirt with a few stumps and stones,
  for a field still being cleared). In `spriteFor`: `pen` → `'pen'`, `stall` → `'stall'`, a
  `field` with `progress !== undefined` → `'plot'` (finished fields stay ground tiles). A
  building with `stone: true` gets a cool grey tint (when not burnt or unfinished).
- `OBJECT_BLURBS`: pen ("Hens and sheep live here. Tend them for eggs and wool."), stall ("A
  villager's own stall: their goods at their prices."), rock ("Quarry it for stone."), well
  ("Fresh drinking water. New wells are built of stone."), field ("Farmland. Common fields
  belong to everyone; cleared fields belong to whoever cleared them."). For a stall or pen in the
  details pane, show its stock / animals from the village data.
- `VillagePanel` (pattern: `MarketPanel`, refresh each in-game hour): leader, village purse and
  levy; rules; meetings with proposals and yes/no counts; stalls with their goods and prices;
  pens with hens/sheep/wool; owned fields with their crop; work agreements (employer → worker,
  wage, until day). Empty sections show a short muted line ("No rules yet."). Show it in the
  World tab under the market, headed "Village".
- `WorldEventsDialog`: fire targets include pens and stalls, and leave out stone buildings.
- e2e: in the existing worlds spec (or a new test there), open a world and check the World tab
  shows the "Village" heading and "No rules yet.".

Check with `npm run typecheck`, `npx eslint apps/web`, `npx vitest run apps/web`, and
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`.
