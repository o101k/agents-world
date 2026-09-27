import type {
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
};
