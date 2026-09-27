import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  ControlRequest,
  EventsQuery,
  type AgentResponse,
  type EventsResponse,
  type WorldResponse,
  type WorldsResponse,
} from '@aw/shared';
import type { Hub } from '../hub.ts';
import { ConflictError, NotFoundError, type WorldManager } from '../worlds/worldManager.ts';

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
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply
      .code(status)
      .send({ error: status === 500 ? 'Internal error' : (err as Error).message });
  });

  app.get('/api/worlds', async (): Promise<WorldsResponse> => snapshot());

  app.post('/api/worlds', async (req, reply): Promise<WorldResponse> => {
    const world = worlds.create((req.body ?? {}) as never);
    notifyChanged();
    reply.code(201);
    return { world };
  });

  app.post<IdParams>('/api/worlds/:id/activate', async (req): Promise<WorldResponse> => {
    const world = await worlds.activate(req.params.id);
    notifyChanged();
    return { world };
  });

  app.get<IdParams>('/api/worlds/:id/view', async (req) => worlds.view(req.params.id));

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

  app.delete<IdParams>('/api/worlds/:id', async (req, reply) => {
    await worlds.delete(req.params.id);
    notifyChanged();
    return reply.code(204).send();
  });
}
