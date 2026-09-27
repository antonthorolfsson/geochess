import type {
  AccordView,
  CampaignSummary,
  CampaignView,
  ChatSummary,
  FeedPage,
  MessageView,
  MessagesPage,
} from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { PAGE_SIZE } from '../src/diplomacy/chat';
import { listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Accords, reputation and chat on the war test map. Ann holds the A countries, Bo the B countries
 * (plus Q2 and R2), and Cy holds nothing but watches everything.
 */
let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(warDataset());
});
afterAll(async () => {
  await server.close();
});

const ANN = 'dev_ann';
const BO = 'dev_bo';
const CY = 'dev_cy';
const HOUR = 3_600_000;
const OWNERS: Record<string, string> = {
  A1: ANN,
  A2: ANN,
  A3: ANN,
  A4: ANN,
  A6: ANN,
  B1: BO,
  B2: BO,
  B5: BO,
  B7: BO,
  B10: BO,
  Q2: BO,
  R2: BO,
};

async function setup({ status = 'active' }: { status?: 'lobby' | 'active' } = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const cy = await signIn(server.app, 'Cy');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', { name: 'Diplomacy' });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  await cy.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  if (status === 'active') {
    await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
    await db.insert(holdings).values(
      Object.entries(OWNERS).map(([territoryId, ownerId]) => ({
        campaignId: id,
        territoryId,
        ownerId,
        acquiredRound: 0,
      })),
    );
    await db.update(members).set({ tokens: 2 }).where(eq(members.campaignId, id));
  }

  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const accord = async (accordId: string, c: Client = ann) => (await view(c)).accords.find((a) => a.id === accordId);
  const reputation = async (userId: string) => (await view()).members.find((m) => m.userId === userId)!.reputation;
  const propose = (by: Client, partnerId: string, rounds = 3, terms?: string) =>
    by.post<{ id: string }>(`/api/campaigns/${id}/accords`, { partnerId, rounds, terms });
  const answer = (by: Client, accordId: string, answer: 'accept' | 'decline') =>
    by.post(`/api/campaigns/${id}/accords/${accordId}/answer`, { answer });
  const withdraw = (by: Client, accordId: string) => by.post(`/api/campaigns/${id}/accords/${accordId}/withdraw`);
  const renounce = (by: Client, accordId: string) => by.post(`/api/campaigns/${id}/accords/${accordId}/renounce`);
  const declare = (by: Client, targetId: string, launchId: string) =>
    by.post<{ id: string }>(`/api/campaigns/${id}/wars`, { targetId, launchId, stake: [launchId] });
  const nextRound = () => ann.post(`/api/campaigns/${id}/round/next`);
  /** Ann proposes a 3-round accord to Bo, and Bo signs it. */
  const signed = async () => {
    const { body: proposal } = await propose(ann, BO);
    expect((await answer(bo, proposal.id, 'accept')).status).toBe(200);
    return proposal.id;
  };
  const say = (by: Client, body: string, to?: string) =>
    by.post<MessageView>(`/api/campaigns/${id}/messages`, { body, ...(to ? { to } : {}) });
  const feed = (by: Client, filter = 'all', before?: string) =>
    by.get<FeedPage>(
      `/api/campaigns/${id}/feed?filter=${filter}${before !== undefined ? `&before=${encodeURIComponent(before)}` : ''}`,
    );
  const conversation = (by: Client, peer: string) => by.get<MessagesPage>(`/api/campaigns/${id}/messages?with=${peer}`);
  const summary = async (by: Client) => (await by.get<ChatSummary>(`/api/campaigns/${id}/chat`)).body;
  return {
    ann,
    bo,
    cy,
    id,
    view,
    accord,
    reputation,
    propose,
    answer,
    withdraw,
    renounce,
    declare,
    nextRound,
    signed,
    say,
    feed,
    conversation,
    summary,
  };
}

