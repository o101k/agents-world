import type {
  AgentResponse,
  ControlRequest,
  EventsQuery,
  EventsResponse,
  RunnerStatus,
  CreateWorldRequest,
  WorldResponse,
  WorldViewResponse,
  WorldsResponse,
} from '@aw/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listWorlds: () => request<WorldsResponse>('GET', '/api/worlds'),
  createWorld: (req: CreateWorldRequest) => request<WorldResponse>('POST', '/api/worlds', req),
  activateWorld: (id: string) => request<WorldResponse>('POST', `/api/worlds/${id}/activate`),
  deleteWorld: (id: string) => request<void>('DELETE', `/api/worlds/${id}`),
  worldView: (id: string) => request<WorldViewResponse>('GET', `/api/worlds/${id}/view`),
  control: (id: string, req: ControlRequest) =>
    request<{ runner: RunnerStatus }>('POST', `/api/worlds/${id}/control`, req),
  events: (id: string, q: EventsQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return request<EventsResponse>('GET', `/api/worlds/${id}/events?${params}`);
  },
  agent: (id: string, agentId: string) =>
    request<AgentResponse>('GET', `/api/worlds/${id}/agents/${agentId}`),
};
