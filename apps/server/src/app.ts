import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ClientMessage } from '@aw/shared';
import { DEV_WEB_PORT, SERVER_VERSION, type ServerConfig } from './config.ts';
import { Hub } from './hub.ts';
import { BrainRouter } from '@aw/brain';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerWorldRoutes } from './routes/worlds.ts';
import { SettingsStore } from './settings.ts';
import { registerLocalOnlyGuard } from './security.ts';
import { WorldManager } from './worlds/worldManager.ts';

export interface App {
  server: FastifyInstance;
  worlds: WorldManager;
  hub: Hub;
  settings: SettingsStore;
}

export interface BuildOptions {
  /** Fastify's structured logger (off by default). */
  logger?: boolean | { level: string };
  /** Human-readable activity log (world created, deleted, …). */
  log?: (msg: string) => void;
  /** Environment for API keys (defaults to process.env; tests pass {}). */
  env?: NodeJS.ProcessEnv;
  /** Resume the saved active world during buildApp (default true). */
  autoStart?: boolean;
}

export async function buildApp(config: ServerConfig, options: BuildOptions = {}): Promise<App> {
  const server = Fastify({ logger: options.logger ?? false });
  const hub = new Hub();
  const settings = new SettingsStore(config.dataDir, options.env);
  await settings.checkPlans();
  const brains = new BrainRouter(settings.buildProviders());
  // Set once the manager exists: a world left running resumes inside its constructor and
  // reports its status before then (nobody is connected yet, so there's no one to tell).
  let manager: WorldManager | null = null;
  const worlds = new WorldManager(config.dataDir, {
    log: options.log,
    brains,
    autoStart: options.autoStart,
    hooks: (worldId) => ({
      onFrame: (frame) => {
        if (hub.size === 0) return;
        hub.broadcast({ type: 'frame', worldId, ...frame });
      },
      onEvents: (events) => {
        if (hub.size === 0) return;
        hub.broadcast({ type: 'events', worldId, events });
      },
      onStatus: () => {
        if (!manager || hub.size === 0) return;
        hub.broadcast({
          type: 'worlds_changed',
          worlds: manager.list(),
          activeWorldId: manager.activeWorldId,
        });
      },
    }),
  });
  manager = worlds;

  registerLocalOnlyGuard(server, config.dev ? [config.port, DEV_WEB_PORT] : [config.port]);

  await server.register(fastifyWebsocket, { options: { maxPayload: 4096 } });
  server.get('/ws', { websocket: true }, (socket) => {
    if (!hub.add(socket)) return;
    hub.send(socket, {
      type: 'hello',
      serverVersion: SERVER_VERSION,
      worlds: worlds.list(),
      activeWorldId: worlds.activeWorldId,
    });
    socket.on('message', (raw) => {
      const parsed = ClientMessage.safeParse(safeJson(raw.toString()));
      if (!parsed.success) return; // ignore unknown messages
      // No commands yet; observer commands arrive in Phase 1+.
    });
  });

  server.get('/api/health', async () => ({ ok: true, version: SERVER_VERSION }));
  registerWorldRoutes(server, worlds, hub);
  registerSettingsRoutes(server, settings, brains);

  if (config.webDistDir) {
    await server.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
    server.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0] ?? '';
      if (req.method !== 'GET' || path === '/api' || path.startsWith('/api/') || path === '/ws') {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    server.get('/', async (_req, reply) =>
      reply
        .type('text/html')
        .send(
          config.dev
            ? `<p>Dev mode: open <a href="http://localhost:${DEV_WEB_PORT}">http://localhost:${DEV_WEB_PORT}</a>.</p>`
            : '<p>The UI has not been built. Run <code>npm start</code> from the project folder.</p>',
        ),
    );
  }

  server.addHook('onClose', async () => {
    hub.closeAll();
    await worlds.closeAll();
  });

  return { server, worlds, hub, settings };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
