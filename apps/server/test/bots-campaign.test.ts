import { seededRandom, type CampaignView } from '@empire/rules';
import { loadDataset } from '@empire/sim';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBotId } from '../src/bots/ids';
import { botState, loadSnapshot } from '../src/bots/state';
import { accords, missionPlayers } from '../src/db/schema';
import { newId } from '../src/lib/ids';
import { signIn, startTestServer, testEngine, type TestServer } from './helpers';

/** One person and three bots play a campaign on the real map, as a new campaign plays it. */
const idx = loadDataset();
/** Every game two bots play goes the same way: Black mates in two. */
const FOOLS_MATE = 'f2f3 e7e5 g2g4 d8h4'.split(' ');
let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(idx.dataset, {}, { engine: testEngine(FOOLS_MATE), random: seededRandom(11) });
});
afterAll(async () => {
  await server.close();
});

describe('a campaign with bots', () => {
  it('drafts, chooses secrets, goes to war and plays the games, seeing only what a player may', async () => {
    const host = await signIn(server.app, 'Host');
    const { body } = await host.post<{ id: string }>('/api/campaigns', { name: 'Solo Campaign' });
    const id = body.id;
    const view = async () => (await host.get<CampaignView>(`/api/campaigns/${id}`)).body;
    for (const level of [3, 5, 7]) expect((await host.post(`/api/campaigns/${id}/bots`, { level })).status).toBe(201);
    expect((await host.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await host.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    await server.bots();

    // The draft is over and every bot has chosen its secret mission; the host still has to.
    let v = await view();
    expect(v.status).toBe('selection');
    const bots = v.members.filter((m) => m.bot).map((m) => m.userId);
    expect(bots).toHaveLength(3);
    const db = server.app.ctx.db;
    const chosen = await db.select().from(missionPlayers).where(eq(missionPlayers.campaignId, id));
    for (const p of chosen) expect(p.secret !== null, p.userId).toBe(isBotId(p.userId));

    const option = v.mySecret!.options![0]!;
    expect((await host.post(`/api/campaigns/${id}/secret`, { optionId: option.id })).status).toBe(200);
    await server.bots();

    v = await view();
    expect(v.status).toBe('active');
    expect(v.round).toBe(1);
    // Declaring in turns: round 1 starts with the host, and the bots wait for them.
    expect(v.turns?.current).toBe(v.hostId);
    expect(v.events.some((e) => e.type === 'war.declared')).toBe(false);
    expect((await host.post(`/api/campaigns/${id}/turn/pass`, { userId: v.hostId })).status).toBe(200);
    await server.bots();

    // The bots take their turns, declaring and passing, until declaring is over for the round.
    v = await view();
    expect(v.turns?.current).toBeNull();
    const passed = v.events.filter((e) => e.type === 'turn.passed' && isBotId(e.actorId ?? ''));
    expect(passed.length).toBeGreaterThan(0);
    const declared = v.events.filter((e) => e.type === 'war.declared' && isBotId(e.actorId ?? ''));
    expect(declared.length).toBeGreaterThan(0);
    for (const w of v.wars) {
      // Bots answer at once, and wars between bots are fought to the end.
      if (isBotId(w.defenderId)) expect(w.status, `war on ${w.targetId}`).not.toBe('declared');
      if (isBotId(w.attackerId)) expect(w.status, `war on ${w.targetId}`).not.toBe('countered');
      if (isBotId(w.attackerId) && isBotId(w.defenderId)) expect(w.status).toBe('resolved');
    }
    expect(server.notices.filter((n) => isBotId(n.userId))).toEqual([]);

    // A proposal between two others stays theirs; a bot sees its own secret and no one else's.
    const [a, b, c] = bots as [string, string, string];
    await db.insert(accords).values({
      id: newId(),
      campaignId: id,
      proposerId: 'dev_host',
      recipientId: c,
      status: 'proposed',
      rounds: 2,
      proposedRound: 1,
      proposedAt: server.clock.now(),
    });
    const snap = (await loadSnapshot(server.app.ctx, id))!;
    const s = botState(server.app.ctx, snap, a, 1);
    // Some secrets are public by now (Backstab, say, once its accord is broken).
    const now = await db.select().from(missionPlayers).where(eq(missionPlayers.campaignId, id));
    const revealed = new Set(now.filter((p) => p.revealedAt).map((p) => p.userId));
    expect(s.byId.get(a)!.secret).not.toBeNull();
    for (const other of ['dev_host', b, c]) {
      const secret = s.byId.get(other)!.secret;
      if (revealed.has(other)) expect(secret, other).toEqual(now.find((p) => p.userId === other)!.secret);
      else expect(secret, other).toBeNull();
      expect(s.byId.get(other)!.options, other).toEqual([]);
    }
    expect(
      s.accords.filter((x) => x.status === 'proposed' && x.proposerId === 'dev_host' && x.recipientId === c),
    ).toEqual([]);
    expect(s.peaceOffers.every((o) => o.proposerId === a || o.recipientId === a)).toBe(true);
  });
});