describe('proposing an accord', () => {
  it('is private to the two players until it is signed', async () => {
    const { ann, bo, cy, id, view, propose } = await setup();
    const boSocket = await listen(server.app, bo);
    const cySocket = await listen(server.app, cy);
    const eventsBefore = (await view()).events.length;

    const res = await propose(ann, BO, 3, '  Bo keeps out of the A countries.  ');
    expect(res.status).toBe(201);
    const mine = (await view(ann)).accords.find((a) => a.id === res.body.id);
    expect(mine).toMatchObject({
      proposerId: ANN,
      recipientId: BO,
      status: 'proposed',
      rounds: 3,
      terms: 'Bo keeps out of the A countries.',
      endsRound: null,
      respondBy: new Date(server.clock.now().getTime() + 24 * HOUR).toISOString(),
    });
    expect((await view(bo)).accords.map((a) => a.id)).toEqual([res.body.id]);
    expect((await view(cy)).accords).toEqual([]);
    expect((await view()).events).toHaveLength(eventsBefore);

    await tick();
    expect(boSocket.messages).toContainEqual({ type: 'campaign.changed', campaignId: id });
    expect(cySocket.messages.filter((m) => m.type !== 'hello')).toEqual([]);
    expect(server.notices.at(-1)).toMatchObject({
      userId: BO,
      title: 'Ann proposes an accord',
      url: `/c/${id}?accord=${res.body.id}`,
      email: true,
    });
    const attention = (await bo.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)?.attention;
    expect(attention).toBe(1);
    boSocket.close();
    cySocket.close();
  });

  it('checks the partner, the length, the terms, and one waiting proposal per pair', async () => {
    const { ann, bo, propose } = await setup();
    expect((await propose(ann, ANN)).body).toMatchObject({ error: { code: 'self' } });
    expect((await propose(ann, 'dev_nobody')).body).toMatchObject({ error: { code: 'not-member' } });
    expect((await propose(ann, BO, 11)).status).toBe(400);
    expect((await propose(ann, BO, 3, 'x'.repeat(281))).body).toMatchObject({ error: { code: 'terms-too-long' } });
    expect((await propose(ann, BO)).status).toBe(201);
    expect((await propose(ann, BO)).body).toMatchObject({ error: { code: 'pending' } });
    expect((await propose(bo, ANN)).body).toMatchObject({ error: { code: 'pending' } });
    expect((await propose(ann, CY)).status).toBe(201);
  });

  it('limits how often one player can propose to another', async () => {
    const { ann, id, propose, withdraw } = await setup();
    const before = server.notices.length;
    for (let i = 0; i < 4; i++) {
      const res = await propose(ann, BO);
      expect(res.status).toBe(201);
      await withdraw(ann, res.body.id);
    }
    expect((await propose(ann, BO)).status).toBe(429);
    expect((await propose(ann, CY)).status).toBe(201);
    await tick();
    // Every proposal from Ann carries the same tag, so the email cooldown covers them all.
    const toBo = server.notices.slice(before).filter((n) => n.userId === BO);
    expect(new Set(toBo.map((n) => n.tag))).toEqual(new Set([`accord:${id}:${ANN}`]));
    server.clock.advance(HOUR);
    expect((await propose(ann, BO)).status).toBe(201);
  });

  it('waits for the draft', async () => {
    const { ann, propose } = await setup({ status: 'lobby' });
    expect((await propose(ann, BO)).body).toMatchObject({ error: { code: 'closed' } });
  });

  it('can be declined, withdrawn, or left to lapse', async () => {
    const { ann, bo, cy, accord, propose, answer, withdraw } = await setup();
    const declined = (await propose(ann, BO)).body.id;
    expect((await answer(ann, declined, 'accept')).status).toBe(403);
    expect((await answer(cy, declined, 'accept')).status).toBe(404);
    expect((await answer(bo, declined, 'decline')).status).toBe(200);
    expect(await accord(declined)).toMatchObject({ status: 'declined', respondBy: null });
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'Bo declined your accord' });
    expect((await answer(bo, declined, 'accept')).body).toMatchObject({ error: { code: 'already-answered' } });

    const withdrawn = (await propose(ann, BO)).body.id;
    expect((await withdraw(bo, withdrawn)).status).toBe(403);
    expect((await withdraw(ann, withdrawn)).status).toBe(200);
    expect(await accord(withdrawn)).toMatchObject({ status: 'withdrawn' });

    const lapsed = (await propose(bo, ANN)).body.id;
    server.clock.advance(23 * HOUR);
    await server.runDue();
    expect(await accord(lapsed)).toMatchObject({ status: 'proposed' });
    server.clock.advance(HOUR);
    await server.runDue();
    expect(await accord(lapsed)).toMatchObject({ status: 'lapsed' });
  });
});

