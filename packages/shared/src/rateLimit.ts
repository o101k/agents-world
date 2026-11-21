import type { ProviderId } from './agent.ts';
import type { RateLimitNotice } from './protocol.ts';

/** Short provider names for notices. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  mock: 'Mock',
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  openai_compatible: 'OpenAI-compatible API',
  claude_plan: 'Claude subscription',
  agy_plan: 'Gemini subscription',
};

/** "5m 20s", "45s", "2h 5m". */
export function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0s';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/** "Ada Smith's decision · OpenAI API · gpt-5-mini". */
export function rateLimitSource(n: RateLimitNotice): string {
  return `${n.agentName} · ${PROVIDER_NAMES[n.provider] ?? n.provider}${n.model ? ` · ${n.model}` : ''}`;
}

/** "HTTP 429 · requests per minute · retry after 20s". */
export function rateLimitFacts(n: RateLimitNotice): string {
  const parts: string[] = [];
  if (n.status) parts.push(`HTTP ${n.status}`);
  if (n.limit) parts.push(n.limit);
  if (n.retryAfterSec !== undefined) parts.push(`retry after ${formatWait(n.retryAfterSec)}`);
  return parts.join(' · ');
}
