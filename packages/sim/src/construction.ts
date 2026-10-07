import { type Intent } from '@aw/shared';
import { fullName, remember, type Agent } from './agent.ts';
import { emit, fail, type Ctx } from './engine.ts';
import { clearPlot, findFreePlot, nextObjectId } from './land.ts';
import { observeWork, train } from './life.ts';
import { invalidateMapCaches, isAt } from './spatial.ts';
import { findAgent } from './world.ts';

// ------------------------------------------------------------------ building

/**
 * GROUNDWORK STUB (house only, the old `build_house` behaviour). The construction teammate
 * generalises this to every kind in `BUILDINGS` — see docs/plans/growing-the-village.md.
 */

const HOUSE_PLANKS_PER_SESSION = 3;

type BuildIntent = Extract<Intent, { type: 'build' | 'build_house' }>;

export function startBuild(ctx: Ctx, agent: Agent, intent: BuildIntent, arrived: boolean): void {
  const { state } = ctx;
  const { map } = state;
  // Carry on with (or rebuild) a building of one's own before starting a new house.
  let site = map.objects.find(
    (o) =>
      (o.kind === 'house' || o.burntTick !== undefined) &&
      (o.progress ?? 1) < 1 &&
      state.owners[o.id]?.includes(agent.id),
  );
  if (!site) {
    if (agent.skills.building < 10)
      return fail(ctx, agent, "I don't know enough about building to start a house.");
    if ((agent.inventory.planks ?? 0) < HOUSE_PLANKS_PER_SESSION) {
      return fail(
        ctx,
        agent,
        `I need at least ${HOUSE_PLANKS_PER_SESSION} planks to start building.`,
      );
    }
    const market = map.objects.find((o) => o.kind === 'market') ?? { x: agent.x, y: agent.y };
    const spot = findFreePlot(state, { x: market.x, y: market.y }, 3, 3, true);
    if (!spot) return fail(ctx, agent, "There's no free land left to build on.");
    clearPlot(state, spot, 3, 3);
    const id = nextObjectId(state, 'house');
    site = {
      id,
      kind: 'house',
      x: spot.x,
      y: spot.y,
      w: 3,
      h: 3,
      name: `House ${id.split('-')[1]}`,
      door: { x: spot.x + 1, y: spot.y + 2 },
      progress: 0,
    };
    map.objects.push(site);
    state.owners[id] = [agent.id];
    agent.knowledge[id] = { lastSeenTick: state.tick };
    invalidateMapCaches(map);
    state.mapVersion += 1;
    emit(ctx, 'built', [agent.id], `${fullName(agent)} started building ${site.name}.`, 4);
    remember(agent, state.tick, `I started building a house (${site.name}).`, 7);
  }
  const door = site.door ?? { x: site.x + Math.floor(site.w / 2), y: site.y + site.h - 1 };
  const tiles = [{ x: door.x, y: door.y + 1 }];
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, intent, site.name ?? 'the building site');
    return;
  }
  if ((agent.inventory.planks ?? 0) < HOUSE_PLANKS_PER_SESSION) {
    return fail(
      ctx,
      agent,
      `I need ${HOUSE_PLANKS_PER_SESSION} planks for the next stretch of building.`,
    );
  }
  agent.inventory.planks! -= HOUSE_PLANKS_PER_SESSION;
  if (!agent.inventory.planks) delete agent.inventory.planks;
  agent.facing = 'up';
  agent.action = { type: 'build', objectId: site.id, until: state.tick + 60 };
}

export function finishBuild(ctx: Ctx, agent: Agent, objectId: string): void {
  const { state } = ctx;
  agent.action = null;
  const site = state.map.objects.find((o) => o.id === objectId);
  if (!site || site.progress === undefined) return;
  site.progress = Math.min(1, site.progress + 0.1 * (0.5 + agent.skills.building / 100));
  train(agent, 'building', 0.6);
  observeWork(state, agent, 'building');
  state.mapVersion += 1;
  if (site.progress >= 1) {
    delete site.progress;
    if (site.burntTick !== undefined) {
      delete site.burntTick;
      emit(ctx, 'built', [agent.id], `${fullName(agent)} finished rebuilding ${site.name}!`, 5);
      remember(agent, state.tick, `I rebuilt ${site.name} after the fire.`, 8);
      return;
    }
    const partner = agent.partnerId ? findAgent(state, agent.partnerId) : undefined;
    if (partner && !state.owners[site.id]!.includes(partner.id))
      state.owners[site.id]!.push(partner.id);
    emit(ctx, 'built', [agent.id], `${fullName(agent)} finished building ${site.name}!`, 5);
    remember(agent, state.tick, `I finished building ${site.name}. It's mine.`, 8);
    if (!agent.homeId && site.kind === 'house') agent.homeId = site.id;
  } else {
    remember(
      agent,
      state.tick,
      `I worked on ${site.name} (${Math.round(site.progress * 100)}% done).`,
      2,
    );
  }
}