describe('a signed accord', () => {
  it('is public and stops wars both ways until it runs its course', async () => {
    const { ann, bo, cy, view, accord, declare, signed } = await setup();
    const accordId = await signed();
    expect(await accord(accordId, cy)).toMatchObject({ status: 'active', signedRound: 1, endsRound: 4 });
    expect((await view(cy)).events.at(-1)).toMatchObject({
      type: 'accord.signed',
      actorId: BO,
      payload: { accordId, proposerId: ANN, recipientId: BO, rounds: 3, endsRound: 4, renews: null },
    });
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'Bo signed your accord' });
    expect((await declare(ann, 'B5', 'A4')).body).toMatchObject({ error: { code: 'accord' } });
    expect((await declare(bo, 'A4', 'B5')).body).toMatchObject({ error: { code: 'accord' } });
  });

  it('pays both partners 2 reputation for every whole round it holds', async () => {
    const { ann, view, accord, reputation, declare, nextRound, signed } = await setup();
    const accordId = await signed(); // During round 1, for 3 rounds: over when round 4 starts.
    await nextRound(); // Round 1 was only partly covered.
    expect([await reputation(ANN), await reputation(BO)]).toEqual([100, 100]);
    await nextRound(); // Round 2 held.
    expect([await reputation(ANN), await reputation(BO), await reputation(CY)]).toEqual([102, 102, 100]);
    expect((await view()).events.slice(-2)).toMatchObject([
      { type: 'round.started' },
      {
        type: 'reputation.earned',
        payload: {
          heldRound: 2,
          gains: [
            { userId: ANN, delta: 2, reputation: 102 },
            { userId: BO, delta: 2, reputation: 102 },
          ],
        },
      },
    ]);
    expect(await accord(accordId)).toMatchObject({ status: 'active' });
    expect((await declare(ann, 'B5', 'A4')).body).toMatchObject({ error: { code: 'accord' } });

    await nextRound(); // Round 4 starts: round 3 held, and the accord is over.
    expect(await accord(accordId)).toMatchObject({ status: 'kept', endedRound: 4 });
    expect([await reputation(ANN), await reputation(BO)]).toEqual([104, 104]);
    const tail = (await view()).events.slice(-3).map((e) => e.type);
    expect(tail).toEqual(['round.started', 'reputation.earned', 'accord.kept']);
    await tick();
    expect(server.notices.slice(-2)).toMatchObject([
      { title: 'Your accord with Bo has run its course', body: 'You may declare war on each other again.' },
      { title: 'Your accord with Ann has run its course' },
    ]);
    expect((await declare(ann, 'B5', 'A4')).status).toBe(201);
  });

  it('can be signed during the draft, which counts as round 0 and pays nothing', async () => {
    const { ann, bo, id, accord, reputation, propose, answer, nextRound } = await setup({ status: 'lobby' });
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    const short = (await propose(ann, BO, 1)).body.id;
    const long = (await propose(bo, CY, 3)).body.id;
    await answer(bo, short, 'accept');
    await answer(await signIn(server.app, 'Cy'), long, 'accept');
    expect(await accord(short)).toMatchObject({ status: 'active', signedRound: 0, endsRound: 1 });
    // Ending the draft starts round 1, which is as far as a one-round accord reaches.
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    expect(await accord(short)).toMatchObject({ status: 'kept', endedRound: 1 });
    expect(await accord(long)).toMatchObject({ status: 'active', endsRound: 3 });
    expect([await reputation(ANN), await reputation(BO), await reputation(CY)]).toEqual([100, 100, 100]);
    // Round 1 is the first round of war, so the accord held since the draft is paid for it.
    await nextRound();
    expect([await reputation(ANN), await reputation(BO), await reputation(CY)]).toEqual([100, 102, 102]);
  });

  it('can be renewed by signing a new one, which replaces it', async () => {
    const { ann, bo, view, accord, propose, answer, nextRound, signed } = await setup();
    const first = await signed();
    await nextRound();
    const renewal = (await propose(bo, ANN, 5)).body.id;
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'Bo proposes renewing your accord' });
    expect((await answer(ann, renewal, 'accept')).status).toBe(200);
    expect(await accord(first)).toMatchObject({ status: 'renewed', endedRound: 2 });
    expect(await accord(renewal)).toMatchObject({ status: 'active', endsRound: 7, renews: first });
    expect((await view()).accords.filter((a: AccordView) => a.status === 'active')).toHaveLength(1);
    expect((await view()).members.every((m) => m.reputation === 100)).toBe(true);
    // Renewing carries the accord on: round 2, covered by one then the other, is paid.
    await nextRound();
    expect((await view()).members.map((m) => m.reputation)).toEqual([102, 102, 100]);
  });
});

