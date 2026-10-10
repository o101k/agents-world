# Faster map rendering — plan

Owner request (2026-10-09): "Sometimes when there are many people they get stuck and it needs some
time to print… I want to see a super fast rendering of the world and when zooming in/out and moving
around." Measure first, fix only what the measurements show, plan first, build the separate
parts with workers in parallel, review until `npm run check` and e2e pass.

## How it was measured

`npm run bench:render` (new, `tests/perf/bench-render.mjs`): a generated village of 150 adults and
100 children on the huge (128×128) map, Mock brains, lived 6 in-game hours, then opened in headless
Chromium at 1440×900 and run at 60× for four phases: whole map in view, zoomed in to 2× (names and
speech bubbles), panning with the trackpad, and pinch-zooming in and out. Medians of 3 runs.

Headless Chromium draws WebGL in software and reads each frame back for its software compositor
(70% of its main thread is that readback), so frames per second here say little about a Mac with a
GPU. What carries over: JavaScript time on the main thread (per frame, per second, per map update)
and the GPU work asked for (draw calls, texture uploads).

## What the measurements show (before)

| What                               | Before (median of 3)                   |
| ---------------------------------- | -------------------------------------- |
| One map update (a building grows)  | **200–300 ms** of blocked main thread  |
| Map updates while playing at 60×   | about 1 every 1.5 s, 1–2 fetches/s     |
| JavaScript per frame               | 7–10 ms (p95 17–68 ms)                 |
| Script time per second             | 150–360 ms                             |
| Live-update handling per second    | 30–40 ms (store, React, people)        |
| First map frame after opening      | 1.1 s, with a 0.9 s blocking task      |
| Draw calls per frame               | 9–18 (low: not a problem)              |

From the CPU profile:

1. **Map updates rebuild everything.** Every stretch of building work or field clearing bumps the
   map version. The page then re-downloads the whole world view (~600 KB, all people included)
   and `buildScene` throws away and recreates all 16k ground sprites, re-renders 16 cached chunk
   textures, and recreates every tree, bush and house sprite. Removing the old object sprites one
   by one is quadratic (`removeChild` = indexOf + splice each): 475 ms of self time on its own.
   This is the "gets stuck" pause.
2. **Every frame rebuilds the whole draw list.** Walking people change depth (zIndex) every frame,
   which makes Pixi re-sort and rebuild the instructions for the whole scene (`_buildInstructions`
   ~1 s over the run), and Pixi's culler walks every sprite every frame (~0.6 s), using last frame's
   camera (things at the edge pop in a frame late while panning).
3. **Each pan or zoom event runs a full update on the spot**, so a trackpad that sends several
   events per frame does the per-person work several times per frame.
4. **Pixi's pointer hit-testing runs although the app doesn't use it** (it listens to DOM events).
5. **React re-renders the whole People list (250 rows with portraits) on every frame**, and the
   whole timeline on every batch of events: ~1.75 s over the run.
6. **Who is inside which house** recomputes room spots for every house every frame and loops over
   every map object: 0.4 s over the run.

Not worth changing (measured small): speech-bubble layout (38 ms over the run), night tint,
fires and rain, the selection box. Draw calls are already low, so a shared character atlas or
bitmap-font labels would not help and are left out.

## The changes

Groundwork (done, no change in behaviour, screenshots pixel-identical): the renderer is split into
`ground.ts` (GroundLayer), `objectLayer.ts` (ObjectLayer), `people.ts` (PeopleLayer) and
`renderer.ts` (scene, camera, input, effects). Map updates are timed as `aw:setMap`.

