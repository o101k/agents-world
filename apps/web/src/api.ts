import type {
  AgentResponse,
  FamilyNode,
  MapResponse,
  MarketResponse,
  VillageResponse,
  BrainConfig,
  BrainsResponse,
  CastPreviewRequest,
  CastPreviewResponse,
  CallsResponse,
  ModelPrice,
  ProviderUpdate,
  SettingsResponse,
  SetBrainsRequest,
  SpawnRequest,
  WorldSettings,
  ControlRequest,
  EventsQuery,
  EventsResponse,
  RunnerStatus,
  CreateWorldRequest,
  WorldResponse,
  WorldViewResponse,
  WorldsResponse,
  StoryResponse,
  ReplayResponse,
  WorldEventRequest,
  ObjectHistoryResponse,
  AskRequest,
  AskResponse,
  InterviewsResponse,
  RecordQuery,
  RecordResponse,
} from '@aw/shared';

const enc = encodeURIComponent;

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
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
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Unexpected response from the helper.');
  }
}

export const api = {
  castPreview: (req: CastPreviewRequest, signal?: AbortSignal) =>
    request<CastPreviewResponse>('POST', '/api/cast-preview', req, signal),
  listWorlds: (signal?: AbortSignal) =>
    request<WorldsResponse>('GET', '/api/worlds', undefined, signal),
  createWorld: (req: CreateWorldRequest) => request<WorldResponse>('POST', '/api/worlds', req),
  activateWorld: (id: string) => request<WorldResponse>('POST', `/api/worlds/${enc(id)}/activate`),
  deleteWorld: (id: string) => request<void>('DELETE', `/api/worlds/${enc(id)}`),
  worldView: (id: string, signal?: AbortSignal) =>
    request<WorldViewResponse>('GET', `/api/worlds/${enc(id)}/view`, undefined, signal),
  worldMap: (id: string, signal?: AbortSignal) =>
    request<MapResponse>('GET', `/api/worlds/${enc(id)}/map`, undefined, signal),
  control: (id: string, req: ControlRequest) =>
    request<{ runner: RunnerStatus }>('POST', `/api/worlds/${enc(id)}/control`, req),
  events: (id: string, q: EventsQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return request<EventsResponse>(
      'GET',
      `/api/worlds/${enc(id)}/events?${params}`,
      undefined,
      signal,
    );
  },
  agent: (id: string, agentId: string, signal?: AbortSignal) =>
    request<AgentResponse>(
      'GET',
      `/api/worlds/${enc(id)}/agents/${enc(agentId)}`,
      undefined,
      signal,
    ),
  calls: (id: string, agentId: string, signal?: AbortSignal) =>
    request<CallsResponse>(
      'GET',
      `/api/worlds/${enc(id)}/agents/${enc(agentId)}/calls`,
      undefined,
      signal,
    ),
  setBrain: (id: string, agentId: string, brain: BrainConfig) =>
    request<AgentResponse>('PUT', `/api/worlds/${enc(id)}/agents/${enc(agentId)}/brain`, brain),
  brains: (id: string, signal?: AbortSignal) =>
    request<BrainsResponse>('GET', `/api/worlds/${enc(id)}/brains`, undefined, signal),
  setBrains: (id: string, req: SetBrainsRequest) =>
    request<BrainsResponse>('PUT', `/api/worlds/${enc(id)}/brains`, req),
  setDefaultBrain: (id: string, brain: BrainConfig, applyToAll: boolean) =>
    request<WorldSettings>('PUT', `/api/worlds/${enc(id)}/default-brain`, { brain, applyToAll }),
  setCap: (id: string, capUsd: number) =>
    request<{ runner: RunnerStatus }>('PUT', `/api/worlds/${enc(id)}/cap`, { capUsd }),
  spawn: (id: string, req: SpawnRequest) =>
    request<{ agentId: string; note?: string }>('POST', `/api/worlds/${enc(id)}/spawn`, req),
  settings: (signal?: AbortSignal) =>
    request<SettingsResponse>('GET', '/api/settings', undefined, signal),
  updateProvider: (provider: string, update: ProviderUpdate) =>
    request<SettingsResponse>('PUT', `/api/settings/providers/${enc(provider)}`, update),
  checkClaudePlan: () =>
    request<SettingsResponse>('POST', '/api/settings/providers/claude_plan/check'),
  updatePrices: (prices: Record<string, ModelPrice | null>) =>
    request<SettingsResponse>('PUT', '/api/settings/prices', prices),
  market: (id: string, signal?: AbortSignal) =>
    request<MarketResponse>('GET', `/api/worlds/${enc(id)}/market`, undefined, signal),
  village: (id: string, signal?: AbortSignal) =>
    request<VillageResponse>('GET', `/api/worlds/${enc(id)}/village`, undefined, signal),
  setAging: (id: string, daysPerYear: number) =>
    request<WorldSettings>('PUT', `/api/worlds/${enc(id)}/aging`, { daysPerYear }),
  familyTree: (id: string, agentId: string, signal?: AbortSignal) =>
    request<FamilyNode>('GET', `/api/worlds/${enc(id)}/family/${enc(agentId)}`, undefined, signal),
  worldEvent: (id: string, req: WorldEventRequest) =>
    request<{ ok: true }>('POST', `/api/worlds/${enc(id)}/world-event`, req),
  replay: (id: string, tick: number, mapVersion: number, signal?: AbortSignal) =>
    request<ReplayResponse>(
      'GET',
      `/api/worlds/${enc(id)}/replay?tick=${tick}&mapVersion=${mapVersion}`,
      undefined,
      signal,
    ),
  replayAgent: (id: string, tick: number, agentId: string, signal?: AbortSignal) =>
    request<AgentResponse>(
      'GET',
      `/api/worlds/${enc(id)}/replay/agents/${enc(agentId)}?tick=${tick}`,
      undefined,
      signal,
    ),
  story: (id: string, agentId: string, signal?: AbortSignal) =>
    request<StoryResponse>(
      'GET',
      `/api/worlds/${enc(id)}/agents/${enc(agentId)}/story`,
      undefined,
      signal,
    ),
  objectHistory: (id: string, objectId: string, tick?: number, signal?: AbortSignal) =>
    request<ObjectHistoryResponse>(
      'GET',
      `/api/worlds/${enc(id)}/objects/${enc(objectId)}/history${tick === undefined ? '' : `?tick=${tick}`}`,
      undefined,
      signal,
    ),
  interviews: (id: string, agentId: string, signal?: AbortSignal) =>
    request<InterviewsResponse>(
      'GET',
      `/api/worlds/${enc(id)}/agents/${enc(agentId)}/interviews`,
      undefined,
      signal,
    ),
  ask: (id: string, agentId: string, req: AskRequest, signal?: AbortSignal) =>
    request<AskResponse>('POST', `/api/worlds/${enc(id)}/agents/${enc(agentId)}/ask`, req, signal),
  record: (id: string, agentId: string, q: RecordQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return request<RecordResponse>(
      'GET',
      `/api/worlds/${enc(id)}/agents/${enc(agentId)}/record?${params}`,
      undefined,
      signal,
    );
  },
  providerModels: (provider: string, signal?: AbortSignal) =>
    request<{ models: string[] }>(
      'GET',
      `/api/providers/${enc(provider)}/models`,
      undefined,
      signal,
    ),
};
