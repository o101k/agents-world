import type { FastifyInstance } from 'fastify';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const IPV6_HOST_RE = /^\[([^\]]+)\](?::(\d+))?$/;
const NAME_HOST_RE = /^([a-z0-9.-]+)(?::(\d+))?$/i;

function isValidPort(portStr: string | undefined): boolean {
  if (portStr === undefined) return true;
  if (!/^\d+$/.test(portStr)) return false;
  const port = Number(portStr);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Hostname part of a valid Host header value ("localhost:4747" → "localhost", "[::1]:80" → "[::1]").
 * Returns "" for malformed headers such as "localhost:4747@evil.com" or "[::1]evil".
 */
export function hostnameOf(host: string): string {
  if (!host) return '';
  if (host.startsWith('[')) {
    const m = IPV6_HOST_RE.exec(host);
    if (!m || !isValidPort(m[2])) return '';
    return `[${m[1]!.toLowerCase()}]`;
  }
  const m = NAME_HOST_RE.exec(host);
  if (!m || !isValidPort(m[2])) return '';
  return m[1]!.toLowerCase();
}

/**
 * The helper listens on 127.0.0.1 only, but a web page in your browser could still try to talk
 * to it. Several checks stop that:
 *  - Host must be a valid loopback host[:port]. This blocks DNS-rebinding and Host-smuggling attacks.
 *  - Cross-site non-GET/HEAD requests (Sec-Fetch-Site: cross-site) are rejected.
 *  - If an Origin is sent (browsers always send one on cross-site requests and WebSocket
 *    connections), it must be this app's own page. This blocks other sites, and because no CORS
 *    headers are ever sent, they can't read responses either.
 *  - Security response headers prevent clickjacking, MIME sniffing, and referrer leaks.
 */
export function registerLocalOnlyGuard(app: FastifyInstance, allowedPorts: number[]): void {
  const hasDynamicPort = allowedPorts.includes(0);
  const allowedOrigins = new Set<string>();
  for (const port of allowedPorts) {
    if (port <= 0) continue;
    for (const host of LOOPBACK_HOSTS) allowedOrigins.add(`http://${host}:${port}`);
  }

  const isAllowedOrigin = (origin: string): boolean => {
    const lower = origin.toLowerCase();
    if (allowedOrigins.has(lower)) return true;
    if (hasDynamicPort) {
      const addr = app.server.address();
      if (addr && typeof addr === 'object' && addr.port > 0) {
        for (const host of LOOPBACK_HOSTS) {
          if (lower === `http://${host}:${addr.port}`) return true;
        }
      }
    }
    return false;
  };

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host))) {
      return reply.code(403).send({ error: 'Forbidden host' });
    }
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const rawFetchSite = req.headers['sec-fetch-site'];
      const fetchSite = Array.isArray(rawFetchSite) ? rawFetchSite[0] : rawFetchSite;
      if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
        return reply.code(403).send({ error: 'Forbidden cross-site request' });
      }
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(origin)) {
      return reply.code(403).send({ error: 'Forbidden origin' });
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
}
