import {
  BUILDINGS,
  STONEWORK_STONE,
  type BuildingKind,
  type Intent,
  type MapObject,
  TICKS_PER_HOUR,
  type Point,
} from '@aw/shared';
import { fullName, remember, type Agent } from './agent.ts';
import { emit, fail, type Ctx } from './engine.ts';
import { clearPlot, findFreePlot, nextObjectId } from './land.ts';
import { observeWork, train } from './life.ts';
import { interactionTiles, invalidateMapCaches, isAt } from './spatial.ts';
import { findAgent } from './world.ts';

// ------------------------------------------------------------------ building

type BuildIntent = Extract<Intent, { type: 'build' | 'build_house' }>;

/** Building skill needed to start a new site, by kind (finishing one needs none). */
function skillToStart(kind: BuildingKind): number {
  return kind === 'bakery' || kind === 'workshop' ? 20 : 10;
}

function takeItem(agent: Agent, item: 'planks' | 'stone', n: number): void {
  agent.inventory[item] = (agent.inventory[item] ?? 0) - n;
  if (!agent.inventory[item]) delete agent.inventory[item];
}

/** Where a new building goes: a pen by the owner's home, everything else by the town market. */
function siteAnchor(ctx: Ctx, agent: Agent, kind: BuildingKind): Point {
  const { state } = ctx;
  if (kind === 'pen') {
    const home = agent.homeId ? state.map.objects.find((o) => o.id === agent.homeId) : undefined;
    if (home) return { x: home.x, y: home.y };
    return { x: agent.x, y: agent.y };
  }
  const market = state.map.objects.find((o) => o.kind === 'market');
  return market ? { x: market.x, y: market.y } : { x: agent.x, y: agent.y };
}

/**
 * An unfinished (or burnt) building of one's own to carry on with: one of this kind, or, for
 * `build_house`, any burnt building.
 */
function findSite(
  ctx: Ctx,
  agent: Agent,
  kind: BuildingKind,
  anyBurnt: boolean,
): MapObject | undefined {
  const { state } = ctx;
  return state.map.objects.find(
    (o) =>
      o.kind in BUILDINGS &&
      (o.progress ?? 1) < 1 &&
      (state.owners[o.id]?.includes(agent.id) ?? false) &&
      (o.kind === kind || (anyBurnt && o.burntTick !== undefined)),
  );
}

export function startBuild(ctx: Ctx, agent: Agent, intent: BuildIntent, arrived: boolean): void {
  const { state } = ctx;
  const { map } = state;
  const kind: BuildingKind = intent.type === 'build_house' ? 'house' : intent.building;
  const info = BUILDINGS[kind];
  const label = info.label.toLowerCase();
  // Carry on first: an unfinished or burnt building of this kind (build_house also takes any
  // burnt building of one's own).
  let site = findSite(ctx, agent, kind, intent.type === 'build_house');
  if (!site) {
    if (agent.skills.building < skillToStart(kind))
      return fail(ctx, agent, `I don't know enough about building to start a ${label}.`);
    if ((agent.inventory.planks ?? 0) < info.planks)
      return fail(ctx, agent, `I need ${info.planks} planks to start building.`);
    if ((agent.inventory.stone ?? 0) < info.stone)
      return fail(ctx, agent, `I need ${info.stone} stone to start building.`);
    const spot = findFreePlot(state, siteAnchor(ctx, agent, kind), info.w, info.h, info.door);
    if (!spot) return fail(ctx, agent, "There's no free land left to build on.");
    clearPlot(state, spot, info.w, info.h);
    const id = nextObjectId(state, kind);
    site = {
      id,
      kind,
      x: spot.x,
      y: spot.y,
      w: info.w,
      h: info.h,
      name: `${info.label} ${id.slice(kind.length + 1)}`,
      progress: 0,
      workDone: 0,
      stoneWork: 0,
      ...(info.door
        ? { door: { x: spot.x + Math.floor(info.w / 2), y: spot.y + info.h - 1 } }
        : {}),
    };
    map.objects.push(site);
    state.owners[id] = [agent.id];
    agent.knowledge[id] = { lastSeenTick: state.tick };
    invalidateMapCaches(map);
    state.mapVersion += 1;
    emit(ctx, 'built', [agent.id], `${fullName(agent)} started building ${site.name}.`, 4, [
      site.id,
    ]);
    remember(agent, state.tick, `I started building ${site.name}.`, 7);
  }
  const tiles = site.door ? [{ x: site.door.x, y: site.door.y + 1 }] : interactionTiles(map, site);
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, intent, site.name ?? 'the building site');
    return;
  }
  if ((agent.inventory.planks ?? 0) < info.planks)
    return fail(ctx, agent, `I need ${info.planks} planks for the next stretch of building.`);
  if ((agent.inventory.stone ?? 0) < info.stone)
    return fail(ctx, agent, `I need ${info.stone} stone for the next stretch of building.`);
  if (info.planks) takeItem(agent, 'planks', info.planks);
  if (info.stone) takeItem(agent, 'stone', info.stone);
  // Stonework: a stretch of a wooden building built with spare stone.
  if (info.stone === 0 && (agent.inventory.stone ?? 0) >= STONEWORK_STONE) {
    takeItem(agent, 'stone', STONEWORK_STONE);
    site.stoneWork = (site.stoneWork ?? 0) + 1;
  }
  site.workDone = (site.workDone ?? 0) + 1;
  agent.facing = 'up';
  agent.action = { type: 'build', objectId: site.id, until: state.tick + 60 };
}

