import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  AgingRequest,
  AskRequest,
  BrainConfigSchema,
  CapRequest,
  CastPreviewRequest,
  ControlRequest,
  DefaultBrainRequest,
  EventsQuery,
  ObjectHistoryQuery,
  SetBrainsRequest,
  SpawnRequest,
  WorldEventRequest,
  ReplayQuery,
  RecordQuery,
  type AskResponse,
  type InterviewsResponse,
  type RecordResponse,
  type BrainsResponse,
  type CastPreviewResponse,
  type ObjectHistoryResponse,
  type ReplayResponse,
  type StoryResponse,
  type CallsResponse,
  type AgentResponse,
  type EventsResponse,
  type WorldResponse,
  type WorldsResponse,
} from '@aw/shared';
import type { Hub } from '../hub.ts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type WorldManager,
} from '../worlds/worldManager.ts';

type IdParams = { Params: { id: string } };

export function registerWorldRoutes(app: FastifyInstance, worlds: WorldManager, hub: Hub): void {
  const snapshot = (): WorldsResponse => ({
    worlds: worlds.list(),
    activeWorldId: worlds.activeWorldId,
  });
  const notifyChanged = () => hub.broadcast({ type: 'worlds_changed', ...snapshot() });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    app.log.error(err);
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    const status =
      typeof rawStatus === 'number' &&
      Number.isInteger(rawStatus) &&
      rawStatus >= 400 &&
      rawStatus <= 599
        ? rawStatus
        : 500;
    return reply
      .code(status)
      .send({ error: status >= 400 && status < 500 ? (err as Error).message : 'Internal error' });
  });

  app.get('/api/worlds', async (): Promise<WorldsResponse> => snapshot());

  app.post('/api/worlds', async (req, reply): Promise<WorldResponse> => {
    const world = await worlds.create((req.body ?? {}) as never);
    notifyChanged();
    reply.code(201);
    return { world };
  });

  // Who a new world's starting cast will be, so brains can be picked before it's created.
  app.post('/api/cast-preview', async (req): Promise<CastPreviewResponse> =>
    worlds.previewCast(CastPreviewRequest.parse(req.body ?? {})),
  );

  app.post<IdParams>('/api/worlds/:id/activate', async (req): Promise<WorldResponse> => {
    const world = await worlds.activate(req.params.id);
    notifyChanged();
    return { world };
  });

  app.get<IdParams>('/api/worlds/:id/view', async (req) => worlds.view(req.params.id));
  app.get<IdParams>('/api/worlds/:id/map', async (req) => worlds.map(req.params.id));
  app.get<IdParams>('/api/worlds/:id/market', async (req) => worlds.market(req.params.id));
  app.get<IdParams>('/api/worlds/:id/village', async (req) => worlds.village(req.params.id));

  app.post<IdParams>('/api/worlds/:id/control', async (req) => {
    worlds.control(req.params.id, ControlRequest.parse(req.body ?? {}));
    return { runner: worlds.active!.status() };
  });

  app.get<IdParams>('/api/worlds/:id/events', async (req): Promise<EventsResponse> => {
    const q = EventsQuery.parse(req.query ?? {});
    return { events: worlds.events(req.params.id, q) };
  });

  app.get<{ Params: { id: string; agentId: string } }>(
    '/api/worlds/:id/agents/:agentId',
    async (req): Promise<AgentResponse> => ({
      agent: worlds.agent(req.params.id, req.params.agentId),
    }),
  );

  type AgentParams = { Params: { id: string; agentId: string } };

  app.put<AgentParams>('/api/worlds/:id/agents/:agentId/brain', async (req) => {
    const brain = BrainConfigSchema.parse(req.body);
    await worlds.setBrain(req.params.id, req.params.agentId, brain);
    return {
      agent: { ...worlds.agent(req.params.id, req.params.agentId), brain: { ...brain } },
    };
  });

  app.get<AgentParams>(
    '/api/worlds/:id/agents/:agentId/calls',
    async (req): Promise<CallsResponse> => ({
      calls: worlds.calls(req.params.id, req.params.agentId, 10),
    }),
  );

  app.get<IdParams>('/api/worlds/:id/brains', async (req): Promise<BrainsResponse> =>
    worlds.brainsView(req.params.id),
  );

  app.put<IdParams>('/api/worlds/:id/brains', async (req): Promise<BrainsResponse> => {
    const { agentIds, brain } = SetBrainsRequest.parse(req.body ?? {});
    return worlds.setBrains(req.params.id, agentIds, brain);
  });

  app.put<IdParams>('/api/worlds/:id/default-brain', async (req) => {
    const { brain, applyToAll } = DefaultBrainRequest.parse(req.body ?? {});
    await worlds.setDefaultBrain(req.params.id, brain, applyToAll);
    return { ...worlds.view(req.params.id).settings, defaultBrain: { ...brain } };
  });

  app.put<IdParams>('/api/worlds/:id/cap', async (req) => {
    worlds.setCap(req.params.id, CapRequest.parse(req.body).capUsd);
    return { runner: worlds.active!.status() };
  });

  app.put<IdParams>('/api/worlds/:id/aging', async (req) => {
    const { daysPerYear } = AgingRequest.parse(req.body ?? {});
    await worlds.setAging(req.params.id, daysPerYear);
    return { ...worlds.view(req.params.id).settings, daysPerYear };
  });

  app.get<{ Params: { id: string; agentId: string } }>(
    '/api/worlds/:id/family/:agentId',
    async (req) => worlds.familyTree(req.params.id, req.params.agentId),
  );

  app.post<IdParams>('/api/worlds/:id/spawn', async (req) =>
    worlds.spawn(req.params.id, SpawnRequest.parse(req.body)),
  );

  app.get<IdParams>('/api/worlds/:id/replay', async (req): Promise<ReplayResponse> => {
    const q = ReplayQuery.parse(req.query ?? {});
    return worlds.replay(req.params.id, q.tick, q.mapVersion);
  });

  app.get<AgentParams>(
    '/api/worlds/:id/replay/agents/:agentId',
    async (req): Promise<AgentResponse> => {
      const q = ReplayQuery.parse(req.query ?? {});
      return { agent: worlds.replayAgent(req.params.id, q.tick, req.params.agentId) };
    },
  );

  app.post<IdParams>('/api/worlds/:id/world-event', async (req) => {
    await worlds.worldEvent(req.params.id, WorldEventRequest.parse(req.body ?? {}));
    return { ok: true };
  });

  app.get<AgentParams>(
    '/api/worlds/:id/agents/:agentId/story',
    async (req): Promise<StoryResponse> => ({
      entries: worlds.story(req.params.id, req.params.agentId),
    }),
  );

  // Asking about a person: their brain answers from their record. Never changes the world.
  app.get<AgentParams>(
    '/api/worlds/:id/agents/:agentId/interviews',
    async (req): Promise<InterviewsResponse> =>
      worlds.interviews(req.params.id, req.params.agentId),
  );

  app.post<AgentParams>(
    '/api/worlds/:id/agents/:agentId/ask',
    async (req): Promise<AskResponse> => ({
      interview: await worlds.ask(
        req.params.id,
        req.params.agentId,
        AskRequest.parse(req.body ?? {}),
      ),
    }),
  );

  app.get<AgentParams>(
    '/api/worlds/:id/agents/:agentId/record',
    async (req): Promise<RecordResponse> =>
      worlds.record(req.params.id, req.params.agentId, RecordQuery.parse(req.query ?? {})),
  );

  app.get<{ Params: { id: string; objectId: string } }>(
    '/api/worlds/:id/objects/:objectId/history',
    async (req): Promise<ObjectHistoryResponse> => {
      const q = ObjectHistoryQuery.parse(req.query ?? {});
      return worlds.objectHistory(req.params.id, req.params.objectId, q.tick);
    },
  );

  app.delete<IdParams>('/api/worlds/:id', async (req, reply) => {
    await worlds.delete(req.params.id);
    notifyChanged();
    return reply.code(204).send();
  });
}
