import type {
  AgentResponse,
  FamilyNode,
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
  castPreview: (req: CastPreviewRequest) =>
    request<CastPreviewResponse>('POST', '/api/cast-preview', req),
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
  calls: (id: string, agentId: string) =>
    request<CallsResponse>('GET', `/api/worlds/${id}/agents/${agentId}/calls`),
  setBrain: (id: string, agentId: string, brain: BrainConfig) =>
    request<AgentResponse>('PUT', `/api/worlds/${id}/agents/${agentId}/brain`, brain),
  brains: (id: string) => request<BrainsResponse>('GET', `/api/worlds/${id}/brains`),
  setBrains: (id: string, req: SetBrainsRequest) =>
    request<BrainsResponse>('PUT', `/api/worlds/${id}/brains`, req),
  setDefaultBrain: (id: string, brain: BrainConfig, applyToAll: boolean) =>
    request<WorldSettings>('PUT', `/api/worlds/${id}/default-brain`, { brain, applyToAll }),
  setCap: (id: string, capUsd: number) =>
    request<{ runner: RunnerStatus }>('PUT', `/api/worlds/${id}/cap`, { capUsd }),
  spawn: (id: string, req: SpawnRequest) =>
    request<{ agentId: string; note?: string }>('POST', `/api/worlds/${id}/spawn`, req),
  settings: () => request<SettingsResponse>('GET', '/api/settings'),
  updateProvider: (provider: string, update: ProviderUpdate) =>
    request<SettingsResponse>('PUT', `/api/settings/providers/${provider}`, update),
  checkClaudePlan: () =>
    request<SettingsResponse>('POST', '/api/settings/providers/claude_plan/check'),
  updatePrices: (prices: Record<string, ModelPrice | null>) =>
    request<SettingsResponse>('PUT', '/api/settings/prices', prices),
  market: (id: string) => request<MarketResponse>('GET', `/api/worlds/${id}/market`),
  village: (id: string) => request<VillageResponse>('GET', `/api/worlds/${id}/village`),
  setAging: (id: string, daysPerYear: number) =>
    request<WorldSettings>('PUT', `/api/worlds/${id}/aging`, { daysPerYear }),
  familyTree: (id: string, agentId: string) =>
    request<FamilyNode>('GET', `/api/worlds/${id}/family/${agentId}`),
  worldEvent: (id: string, req: WorldEventRequest) =>
    request<{ ok: true }>('POST', `/api/worlds/${id}/world-event`, req),
  replay: (id: string, tick: number, mapVersion: number) =>
    request<ReplayResponse>(
      'GET',
      `/api/worlds/${id}/replay?tick=${tick}&mapVersion=${mapVersion}`,
    ),
  replayAgent: (id: string, tick: number, agentId: string) =>
    request<AgentResponse>('GET', `/api/worlds/${id}/replay/agents/${agentId}?tick=${tick}`),
  story: (id: string, agentId: string) =>
    request<StoryResponse>('GET', `/api/worlds/${id}/agents/${agentId}/story`),
  providerModels: (provider: string) =>
    request<{ models: string[] }>('GET', `/api/providers/${provider}/models`),
};
