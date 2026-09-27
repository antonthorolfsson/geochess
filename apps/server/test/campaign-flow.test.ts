import {
  DEFAULT_RULES,
  type CampaignSummary,
  type CampaignView,
  type InvitePreview,
  type MeResponse,
} from '@empire/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

async function createCampaign(host: Client, body: object = { name: 'Test Campaign' }) {
  const res = await host.post<{ id: string }>('/api/campaigns', body);
  expect(res.status).toBe(201);
  const view = await host.get<CampaignView>(`/api/campaigns/${res.body.id}`);
  return view.body;
}

describe('auth', () => {
  it('reports signed-out visitors and signs in by name in development', async () => {
    const anon = await client(server.app).get<MeResponse>('/api/me');
    expect(anon.body.user).toBeNull();
    expect(anon.body.auth.devLogin).toBe(true);

    const ann = await signIn(server.app, 'Ann');
    const me = await ann.get<MeResponse>('/api/me');
    expect(me.body.user).toMatchObject({ id: 'dev_ann', name: 'Ann' });
  });

  it('signs in with a single-use email link', async () => {
    const anon = client(server.app);
    const res = await anon.post<{ sent: boolean; devLink: string }>('/api/auth/email', { email: 'Kim@Example.com' });
    expect(res.status).toBe(200);
    expect(server.mail.at(-1)?.to).toBe('kim@example.com');
    const token = new URL(res.body.devLink).searchParams.get('token')!;

    const verify = await server.app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token } });
    expect(verify.statusCode).toBe(200);
    const session = verify.cookies.find((c) => c.name === 'ec_session')!;
    const me = await client(server.app, `ec_session=${session.value}`).get<MeResponse>('/api/me');
    expect(me.body.user).toMatchObject({ name: 'Kim', email: 'kim@example.com' });

    const again = await anon.post('/api/auth/email/verify', { token });
    expect(again.status).toBe(400);
  });

  it('blocks cross-site writes', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/dev',
      headers: { origin: 'https://evil.example' },
      payload: { name: 'Mallory' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('lobby', () => {
  it('creates a campaign with the host as the first member', async () => {
    const ann = await signIn(server.app, 'Ann');
    const c = await createCampaign(ann, { name: '  Iron Winter  ', rules: { draft: { mode: 'free' } } });
    expect(c).toMatchObject({ name: 'Iron Winter', status: 'lobby', hostId: 'dev_ann' });
    expect(c.rules).toEqual({ ...DEFAULT_RULES, draft: { mode: 'free' } });
    expect(c.members.map((m) => [m.userId, m.color])).toEqual([['dev_ann', 0]]);

    const list = await ann.get<CampaignSummary[]>('/api/campaigns');
    expect(list.body.find((s) => s.id === c.id)).toMatchObject({ memberCount: 1, myColor: 0 });
  });

  it('merges rule changes over the current rules', async () => {
    const ann = await signIn(server.app, 'Ann');
    const c = await createCampaign(ann, { name: 'Rules', rules: { draft: { mode: 'free' } } });
    expect((await ann.patch(`/api/campaigns/${c.id}`, { rules: { maxPlayers: 4 } })).status).toBe(200);
    const after = await ann.get<CampaignView>(`/api/campaigns/${c.id}`);
    expect(after.body.rules).toEqual({ ...DEFAULT_RULES, maxPlayers: 4, draft: { mode: 'free' } });
    expect((await ann.patch(`/api/campaigns/${c.id}`, { rules: { maxPlayers: 12 } })).status).toBe(400);
  });

  it('lets friends join by invite link, once, while seats last', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const cy = await signIn(server.app, 'Cy');
    const c = await createCampaign(ann, { name: 'Two Seats', rules: { maxPlayers: 2 } });

    const preview = await client(server.app).get<InvitePreview>(`/api/invites/${c.inviteCode}`);
    expect(preview.body).toMatchObject({
      campaign: { name: 'Two Seats', hostName: 'Ann', memberCount: 1 },
      isMember: false,
    });

    expect((await bo.post(`/api/invites/${c.inviteCode}/join`)).status).toBe(200);
    expect((await bo.post(`/api/invites/${c.inviteCode}/join`)).status).toBe(200);
    expect((await cy.post(`/api/invites/${c.inviteCode}/join`)).status).toBe(409);
    expect((await cy.get(`/api/campaigns/${c.id}`)).status).toBe(404);

    const view = await bo.get<CampaignView>(`/api/campaigns/${c.id}`);
    expect(view.body.members.map((m) => [m.userId, m.color])).toEqual([
      ['dev_ann', 0],
      ['dev_bo', 1],
    ]);
    expect(view.body.events.map((e) => e.type)).toEqual(['campaign.created', 'member.joined']);
  });

  it('lets players change color, leave, and be removed by the host', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const c = await createCampaign(ann);
    await bo.post(`/api/invites/${c.inviteCode}/join`);

    expect((await bo.patch(`/api/campaigns/${c.id}/me`, { color: 0 })).status).toBe(409);
    expect((await bo.patch(`/api/campaigns/${c.id}/me`, { color: 5 })).status).toBe(200);
    expect((await bo.post(`/api/campaigns/${c.id}/kick`, { userId: 'dev_ann' })).status).toBe(403);
    expect((await ann.post(`/api/campaigns/${c.id}/leave`)).status).toBe(400);
    expect((await ann.post(`/api/campaigns/${c.id}/kick`, { userId: 'dev_bo' })).status).toBe(200);
    const view = await ann.get<CampaignView>(`/api/campaigns/${c.id}`);
    expect(view.body.members.map((m) => m.userId)).toEqual(['dev_ann']);
  });

  it('invalidates old invite links on reset', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const c = await createCampaign(ann);
    const reset = await ann.post<{ inviteCode: string }>(`/api/campaigns/${c.id}/invite/reset`);
    expect(reset.body.inviteCode).not.toBe(c.inviteCode);
    expect((await bo.post(`/api/invites/${c.inviteCode}/join`)).status).toBe(404);
    expect((await bo.post(`/api/invites/${reset.body.inviteCode}/join`)).status).toBe(200);
  });
});

