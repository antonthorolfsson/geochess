import type {
  ApiError as ApiErrorBody,
  AutodraftFallback,
  CampaignSummary,
  CampaignView,
  DeclareWarInput,
  GameView,
  InvitePreview,
  MeResponse,
  WarReply,
  WarResponse,
} from '@empire/rules';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.message ?? `Request failed (${res.status}).`, error?.code);
  }
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

export const api = {
  me: () => request<MeResponse>('GET', '/me'),
  rename: (name: string) => request('PATCH', '/me', { name }),
  logout: () => request('POST', '/auth/logout'),
  devUsers: () => request<{ users: { id: string; name: string }[] }>('GET', '/auth/dev'),
  devSignIn: (name: string) => request('POST', '/auth/dev', { name }),
  emailSignIn: (email: string, next: string) =>
    request<{ sent: boolean; devLink?: string }>('POST', '/auth/email', { email, next }),
  verifyEmail: (token: string) => request('POST', '/auth/email/verify', { token }),

  campaigns: () => request<CampaignSummary[]>('GET', '/campaigns'),
  campaign: (id: string) => request<CampaignView>('GET', `/campaigns/${id}`),
  createCampaign: (input: { name: string; rules: Record<string, unknown> }) =>
    request<{ id: string }>('POST', '/campaigns', input),
  updateCampaign: (id: string, input: { name?: string; rules?: Record<string, unknown> }) =>
    request('PATCH', `/campaigns/${id}`, input),
  deleteCampaign: (id: string) => request('DELETE', `/campaigns/${id}`),
  resetInvite: (id: string) => request<{ inviteCode: string }>('POST', `/campaigns/${id}/invite/reset`),
  updateMembership: (
    id: string,
    input: { color?: number; autodraft?: boolean; autodraftFallback?: AutodraftFallback },
  ) => request('PATCH', `/campaigns/${id}/me`, input),
  leave: (id: string) => request('POST', `/campaigns/${id}/leave`),
  kick: (id: string, userId: string) => request('POST', `/campaigns/${id}/kick`, { userId }),
  startDraft: (id: string) => request('POST', `/campaigns/${id}/draft/start`),
  pick: (id: string, territoryId: string) => request('POST', `/campaigns/${id}/draft/pick`, { territoryId }),
  autopick: (id: string) => request('POST', `/campaigns/${id}/draft/autopick`),
  endDraft: (id: string) => request('POST', `/campaigns/${id}/draft/end`),
  setDraftList: (id: string, territoryIds: string[]) =>
    request<{ territoryIds: string[] }>('PUT', `/campaigns/${id}/draft/list`, { territoryIds }),

  invite: (code: string) => request<InvitePreview>('GET', `/invites/${code}`),
  join: (code: string) => request<{ id: string }>('POST', `/invites/${code}/join`),

  declareWar: (id: string, input: DeclareWarInput) => request<{ id: string }>('POST', `/campaigns/${id}/wars`, input),
  respondToWar: (id: string, warId: string, input: WarResponse) =>
    request('POST', `/campaigns/${id}/wars/${warId}/respond`, input),
  replyToWar: (id: string, warId: string, input: WarReply) =>
    request('POST', `/campaigns/${id}/wars/${warId}/reply`, input),
  nextRound: (id: string) => request('POST', `/campaigns/${id}/round/next`),

  game: (gameId: string) => request<GameView>('GET', `/games/${gameId}`),
  move: (gameId: string, uci: string, ply: number) => request<GameView>('POST', `/games/${gameId}/move`, { uci, ply }),
  resign: (gameId: string) => request<GameView>('POST', `/games/${gameId}/resign`),
  draw: (gameId: string, action: 'offer' | 'accept' | 'decline') =>
    request<GameView>('POST', `/games/${gameId}/draw`, { action }),

  pushKey: () => request<{ publicKey: string | null }>('GET', '/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request('POST', '/push/subscribe', subscription),
  pushUnsubscribe: (endpoint: string) => request('POST', '/push/unsubscribe', { endpoint }),
};
