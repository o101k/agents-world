import type { FastifyInstance } from 'fastify';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Hostname part of a Host header value ("localhost:4747" → "localhost", "[::1]:80" → "[::1]"). */
export function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1).toLowerCase();
  return (host.split(':')[0] ?? '').toLowerCase();
}

/**
 * The helper listens on 127.0.0.1 only, but a web page in your browser could still try to talk
 * to it. Two checks stop that:
 *  - Host must be a loopback name. This blocks DNS-rebinding attacks.
 *  - If an Origin is sent (browsers always send one on cross-site requests and WebSocket
 *    connections), it must be this app's own page. This blocks other sites, and because no CORS
 *    headers are ever sent, they can't read responses either.
 */
export function registerLocalOnlyGuard(app: FastifyInstance, allowedPorts: number[]): void {
  const allowedOrigins = new Set<string>();
  for (const port of allowedPorts) {
    for (const host of LOOPBACK_HOSTS) allowedOrigins.add(`http://${host}:${port}`);
  }

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host))) {
      return reply.code(403).send({ error: 'Forbidden host' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) {
      return reply.code(403).send({ error: 'Forbidden origin' });
    }
  });
}
