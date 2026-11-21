import { RateLimitError } from './types.ts';

/** The parts of an Anthropic / OpenAI SDK APIError we read. */
interface ApiErrorLike {
  status?: number;
  headers?: Headers;
  error?: unknown;
  code?: string | null;
  message?: string;
}

const ANTHROPIC_LIMITS: [string, string][] = [
  ['requests', 'requests per minute'],
  ['input-tokens', 'input tokens per minute'],
  ['output-tokens', 'output tokens per minute'],
  ['tokens', 'tokens per minute'],
];

const OPENAI_LIMITS: [string, string][] = [
  ['requests', 'request limit'],
  ['tokens', 'token limit'],
];

/** "1s", "6m0s", "20ms", "1h2m3.5s" (OpenAI's reset headers) → milliseconds. */
export function parseDuration(text: string): number | undefined {
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let found = false;
  for (const m of text.matchAll(re)) {
    found = true;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n;
  }
  return found ? Math.round(total) : undefined;
}

/** A reset header: an ISO time, an epoch (s or ms), or a duration. Returns ms since epoch. */
function parseReset(value: string, now: number): number | undefined {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 1e12) return n; // epoch ms (OpenRouter)
    if (n > 1e9) return n * 1000; // epoch seconds
    return now + n * 1000; // seconds from now
  }
  const d = parseDuration(v);
  if (d !== undefined && /^[\d.hms]+$/.test(v)) return now + d;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** The provider's message from an SDK error body, else the SDK's own message. */
function messageOf(err: ApiErrorLike): string {
  const body = err.error as { message?: unknown; error?: { message?: unknown } } | undefined;
  const msg = body?.error?.message ?? body?.message;
  return (typeof msg === 'string' && msg) || err.message || 'Rate limited';
}

/**
 * Turns an SDK's HTTP 429 into a RateLimitError saying which limit was hit and when it lifts
 * (from retry-after and the providers' rate-limit headers). Anything else comes back unchanged.
 */
export function toRateLimitError(err: unknown, now = Date.now()): unknown {
  const e = err as ApiErrorLike | null;
  if (!e || typeof e !== 'object' || e.status !== 429) return err;
  const h = e.headers;
  const get = (name: string) => h?.get?.(name) ?? null;

  let retryAfterSec: number | undefined;
  const ms = get('retry-after-ms');
  const ra = get('retry-after');
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) retryAfterSec = Number(ms.trim()) / 1000;
  else if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra.trim())) retryAfterSec = Number(ra.trim());
    else if (!Number.isNaN(Date.parse(ra)))
      retryAfterSec = Math.max(0, (Date.parse(ra) - now) / 1000);
  }

  // Which limit ran out: the one with nothing remaining.
  let limit: string | undefined;
  let resetsAt: number | undefined;
  const families: [(key: string, field: 'remaining' | 'reset') => string, [string, string][]][] = [
    [(k, f) => `anthropic-ratelimit-${k}-${f}`, ANTHROPIC_LIMITS],
    [(k, f) => `x-ratelimit-${f}-${k}`, OPENAI_LIMITS],
  ];
  for (const [header, limits] of families) {
    const hit = limits.find(([key]) => get(header(key, 'remaining')) === '0');
    if (!hit) continue;
    limit = hit[1];
    const reset = get(header(hit[0], 'reset'));
    if (reset) resetsAt = parseReset(reset, now);
    break;
  }
  if (!resetsAt) {
    const reset = get('x-ratelimit-reset'); // OpenRouter
    if (reset) resetsAt = parseReset(reset, now);
  }
  if (retryAfterSec !== undefined) resetsAt = now + retryAfterSec * 1000;
  if (e.code === 'insufficient_quota') {
    limit = 'quota used up (check billing)';
    resetsAt = undefined;
    retryAfterSec = undefined;
  }
  return new RateLimitError(messageOf(e).slice(0, 300), {
    status: 429,
    limit,
    retryAfterSec: retryAfterSec !== undefined ? Math.round(retryAfterSec) : undefined,
    resetsAt,
  });
}

/** Awaits an SDK call, rethrowing a 429 as a RateLimitError. */
export async function rateLimited<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    throw toRateLimitError(err);
  }
}

/**
 * A fetch that tells the SDK not to retry a 429 by itself (via `x-should-retry: false`, which both
 * SDKs honour). The SDKs would otherwise sleep through retry-after inside a decision and hit the
 * decision timeout; the world pauses and resumes at retry-after instead, so the owner sees it.
 * Other errors (overloaded, 5xx, dropped connections) keep the SDK's own retries.
 */
export function noRetryOn429(inner: typeof fetch = globalThis.fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await inner(input, init);
    if (res.status !== 429) return res;
    const headers = new Headers(res.headers);
    headers.set('x-should-retry', 'false');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }) as typeof fetch;
}