describe('breaking an accord', () => {
  it('ends it at once, costs the breaker 20 reputation, and makes them wait a round to attack', async () => {
    const { ann, bo, cy, id, view, accord, reputation, renounce, declare, nextRound, signed } = await setup();
    const accordId = await signed();
    expect((await renounce(cy, accordId)).status).toBe(403);
    const cySocket = await listen(server.app, cy);
    expect((await renounce(bo, accordId)).status).toBe(200);
    expect(await accord(accordId, cy)).toMatchObject({ status: 'broken', brokenBy: BO, endedRound: 1 });
    expect(await reputation(BO)).toBe(80);
    expect(await reputation(ANN)).toBe(100);
    expect((await view(cy)).events.slice(-2)).toMatchObject([
      { type: 'accord.broken', actorId: BO, payload: { accordId, breakerId: BO, partnerId: ANN } },
      { type: 'reputation.changed', payload: { userId: BO, delta: -20, reputation: 80, reason: 'accord-broken' } },
    ]);
    await tick();
    expect(cySocket.messages.some((m) => m.type === 'campaign.events' && m.campaignId === id)).toBe(true);
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'Bo broke your accord' });
    expect((await renounce(ann, accordId)).body).toMatchObject({ error: { code: 'not-in-force' } });

    // The breaker must wait for the next round; the betrayed player may strike first.
    expect((await declare(bo, 'A4', 'B5')).body).toMatchObject({ error: { code: 'renounced' } });
    expect((await declare(ann, 'B2', 'A3')).status).toBe(201);
    await nextRound();
    expect((await declare(bo, 'A4', 'B5')).status).toBe(201);
    cySocket.close();
  });
});