export function finishBuild(ctx: Ctx, agent: Agent, objectId: string): void {
  const { state } = ctx;
  agent.action = null;
  const site = state.map.objects.find((o) => o.id === objectId);
  if (!site || site.progress === undefined || !(site.kind in BUILDINGS)) return;
  const info = BUILDINGS[site.kind as BuildingKind];
  site.progress = Math.min(
    1,
    site.progress + (0.1 * (0.5 + agent.skills.building / 100)) / info.work,
  );
  train(agent, 'building', 0.6);
  observeWork(state, agent, 'building');
  state.mapVersion += 1;
  if (site.progress >= 1) {
    delete site.progress;
    // Stone-built: wells always, anything else once most of its work used stone.
    const workDone = site.workDone ?? 0;
    if (site.kind === 'well' || (workDone > 0 && (site.stoneWork ?? 0) * 2 >= workDone))
      site.stone = true;
    if (site.kind === 'pen' && !state.pens[site.id])
      state.pens[site.id] = {
        hens: 0,
        sheep: 0,
        wool: 0,
        lastTendedTick: state.tick - 6 * TICKS_PER_HOUR,
      };
    if (site.kind === 'stall' && !state.stalls[site.id]) state.stalls[site.id] = { stock: {} };
    if (site.burntTick !== undefined) {
      delete site.burntTick;
      emit(ctx, 'built', [agent.id], `${fullName(agent)} finished rebuilding ${site.name}!`, 5, [
        site.id,
      ]);
      remember(agent, state.tick, `I rebuilt ${site.name} after the fire.`, 8);
      return;
    }
    const partner = agent.partnerId ? findAgent(state, agent.partnerId) : undefined;
    if (partner && !state.owners[site.id]!.includes(partner.id))
      state.owners[site.id]!.push(partner.id);
    emit(ctx, 'built', [agent.id], `${fullName(agent)} finished building ${site.name}!`, 5, [
      site.id,
    ]);
    remember(agent, state.tick, `I finished building ${site.name}. It's mine.`, 8);
    if (!agent.homeId && site.kind === 'house') agent.homeId = site.id;
  } else {
    const pct = Math.round(site.progress * 100);
    emit(ctx, 'built', [agent.id], `${fullName(agent)} worked on ${site.name} (${pct}% done).`, 2, [
      site.id,
    ]);
    remember(agent, state.tick, `I worked on ${site.name} (${pct}% done).`, 2);
  }
}
