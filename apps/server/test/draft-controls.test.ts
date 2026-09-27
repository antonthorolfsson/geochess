import type { CampaignView } from '@empire/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

/** Two players in a free-mode campaign on the six-country test map (values A9 B5 C3 D7 E2 F1). */
async function setup(start = true) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const created = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Lists',
    rules: { draft: { mode: 'free' } },
  });
  const id = created.body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  if (start) await ann.post(`/api/campaigns/${id}/draft/start`);
  const view = async (c: Client) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const order = (await view(ann)).draft?.order ?? [];
  const byId = { dev_ann: ann, dev_bo: bo } as Record<string, Client>;
  return { ann, bo, id, view, first: byId[order[0]!]!, second: byId[order[1]!]!, order };
}

const setList = (c: Client, id: string, territoryIds: string[]) =>
  c.put<{ territoryIds: string[] }>(`/api/campaigns/${id}/draft/list`, { territoryIds });

describe('ending the draft', () => {
  it('lets only the host end it, drafting the rest automatically', async () => {
    const { ann, bo, id, view, first, second, order } = await setup();
    const [p0, p1] = order;
    await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' });
    await setList(second, id, ['F', 'E']);

    expect((await bo.post(`/api/campaigns/${id}/draft/end`)).status).toBe(403);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);

    const after = await view(bo);
    expect(after.status).toBe('active');
    expect(after.round).toBe(1);
    expect(after.draft?.currentPicker).toBeNull();
    // Snake order p1 p1 p0 p0 p1 for the last five picks: p1 takes its list (F, E), then the best left.
    expect(after.holdings).toEqual({ A: p0, F: p1, E: p1, D: p0, B: p0, C: p1 });
    expect(after.members.map((m) => m.tokens)).toEqual([1, 1]);
    expect(after.myDraftList).toEqual([]);
    expect(after.events.at(-1)).toMatchObject({
      type: 'draft.ended',
      actorId: 'dev_ann',
      payload: {
        unclaimed: 0,
        autoPicked: 5,
        picks: [
          { userId: p1, territoryId: 'F' },
          { userId: p1, territoryId: 'E' },
          { userId: p0, territoryId: 'D' },
          { userId: p0, territoryId: 'B' },
          { userId: p1, territoryId: 'C' },
        ],
      },
    });

    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(409);
    expect((await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'B' })).status).toBe(409);
    expect((await setList(ann, id, ['B'])).status).toBe(409);
  });

  it('cannot end a draft that has not started', async () => {
    const { ann, id } = await setup(false);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(409);
  });
});

describe('draft lists', () => {
  it('can be prepared in the lobby, dropping unknown and repeated countries', async () => {
    const { ann, id, view } = await setup(false);
    const res = await setList(ann, id, ['D', 'NOPE', 'B', 'D']);
    expect(res.body.territoryIds).toEqual(['D', 'B']);
    expect((await view(ann)).myDraftList).toEqual(['D', 'B']);
  });

  it('stay private to their owner', async () => {
    const { ann, bo, id, view } = await setup(false);
    const socket = await listen(server.app, bo);
    await setList(ann, id, ['C', 'E']);
    await tick();
    socket.close();

    const bosView = await view(bo);
    expect(bosView.myDraftList).toEqual([]);
    expect(JSON.stringify(bosView)).not.toContain('"C","E"');
    expect(bosView.members.every((m) => !('draftList' in m))).toBe(true);
    expect(socket.messages.filter((m) => m.type !== 'hello')).toEqual([]);
  });

  it('drive auto-draft: claimed countries are skipped, then the best free one is taken', async () => {
    const { id, view, first, second, order } = await setup();
    await setList(first, id, ['E', 'C']);
    await setList(second, id, ['E', 'F']);
    await second.patch(`/api/campaigns/${id}/me`, { autodraft: true });
    await first.patch(`/api/campaigns/${id}/me`, { autodraft: true });

    const done = await view(first);
    const [p0, p1] = order;
    // Pick 1: first takes E. Picks 2–3: E is gone, so second takes F, then (list empty) A.
    // Picks 4–5: first takes C, then D. Pick 6: second takes B.
    expect(done.holdings).toEqual({ E: p0, F: p1, A: p1, C: p0, D: p0, B: p1 });
    expect(done.status).toBe('active');
    expect(done.myDraftList).toEqual([]);
  });

  it('lose countries as soon as anyone claims them', async () => {
    const { id, view, first, second } = await setup();
    await setList(second, id, ['E', 'F']);
    await first.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'E' });
    expect((await view(second)).myDraftList).toEqual(['F']);
  });

  it('are used by "pick for me" and by the host picking for a stalled player', async () => {
    const { ann, id, view, first, second, order } = await setup();
    await setList(first, id, ['D']);
    await first.post(`/api/campaigns/${id}/draft/autopick`);
    expect((await view(first)).holdings).toEqual({ D: order[0] });

    await setList(second, id, ['F', 'E']);
    await ann.post(`/api/campaigns/${id}/draft/autopick`);
    expect((await view(second)).holdings).toMatchObject({ F: order[1] });
    if (second !== ann) expect((await view(second)).events.at(-1)).toMatchObject({ actorId: 'dev_ann' });
  });
});

describe('auto-draft waiting when the list runs out', () => {
  it('works through the list, waits for the player, and resumes when the list or setting changes', async () => {
    const { id, view, first, second, order } = await setup();
    const [p0] = order;
    // Order p0 p1 | p1 p0 | p0 p1 on the test map (A9 B5 C3 D7 E2 F1).
    await setList(first, id, ['E']);
    await first.patch(`/api/campaigns/${id}/me`, { autodraftFallback: 'wait', autodraft: true });
    expect((await view(first)).holdings).toEqual({ E: p0 });

    await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'A' });
    await second.post(`/api/campaigns/${id}/draft/pick`, { territoryId: 'D' });
    let state = await view(first);
    expect(state.draft).toMatchObject({ pickIndex: 3, currentPicker: p0 });
    expect(state.myAutodraftFallback).toBe('wait');

    // Adding a country picks it at once, and the other player hears about the pick.
    const socket = await listen(server.app, second);
    const res = await setList(first, id, ['B']);
    await tick();
    socket.close();
    expect(res.body.territoryIds).toEqual([]);
    state = await view(first);
    expect(state.holdings).toMatchObject({ B: p0 });
    expect(state.draft).toMatchObject({ pickIndex: 4, currentPicker: p0 });
    expect(socket.messages.some((m) => m.type === 'campaign.events')).toBe(true);

    // Switching back to "keep picking" picks the best country left (C3 over F1).
    await first.patch(`/api/campaigns/${id}/me`, { autodraftFallback: 'best' });
    state = await view(first);
    expect(state.holdings).toMatchObject({ C: p0 });
    expect(state.draft).toMatchObject({ pickIndex: 5 });
  });

  it('still picks on an explicit "pick for me", and keeps the setting private', async () => {
    const { id, view, first, second, order } = await setup();
    await first.patch(`/api/campaigns/${id}/me`, { autodraftFallback: 'wait', autodraft: true });
    let state = await view(first);
    expect(state.draft).toMatchObject({ pickIndex: 0, currentPicker: order[0] });

    await first.post(`/api/campaigns/${id}/draft/autopick`);
    state = await view(first);
    expect(state.holdings).toEqual({ A: order[0] });
    expect((await view(second)).myAutodraftFallback).toBe('best');
  });
});