describe('chat', () => {
  it('shares channel messages with everyone and private ones with two players', async () => {
    const { ann, bo, cy, id, say, conversation } = await setup({ status: 'lobby' });
    const annSocket = await listen(server.app, ann);
    const cySocket = await listen(server.app, cy);

    const hello = await say(bo, '  Hello, generals.  ');
    expect(hello.status).toBe(201);
    expect(hello.body).toMatchObject({ authorId: BO, recipientId: null, body: 'Hello, generals.', removed: null });
    const secret = await say(bo, 'Ann, a word?', ANN);
    expect(secret.body).toMatchObject({ authorId: BO, recipientId: ANN, body: 'Ann, a word?' });
    await tick();
    const chat = (messages: typeof annSocket.messages) =>
      messages.flatMap((m) => (m.type === 'chat.message' && m.campaignId === id ? [m.message.id] : []));
    expect(chat(annSocket.messages)).toEqual([hello.body.id, secret.body.id]);
    expect(chat(cySocket.messages)).toEqual([hello.body.id]);

    expect((await conversation(ann, BO)).body.messages.map((m) => m.body)).toEqual(['Ann, a word?']);
    expect((await conversation(cy, BO)).body.messages).toEqual([]);
    expect((await conversation(cy, ANN)).body.messages).toEqual([]);
    annSocket.close();
    cySocket.close();
  });

  it('checks messages and who they go to', async () => {
    const { ann, say } = await setup({ status: 'lobby' });
    expect((await say(ann, '   ')).status).toBe(400);
    expect((await say(ann, 'x'.repeat(1001))).status).toBe(400);
    expect((await say(ann, 'x'.repeat(1000))).status).toBe(201);
    expect((await say(ann, 'Talking to myself', ANN)).body).toMatchObject({ error: { code: 'bad-recipient' } });
    expect((await say(ann, 'Anyone there?', 'dev_nobody')).body).toMatchObject({ error: { code: 'bad-recipient' } });
    const stranger = await signIn(server.app, 'Stranger');
    expect((await say(stranger, 'Let me in')).status).toBe(404);
  });

  it('stops floods', async () => {
    const { cy, say } = await setup({ status: 'lobby' });
    for (let i = 0; i < 8; i++) expect((await say(cy, `Spam ${i}`)).status).toBe(201);
    expect((await say(cy, 'One more')).status).toBe(429);
    server.clock.advance(10_000);
    expect((await say(cy, 'Calmer now')).status).toBe(201);
  });

  it('pushes private messages, at most once a minute per conversation', async () => {
    const { ann, bo, id, say } = await setup({ status: 'lobby' });
    const before = server.notices.length;
    await say(ann, 'First', BO);
    await say(ann, 'Second', BO);
    await say(ann, 'To everyone');
    await tick();
    expect(server.notices.slice(before)).toEqual([
      { userId: BO, title: 'Message from Ann', body: 'First', url: `/c/${id}?chat=${ANN}`, tag: `chat:${id}:${ANN}` },
    ]);
    server.clock.advance(61_000);
    await say(ann, 'Third', BO);
    await say(bo, 'Reply', ANN);
    await tick();
    expect(server.notices.slice(before + 1).map((n) => [n.userId, n.body])).toEqual([
      [BO, 'Third'],
      [ANN, 'Reply'],
    ]);
  });

  it('counts unread messages until they are read', async () => {
    const { ann, bo, cy, id, say, summary } = await setup({ status: 'lobby' });
    await say(ann, 'Morning all');
    const dm = (await say(ann, 'Psst', BO)).body;
    await say(cy, 'Morning');
    expect(await summary(bo)).toEqual({
      channelUnread: 2,
      conversations: [{ userId: ANN, unread: 1, last: dm }],
    });
    expect((await summary(ann)).channelUnread).toBe(1);
    const unread = async () =>
      (await bo.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)?.unread;
    expect(await unread()).toBe(1);

    const boSocket = await listen(server.app, bo);
    await bo.post(`/api/campaigns/${id}/chat/read`, { with: ANN, lastId: dm.id });
    // Reading can't reach past the newest message, and read positions only move forward.
    await bo.post(`/api/campaigns/${id}/chat/read`, { lastId: dm.id + 100 });
    await bo.post(`/api/campaigns/${id}/chat/read`, { lastId: 1 });
    expect(await summary(bo)).toMatchObject({ channelUnread: 0, conversations: [{ userId: ANN, unread: 0 }] });
    expect(await unread()).toBe(0);
    await tick();
    expect(boSocket.messages).toContainEqual({ type: 'chat.read', campaignId: id });
    await say(cy, 'Still there?');
    expect((await summary(bo)).channelUnread).toBe(1);
    boSocket.close();
  });

  it('stops counting messages from a player who left', async () => {
    const { ann, bo, id, say, summary } = await setup({ status: 'lobby' });
    await say(bo, 'Before I go, a word.', ANN);
    expect((await summary(ann)).conversations).toMatchObject([{ userId: BO, unread: 1 }]);
    expect((await bo.post(`/api/campaigns/${id}/leave`)).status).toBe(200);
    expect((await summary(ann)).conversations).toMatchObject([{ userId: BO, unread: 0 }]);
    const home = (await ann.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id);
    expect(home?.unread).toBe(0);
  });

  it('lets authors delete their messages and the host remove channel messages', async () => {
    const { ann, bo, cy, id, say, feed } = await setup({ status: 'lobby' });
    const mine = (await say(bo, 'Regrettable')).body;
    const rude = (await say(cy, 'Rude remark')).body;
    const whisper = (await say(bo, 'Just between us', CY)).body;
    const del = (by: Client, messageId: number) => by.del<MessageView>(`/api/campaigns/${id}/messages/${messageId}`);

    expect((await del(cy, mine.id)).status).toBe(403);
    expect((await del(bo, mine.id)).body).toMatchObject({ id: mine.id, body: null, removed: 'author' });
    expect((await del(ann, rude.id)).body).toMatchObject({ id: rude.id, body: null, removed: 'host' });
    // The host can't see, let alone remove, other players' private messages.
    expect((await del(ann, whisper.id)).status).toBe(404);
    expect((await del(cy, whisper.id)).status).toBe(403);
    expect((await del(bo, whisper.id)).body).toMatchObject({ removed: 'author' });

    const items = (await feed(ann, 'chat')).body.items;
    expect(items.map((i) => (i.kind === 'message' ? [i.message.id, i.message.body] : null))).toEqual([
      [rude.id, null],
      [mine.id, null],
    ]);
  });
});