describe('draft', () => {
  async function draftingCampaign(mode: 'contiguous' | 'free' = 'contiguous') {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const c = await createCampaign(ann, { name: 'Draft', rules: { draft: { mode } } });
    await bo.post(`/api/invites/${c.inviteCode}/join`);
    return { ann, bo, id: c.id };
  }

  it('only lets the host start, with at least two players', async () => {
    const ann = await signIn(server.app, 'Ann');
    const solo = await createCampaign(ann);
    expect((await ann.post(`/api/campaigns/${solo.id}/draft/start`)).status).toBe(409);

    const { bo, id } = await draftingCampaign();
    expect((await bo.post(`/api/campaigns/${id}/draft/start`)).status).toBe(403);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    const view = await ann.get<CampaignView>(`/api/campaigns/${id}`);
    expect(view.body.status).toBe('draft');
    expect([...view.body.draft!.order].sort()).toEqual(['dev_ann', 'dev_bo']);
    expect(view.body.draft).toMatchObject({ pickIndex: 0, totalPicks: 6, round: 1 });
    expect((await bo.post(`/api/invites/${view.body.inviteCode}/join`)).status).toBe(200);
  });

  it('enforces turn order, free countries and contiguity', async () => {
    const { ann, bo, id } = await draftingCampaign();
    await ann.post(`/api/campaigns/${id}/draft/start`);
    const view = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    const [first, second] = view.draft!.order[0] === 'dev_ann' ? [ann, bo] : [bo, ann];

    expect((await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' })).status).toBe(409);
    expect((await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'NOPE' })).status).toBe(400);
    expect((await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' })).status).toBe(200);
    // Snake: the second player picks twice in a row.
    expect((await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' })).body).toMatchObject({
      error: { code: 'already-claimed' },
    });
    expect((await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'E' })).status).toBe(200);
    const res = await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'B' });
    expect(res.body).toMatchObject({ error: { code: 'not-bordering' } });
    expect((await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'D' })).status).toBe(200);

    const after = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    expect(after.draft).toMatchObject({ pickIndex: 3, round: 2 });
    expect(after.holdings).toEqual({
      A: first === ann ? 'dev_ann' : 'dev_bo',
      E: second === ann ? 'dev_ann' : 'dev_bo',
      D: second === ann ? 'dev_ann' : 'dev_bo',
    });
  });

  it('auto-drafts, lets the host pick for a stalled player, and opens the campaign when the map is full', async () => {
    const { ann, bo, id } = await draftingCampaign('free');
    await ann.post(`/api/campaigns/${id}/draft/start`);
    const order = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body.draft!.order;

    // Bo only stalls on the first pick if Bo is first; the host picks for whoever is up.
    expect((await ann.post(`/api/campaigns/${id}/draft/autopick`)).status).toBe(200);
    const one = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    expect(one.holdings).toEqual({ A: order[0] });
    expect(one.events.at(-1)).toMatchObject({ type: 'draft.pick', actorId: 'dev_ann', payload: { auto: true } });

    const socket = await listen(server.app, ann);
    await bo.patch(`/api/campaigns/${id}/me`, { autodraft: true });
    await ann.patch(`/api/campaigns/${id}/me`, { autodraft: true });
    await tick();
    socket.close();

    const done = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    expect(done.status).toBe('active');
    expect(done.round).toBe(1);
    expect(Object.keys(done.holdings).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(done.events.at(-1)?.type).toBe('draft.completed');
    expect(done.draft).toMatchObject({ pickIndex: 6, currentPicker: null });

    const pushed = socket.messages.flatMap((m) => (m.type === 'campaign.events' ? m.events : []));
    expect(pushed.filter((e) => e.type === 'draft.pick')).toHaveLength(5);
    expect(pushed.at(-1)?.type).toBe('draft.completed');
    expect((await bo.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' })).status).toBe(409);
  });

  it('pushes picks to other members in real time', async () => {
    const { ann, bo, id } = await draftingCampaign();
    await ann.post(`/api/campaigns/${id}/draft/start`);
    const order = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body.draft!.order;
    const [first, other] = order[0] === 'dev_ann' ? [ann, bo] : [bo, ann];

    const socket = await listen(server.app, other);
    await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'C' });
    await tick();
    socket.close();
    expect(socket.messages.find((m) => m.type === 'campaign.events')).toMatchObject({
      type: 'campaign.events',
      campaignId: id,
      events: [{ type: 'draft.pick', payload: { territoryId: 'C', pickNumber: 0, auto: false } }],
    });
  });

  it('tells members when the host deletes a campaign', async () => {
    const { ann, bo, id } = await draftingCampaign();
    const socket = await listen(server.app, bo);
    expect((await bo.del(`/api/campaigns/${id}`)).status).toBe(403);
    expect((await ann.del(`/api/campaigns/${id}`)).status).toBe(200);
    await tick();
    socket.close();
    expect(socket.messages.at(-1)).toEqual({ type: 'campaign.deleted', campaignId: id });
    expect((await ann.get(`/api/campaigns/${id}`)).status).toBe(404);
  });
});