| Part | Who | Files | What |
| --- | --- | --- | --- |
| A. Ground | worker | `ground.ts`, new `groundPaint.ts` + test | Paint each 32×32 chunk straight onto a canvas (no per-tile sprites, no texture caching pass). On a map update repaint only the chunks whose tiles, shore border or fields changed. Hide off-screen chunks. |
| B. Objects | worker | `objectLayer.ts`, new `objectDiff.ts` + test | On a map update add, change or remove only the objects that changed (no quadratic removal). O(1) lookups by id and by door. Room spots cached per house and head count; only houses whose occupancy changed are touched. Hide off-screen objects. |
| C. Lists | worker | `PeopleList.tsx`, `Portrait.tsx`, `EventLog.tsx` | Memoised rows, so a frame re-renders only the people whose line changed; portraits painted once per look; timeline rows render once. |
| D. Map fetches | worker | shared `protocol.ts`, server `worldManager.ts` + `routes/worlds.ts` + test, web `api.ts` + `WorldScreen.tsx` | A light `GET /api/worlds/:id/map` (map + owners, no people). At most one map fetch in flight; a newer version fetches again when it lands; never apply an older map over a newer one. |
| E. Frame loop | lead | `renderer.ts`, `people.ts` | Camera input only moves the camera; the per-person work runs once per animation frame. Own culling with the current camera (no more one-frame-late pop-in), Pixi's culler and pointer hit-testing off. Ground, world and overlay as separate render groups, and people's depth changes only when they cross a tile row, so Pixi re-sorts far less. Off-screen people skip label and bubble work. Night tint redrawn only when it changes. |

After integration: `npm run check`, e2e, the benchmark 3× (after), and screenshots at the same tick
and camera compared with before.

## Round 1 results (median of 3, same tick and camera)

| What                              | Before            | After round 1   |
| --------------------------------- | ----------------- | --------------- |
| One map update                    | 200–300 ms        | 13–15 ms        |
| JavaScript per frame, p50 / p95   | 7–10 / 17–68 ms   | 2–4 / 5–8 ms    |
| Script time per second            | 150–360 ms        | 70–165 ms       |
| Longest blocking task while playing | 240–330 ms      | 90–190 ms       |
| Frames per second (software GL)   | 5.5–6.7           | 13–17           |

## Round 2 (owner, 2026-10-09: "check the code and understand what could make it faster… go all out")

Profile of round 1 (unminified build, 30 s of play/pan/zoom), JavaScript only:

1. **Pixi rebuilding the world's draw list: ~1 s.** Objects and people share one depth-sorted
   container of ~8,600 sprites (8,043 of them trees). Whenever anyone crosses a tile row Pixi
   re-sorts and rebuilds the whole list. Browser micro-benchmark (same Pixi, 8,300 static
   sprites + 250 walkers): **3–3.5 ms per frame** single container; horizontal bands of rows as
   separate render groups: no better (2.5 ms, worse with smaller bands); **layered world 0.3 ms**.
2. **React re-rendering on every live frame: ~0.6–0.9 s** (people list rows, timeline, clock),
   mostly React's own reconciling and DOM text updates, 15 times a second.
3. **Map updates: ~0.5 s** (each ~11 ms): look keys computed twice for all 8,400 objects,
   changed objects destroyed and recreated (one splice each), the occluder grid rebuilt from
   scratch, the id/door maps rebuilt.
4. **Frames' JSON parse: ~0.2 s.** Text labels and bubbles: measured as canvas redraws plus
   texture uploads (20–35 uploads/s zoomed in), and the first zoom past 2× renders every
   visible name label at once.

### The layered world (why it is exact)

Draw order: ground → **under** (objects whose sprite fits inside their footprint: houses,
bakery, workshop, market, pen, well, dock, bush, rock, fields being cleared; graves last) →
**people** (sorted among themselves by row) → **over** (objects whose sprite rises above their
footprint: trees, pines, market stalls). No sorting between layers is needed:

- A person can only overlap an *under* object from in front of it (the row below, by the 1 px
  above their head) or by standing in its doorway or inside it. All three must draw the
  person on top, which the layer order does.
- A person can only overlap the part of an *over* object above its footprint from behind (they
  stand in a higher row), which must draw the object on top. The footprint itself is solid
  (trees, stalls block walking), so the only other overlap is the 1 px above the head of
  someone standing just below it: the trunk's bottom pixel now covers that 1 px of outline.
- Under and over layers are static render groups: Pixi sorts and builds them once and only
  again on a map change. Only the 250-person layer rebuilds when people cross rows. No
  per-object culling (it toggled visibility, i.e. rebuilt, on every pan frame; the GPU draws
  8,400 quads trivially).

