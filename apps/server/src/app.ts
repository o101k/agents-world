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
}

export async function buildApp(config: ServerConfig, options: BuildOptions = {}): Promise<App> {
  const server = Fastify({ logger: options.logger ?? false });
  const hub = new Hub();
  const settings = new SettingsStore(config.dataDir, options.env);
  const brains = new BrainRouter(settings.buildProviders());
  const worlds: WorldManager = new WorldManager(config.dataDir, {
    log: options.log,
    brains,
    hooks: (worldId) => ({
      onFrame: (frame) => hub.broadcast({ type: 'frame', worldId, ...frame }),
      onEvents: (events) => hub.broadcast({ type: 'events', worldId, events }),
      onStatus: () =>
        hub.broadcast({
          type: 'worlds_changed',
          worlds: worlds.list(),
          activeWorldId: worlds.activeWorldId,
        }),
    }),
  });

  registerLocalOnlyGuard(server, config.dev ? [config.port, DEV_WEB_PORT] : [config.port]);

  await server.register(fastifyWebsocket);
  server.get('/ws', { websocket: true }, (socket) => {
    hub.add(socket);
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
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url === '/ws') {
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
