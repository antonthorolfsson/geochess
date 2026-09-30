import type {
  ApiError as ApiErrorBody,
  AutodraftFallback,
  CampaignStats,
  CampaignSummary,
  CampaignView,
  ChatSummary,
  DeclareWarInput,
  FeedFilter,
  FeedPage,
  GameView,
  InvitePreview,
  MeResponse,
  MessageView,
  MessagesPage,
  PeaceTerms,
  ProposeAccordInput,
  PublicMissionKind,
  SendMessageInput,
  WarReply,
  WarResponse,
  WarView,
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
  /** Emails a sign-in link, or with `reset` a link to choose a new password. */
  emailSignIn: (email: string, next: string, reset = false) =>
    request<{ sent: boolean; devLink?: string }>('POST', '/auth/email', { email, next, reset }),
  /** Uses up an emailed link; with `password`, also sets the account's password. */
  verifyEmail: (token: string, password?: string) =>
    request<{ ok: true; hasPassword: boolean }>('POST', '/auth/email/verify', { token, password }),
  passwordSignIn: (email: string, password: string) => request('POST', '/auth/password', { email, password }),
  setPassword: (password: string, currentPassword?: string) =>
    request('PUT', '/me/password', { password, currentPassword }),

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
  war: (id: string, warId: string) => request<WarView>('GET', `/campaigns/${id}/wars/${warId}`),
  replyToWar: (id: string, warId: string, input: WarReply) =>
    request('POST', `/campaigns/${id}/wars/${warId}/reply`, input),
  recallWar: (id: string, warId: string) => request('POST', `/campaigns/${id}/wars/${warId}/recall`),
  offerPeace: (id: string, warId: string, terms: PeaceTerms) =>
    request<{ id: string }>('POST', `/campaigns/${id}/wars/${warId}/peace`, { terms }),
  answerPeace: (id: string, warId: string, offerId: string, answer: 'accept' | 'decline') =>
    request('POST', `/campaigns/${id}/wars/${warId}/peace/${offerId}/answer`, { answer }),
  withdrawPeace: (id: string, warId: string, offerId: string) =>
    request('POST', `/campaigns/${id}/wars/${warId}/peace/${offerId}/withdraw`),
  fortify: (id: string, territoryId: string) =>
    request<{ untilRound: number }>('POST', `/campaigns/${id}/fortify`, { territoryId }),
  nextRound: (id: string) => request('POST', `/campaigns/${id}/round/next`),
  /** Pass the turn: your own, or (the host) whoever's it is. */
  passTurn: (id: string, userId: string) => request('POST', `/campaigns/${id}/turn/pass`, { userId }),

  proposeAccord: (id: string, input: ProposeAccordInput) =>
    request<{ id: string }>('POST', `/campaigns/${id}/accords`, input),
  answerAccord: (id: string, accordId: string, answer: 'accept' | 'decline') =>
    request('POST', `/campaigns/${id}/accords/${accordId}/answer`, { answer }),
  withdrawAccord: (id: string, accordId: string) => request('POST', `/campaigns/${id}/accords/${accordId}/withdraw`),
  renounceAccord: (id: string, accordId: string) => request('POST', `/campaigns/${id}/accords/${accordId}/renounce`),

  feed: (id: string, filter: FeedFilter, before?: string) =>
    request<FeedPage>(
      'GET',
      `/campaigns/${id}/feed?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  conversation: (id: string, peerId: string, before?: number) =>
    request<MessagesPage>(
      'GET',
      `/campaigns/${id}/messages?with=${encodeURIComponent(peerId)}${before ? `&before=${before}` : ''}`,
    ),
  sendMessage: (id: string, input: SendMessageInput) =>
    request<MessageView>('POST', `/campaigns/${id}/messages`, input),
  removeMessage: (id: string, messageId: number) =>
    request<MessageView>('DELETE', `/campaigns/${id}/messages/${messageId}`),
  chatSummary: (id: string) => request<ChatSummary>('GET', `/campaigns/${id}/chat`),
  markRead: (id: string, peerId: string | null, lastId: number) =>
    request('POST', `/campaigns/${id}/chat/read`, { with: peerId, lastId }),

  stats: (id: string) => request<CampaignStats>('GET', `/campaigns/${id}/stats`),

  chooseSecret: (id: string, optionId: string) => request('POST', `/campaigns/${id}/secret`, { optionId }),
  setPublicMissions: (id: string, kinds: PublicMissionKind[]) =>
    request('PUT', `/campaigns/${id}/victory/missions`, { kinds }),
  randomMissions: (id: string) => request('POST', `/campaigns/${id}/victory/missions/random`),
  rerollMission: (id: string, slot: number) => request('POST', `/campaigns/${id}/victory/missions/${slot}/reroll`),
  proceedWithoutSecrets: (id: string) => request('POST', `/campaigns/${id}/victory/proceed`),

  game: (gameId: string) => request<GameView>('GET', `/games/${gameId}`),
  move: (gameId: string, uci: string, ply: number) => request<GameView>('POST', `/games/${gameId}/move`, { uci, ply }),
  resign: (gameId: string) => request<GameView>('POST', `/games/${gameId}/resign`),
  draw: (gameId: string, action: 'offer' | 'accept' | 'decline') =>
    request<GameView>('POST', `/games/${gameId}/draw`, { action }),

  pushKey: () => request<{ publicKey: string | null }>('GET', '/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request('POST', '/push/subscribe', subscription),
  pushUnsubscribe: (endpoint: string) => request('POST', '/push/unsubscribe', { endpoint }),
};