### Round 2 parts

| Part | Who | Files | What |
| --- | --- | --- | --- |
| F. Layered world | lead | `renderer.ts`, `objectLayer.ts` (placement only), `people.ts` (containers only) | Under/people/over render groups as above; the occluder grid holds only over-layer objects; objects stop culling; people's appearance compared field by field instead of JSON per frame. |
| G. Map updates in place | worker | `objectLayer.ts`, `objectDiff.ts` + tests | Changed objects keep their sprite (texture, position, tint, alpha, layer updated in place); look keys computed once per object per update; occluder grid and id/door maps updated only for what changed. |
| H. Bitmap text | worker | `people.ts` | Name labels, "z z"/"…" and speech bubbles as `BitmapText` from installed dynamic bitmap fonts (glyph atlas, no canvas redraw or upload per change); same look. |
| I. Calmer React | worker | `PeopleList.tsx`, `EventLog.tsx`, new `throttle.ts` and `useThrottledWorld.ts` | The people list and the timeline follow live updates at most 4 times a second (selection and replay immediately). |
| J. Pixel art painted in memory | worker | `pixelArt.ts`, new `pixelBuffer.ts`, `ground.ts`, `groundPaint.ts` + tests | Page-load profile: painting sprites with one `fillRect` per pixel (a CSS colour parsed each time) and ground chunks with one `drawImage` per tile layer. Paint into byte arrays and put each finished image on its canvas once. |

### Round 2 results

Medians of three runs each (same seed, paused at the same tick; headless Chromium draws in
software, so compare JavaScript time, not frames per second):

| | master | round 1 | round 2 |
| --- | --- | --- | --- |
| Load: first frame with the map | 1,147 ms | 1,026 ms | 617 ms |
| Load: longest freeze | 856 ms | 363 ms | 288 ms |
| Whole map: JS per frame p50 / p95 | 7.8 / 43.7 ms | 4.2 / 6.6 ms | 1.4 / 2.5 ms |
| Whole map: JS per second | 300 ms | 152 ms | 82 ms |
| Map update (building work, fields…) | 199 ms | 15 ms | 8 ms |
| Zoomed in 2×: JS per frame p95 | 16.6 ms | 6.8 ms | 4.8 ms |
| Zoomed in 2×: texture uploads per second | 11 | 23 | 0 |
| Panning: JS per frame p50 / p95 | 9.7 / 31.2 ms | 4.3 / 8.0 ms | 2.3 / 5.0 ms |
| Panning: texture uploads per second | 34 | 34 | 0.8 |
| Zooming in and out: JS per frame p50 / p95 | 9.3 / 67.7 ms | 3.2 / 5.8 ms | 1.4 / 3.3 ms |
| Frames per second (software, see above) | 5.5–6.7 | 13–16.5 | 12–20 |

Zoomed in, the software frame rate is slightly lower than round 1 (11.8 vs 13.2): objects off
screen are no longer hidden, and a software rasteriser pays a little for each. On a real
graphics card 8,400 static quads cost next to nothing (not measured on real hardware).

Per part:

- F (layered world), one run against round 1's median: JavaScript per frame p50 4.2 → 1.7 ms
  (whole map), 4.3 → 2.7 ms (panning), 3.2 → 1.4 ms (zooming); script time per second down
  20–25 %. Screenshots: zoomed-in identical to master; whole-map differs only in walking
  frames, plus one fix: a field being cleared was drawn over (and faded above) the person
  working on it, now under them.
- G (map updates in place): map update median 15 → 8 ms.
- H (bitmap text): texture uploads while zoomed in or panning 23–34 per second → 0–1. Labels
  match the old ones to within a pixel. Kerning is skipped (Pixi measures it pair by pair, a
  stall at load).
- I (calmer lists): live-update handling per second 20–25 → 15–19 ms.
- J (painting in memory): first frame with the map ~1,000 → ~620 ms. Screenshots match except
  1-level rounding in half-transparent shadows.
- Checked: `npm run check` (322 tests), Playwright e2e 8/8, names still drawn after switching
  worlds (renderer destroyed and rebuilt; the fonts outlive it).