describe('the feed', () => {
  it('merges dispatches and the channel, newest first, with filters', async () => {
    const { ann, bo, feed, say, signed, declare } = await setup();
    // Timestamps come from the database's real clock; keep each step in a millisecond of its own.
    await say(ann, 'Shall we?');
    await tick(5);
    expect((await declare(ann, 'Q2', 'A2')).status).toBe(201);
    await tick(5);
    // A war already underway doesn't stop the two from signing an accord.
    await signed();
    await tick(5);
    await say(bo, 'Peace in our time.');

    const kinds = (page: FeedPage) =>
      page.items.map((i) => (i.kind === 'event' ? i.event.type : `chat: ${i.message.body}`));
    expect(kinds((await feed(ann)).body).slice(0, 4)).toEqual([
      'chat: Peace in our time.',
      'accord.signed',
      'war.declared',
      'chat: Shall we?',
    ]);
    expect(kinds((await feed(ann, 'wars')).body)).toEqual(['war.declared']);
    expect(kinds((await feed(ann, 'accords')).body)).toEqual(['accord.signed']);
    expect(kinds((await feed(ann, 'chat')).body)).toEqual(['chat: Peace in our time.', 'chat: Shall we?']);
    const stranger = await signIn(server.app, 'Stranger');
    expect((await feed(stranger)).status).toBe(404);
    expect((await feed(ann, 'all', '99999999999999999999.1')).status).toBe(400);
  });

  it('pages back through everything once', async () => {
    const { ann, bo, cy, feed, say } = await setup({ status: 'lobby' });
    const sent: number[] = [];
    for (let i = 0; i < PAGE_SIZE + 10; i++) {
      server.clock.advance(10_000); // Stay under the flood limit.
      sent.push((await say([ann, bo, cy][i % 3]!, `Message ${i}`)).body.id);
    }
    const seen: string[] = [];
    let before: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const page = (await feed(ann, 'all', before)).body;
      seen.push(...page.items.map((i) => (i.kind === 'event' ? `e${i.event.id}` : `m${i.message.id}`)));
      if (!page.next) break;
      before = page.next;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const messageIds = seen.filter((k) => k.startsWith('m')).map((k) => Number(k.slice(1)));
    expect(messageIds).toEqual([...sent].reverse());
    // The campaign's own dispatches (created, three joins) come last.
    expect(seen.filter((k) => k.startsWith('e'))).toHaveLength(3);
  });
});
