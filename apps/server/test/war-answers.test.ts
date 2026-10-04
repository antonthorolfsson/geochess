import type {
  CampaignRulesInput,
  CampaignStats,
  CampaignSummary,
  CampaignView,
  GameView,
  PeaceTerms,
  Territory,
  WarView,
} from '@empire/rules';
import { REVISED_WAR_RULES, WHITE_PEACE } from '@empire/rules';
import { makeTerritory, warDataset } from '@empire/rules/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { ORIGINAL_ANSWERS, signIn, startTestServer, type Client, type TestServer } from './helpers';

/**
 * The revised answers new campaigns play: matched and token raises, reserves, nearby redirects
 * that cost a token, fortifying, calling a declaration off, and peace terms. On the war test map
 * Ann holds A1 A2 A3 A4 A6 and Bo holds B1 B2 B5 B7 B10 Q2 R2; values are in the ids. Ann attacks,
 * so she plays White.
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
const SCHOLARS_MATE = 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'.split(' ');
const FOOLS_MATE = 'f2f3 e7e5 g2g4 d8h4'.split(' ');

const terms = (over: Partial<PeaceTerms> = {}): PeaceTerms => ({ ...WHITE_PEACE, ...over });

/**
 * An active campaign in round 1 with the map split between Ann and Bo (and Cy, holding nothing,
 * when asked for), on the rules a new campaign gets unless `rules` says otherwise.
 */
async function setup(
  rules: CampaignRulesInput = {},
  tokens: { ann?: number; bo?: number } = {},
  opts: { owners?: Record<string, string>; cy?: boolean } = {},
  srv: TestServer = server,
) {
  const ann = await signIn(srv.app, 'Ann');
  const bo = await signIn(srv.app, 'Bo');
  const cy = opts.cy ? await signIn(srv.app, 'Cy') : null;
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Peace Talks',
    rules: { victory: { mode: 'open' }, ...rules },
  });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  if (cy) await cy.post(`/api/invites/${inviteCode}/join`);
  const db = srv.app.ctx.db;
  await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    Object.entries(opts.owners ?? OWNERS).map(([territoryId, ownerId]) => ({
      campaignId: id,
      territoryId,
      ownerId,
      acquiredRound: 0,
    })),
  );
  for (const [userId, n] of [
    [ANN, tokens.ann ?? 1],
    [BO, tokens.bo ?? 1],
  ] as const) {
    await db
      .update(members)
      .set({ tokens: n })
      .where(and(eq(members.campaignId, id), eq(members.userId, userId)));
  }

  const url = `/api/campaigns/${id}`;
  const view = async (c: Client = ann) => (await c.get<CampaignView>(url)).body;
  const war = async (warId: string, c: Client = ann) => (await view(c)).wars.find((w) => w.id === warId)!;
  const tokensNow = async () => {
    const v = await view();
    const of = (userId: string) => v.members.find((m) => m.userId === userId)!.tokens;
    return { ann: of(ANN), bo: of(BO) };
  };
  const declare = (targetId: string, launchId: string, stake: string[], extra: { reserves?: string[] } = {}) =>
    ann.post<{ id: string }>(`${url}/wars`, { targetId, launchId, stake, ...extra });
  const respond = (warId: string, response: object) => bo.post(`${url}/wars/${warId}/respond`, response);
  const reply = (warId: string, answer: object) => ann.post(`${url}/wars/${warId}/reply`, answer);
  const offer = (by: Client, warId: string, t: PeaceTerms) =>
    by.post<{ id: string }>(`${url}/wars/${warId}/peace`, { terms: t });
  const answer = (by: Client, warId: string, offerId: string, a: 'accept' | 'decline') =>
    by.post(`${url}/wars/${warId}/peace/${offerId}/answer`, { answer: a });
  const fortify = (by: Client, territoryId: string) =>
    by.post<{ untilRound: number }>(`${url}/fortify`, { territoryId });
  const game = async (w: WarView) => (await ann.get<GameView>(`/api/games/${w.games.at(-1)!.id}`)).body;
  /** Plays `moves` from the current position, alternating players as the colors dictate. */
  const play = async (g: GameView, moves: string[]) => {
    let ply = g.moves.length;
    for (const uci of moves) {
      const mover = ply % 2 === 0 ? g.whiteId : g.blackId;
      const res = await (mover === ANN ? ann : bo).post<GameView>(`/api/games/${g.id}/move`, { uci, ply });
      expect(res.status, `${uci}: ${JSON.stringify(res.body)}`).toBe(200);
      ply++;
    }
  };
  const nextRound = () => ann.post(`${url}/round/next`);
  return {
    ann,
    bo,
    cy,
    id,
    url,
    view,
    war,
    tokensNow,
    declare,
    respond,
    reply,
    offer,
    answer,
    fortify,
    game,
    play,
    nextRound,
  };
}

describe('new campaigns', () => {
  it('play the revised answers; campaigns stored before them keep the original ones', async () => {
    const s = await setup();
    expect((await s.view()).rules.war).toMatchObject(REVISED_WAR_RULES);
    const old = await setup({ war: ORIGINAL_ANSWERS });
    expect((await old.view()).rules.war).toMatchObject(ORIGINAL_ANSWERS);
  });
});

describe('matched raises', () => {
  it('put in one of the defender’s countries, worth half the target to all of it, which the attacker must match', async () => {
    const s = await setup();
    // B7 (7) over the sea from A6.
    const { body } = await s.declare('B7', 'A6', ['A6']);
    expect((await s.respond(body.id, { response: 'raise' })).body).toMatchObject({ error: { code: 'raise-country' } });
    // B10 is worth more than the target, B2 less than half of it.
    for (const territoryId of ['B10', 'B2']) {
      expect((await s.respond(body.id, { response: 'raise', territoryId })).body).toMatchObject({
        error: { code: 'bad-raise' },
      });
    }
    expect((await s.respond(body.id, { response: 'raise', territoryId: 'B5' })).status).toBe(200);
    // The stake (A6, 6) must grow by at least B5's 5.
    expect(await s.war(body.id)).toMatchObject({
      status: 'countered',
      counter: { kind: 'raise', minValue: 11, added: 'B5' },
    });
    expect((await s.reply(body.id, { reply: 'accept', stake: ['A6', 'A2'] })).body).toMatchObject({
      error: { code: 'too-small' },
    });
    expect((await s.reply(body.id, { reply: 'accept', stake: ['A6', 'A2', 'A3'] })).status).toBe(200);
    const w = await s.war(body.id);
    expect(w).toMatchObject({ status: 'playing', stake: ['A6', 'A2', 'A3'] });
    // Winning takes both countries.
    await s.play(await s.game(w), SCHOLARS_MATE);
    expect((await s.view()).holdings).toMatchObject({ B7: ANN, B5: ANN, A6: ANN, A2: ANN, A3: ANN });
  });

  it('pay the defender the bigger stake when they win', async () => {
    const s = await setup();
    const { body } = await s.declare('B7', 'A6', ['A6']);
    await s.respond(body.id, { response: 'raise', territoryId: 'B5' });
    await s.reply(body.id, { reply: 'accept', stake: ['A6', 'A2', 'A3'] });
    await s.play(await s.game(await s.war(body.id)), FOOLS_MATE);
    expect((await s.view()).holdings).toMatchObject({ B7: BO, B5: BO, A6: BO, A2: BO, A3: BO });
  });

  it('are met at once by reserves set aside at the declaration', async () => {
    const s = await setup({}, { ann: 2 });
    const res = await s.declare('B7', 'A6', ['A6'], { reserves: ['A2', 'A3', 'A1'] });
    expect(res.status).toBe(201);
    expect(await s.war(res.body.id)).toMatchObject({ reserves: ['A2', 'A3', 'A1'] });
    // Reserves are tied up while the declaration waits: A3 can't launch another attack.
    expect((await s.declare('B2', 'A3', ['A3'])).body).toMatchObject({ error: { code: 'no-launcher' } });
    await s.respond(res.body.id, { response: 'raise', territoryId: 'B5' });
    // A2 and A3 (5) cover B5 (5); A1 isn't needed and is free again.
    expect(await s.war(res.body.id)).toMatchObject({ status: 'playing', stake: ['A6', 'A2', 'A3'] });
    const reply = (await s.view()).events.find((e) => e.type === 'war.reply');
    expect(reply).toMatchObject({ actorId: ANN, payload: { reply: 'accept', fromReserves: true, auto: false } });
  });

  it('refuse reserves the rules have no use for', async () => {
    const s = await setup({ war: { raise: 'off' } });
    expect((await s.declare('B5', 'A4', ['A4'], { reserves: ['A3'] })).body).toMatchObject({
      error: { code: 'no-raise' },
    });
    expect((await s.declare('B5', 'A4', ['A4'], { reserves: ['A6'] })).body).toMatchObject({
      error: { code: 'no-raise' },
    });
    const t = await setup();
    expect((await t.declare('B5', 'A4', ['A4'], { reserves: ['A6'] })).body).toMatchObject({
      error: { code: 'not-connected' },
    });
  });
});

describe('token raises', () => {
  it('cost the defender a token, which the attacker gets for meeting them', async () => {
    const s = await setup({ war: { raise: 'token' } });
    const { body } = await s.declare('B5', 'A4', ['A4']);
    expect((await s.respond(body.id, { response: 'raise' })).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({ counter: { kind: 'raise', minValue: 7, tokens: 1 } });
    expect(await s.tokensNow()).toEqual({ ann: 0, bo: 0 });
    await s.reply(body.id, { reply: 'accept', stake: ['A4', 'A3'] });
    expect(await s.tokensNow()).toEqual({ ann: 1, bo: 0 });
  });

  it('need a token, and a withdrawal spends both', async () => {
    const broke = await setup({ war: { raise: 'token' } }, { bo: 0 });
    const declared = await broke.declare('B5', 'A4', ['A4']);
    expect((await broke.respond(declared.body.id, { response: 'raise' })).body).toMatchObject({
      error: { code: 'no-tokens' },
    });
    const s = await setup({ war: { raise: 'token' } });
    const { body } = await s.declare('B5', 'A4', ['A4']);
    await s.respond(body.id, { response: 'raise' });
    await s.reply(body.id, { reply: 'withdraw' });
    expect(await s.war(body.id)).toMatchObject({ status: 'resolved', outcome: 'withdrawn' });
    expect(await s.tokensNow()).toEqual({ ann: 0, bo: 0 });
  });

  it('wait for the attacker when the reserves fall short', async () => {
    const s = await setup({ war: { raise: 'token' } });
    // B7 (7) from A6 over the sea: a raise demands 9, and A2 only brings the stake to 8.
    const { body } = await s.declare('B7', 'A6', ['A6'], { reserves: ['A2'] });
    await s.respond(body.id, { response: 'raise' });
    expect(await s.war(body.id)).toMatchObject({ status: 'countered', counter: { minValue: 9 } });
    expect((await s.reply(body.id, { reply: 'accept', stake: ['A6', 'A2', 'A1'] })).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({ status: 'playing', stake: ['A6', 'A2', 'A1'] });
  });

  it('can be switched off', async () => {
    const s = await setup({ war: { raise: 'off' } });
    const { body } = await s.declare('B5', 'A4', ['A4']);
    expect((await s.respond(body.id, { response: 'raise' })).body).toMatchObject({ error: { code: 'no-raise' } });
  });
});

describe('redirects', () => {
  it('cost the defender a token, which the attacker gets for fighting on', async () => {
    const s = await setup({ war: { redirect: 'anywhere' } });
    const { body } = await s.declare('B2', 'A3', ['A3']);
    await s.respond(body.id, { response: 'redirect', targetId: 'Q2' });
    expect(await s.war(body.id)).toMatchObject({ counter: { kind: 'redirect', targetId: 'Q2', tokens: 1 } });
    expect(await s.tokensNow()).toEqual({ ann: 0, bo: 0 });
    await s.reply(body.id, { reply: 'accept' });
    expect(await s.tokensNow()).toEqual({ ann: 1, bo: 0 });
    expect(await s.war(body.id)).toMatchObject({ status: 'playing', targetId: 'Q2', redirectedFrom: 'B2' });
  });

  it('must stay near the target', async () => {
    const s = await setup();
    const { body } = await s.declare('B2', 'A3', ['A3']);
    // Q2 is worth the same and borders Ann, but not B2.
    expect((await s.respond(body.id, { response: 'redirect', targetId: 'Q2' })).body).toMatchObject({
      error: { code: 'bad-redirect' },
    });
  });
});

describe('nearby redirects on their own map', () => {
  // Ann holds L and M; Bo holds T (mountains), N and F, all worth 3. N borders T; F only M.
  let small: TestServer;
  beforeAll(async () => {
    const t = (id: string, land: string[], mountains = false): Territory => ({
      ...makeTerritory(id, 3, land),
      terrain: mountains ? ['mountains'] : [],
    });
    small = await startTestServer({
      version: 'war-test',
      generatedAt: '2026-01-01T00:00:00.000Z',
      attribution: [],
      territories: [
        t('L', ['M', 'N', 'T']),
        t('M', ['F', 'L']),
        t('T', ['L', 'N'], true),
        t('N', ['L', 'T']),
        t('F', ['M']),
      ],
      seaLanes: [],
    });
  });
  afterAll(async () => {
    await small.close();
  });

  it('keep the clock of the country first attacked', async () => {
    const s = await setup({}, {}, { owners: { L: ANN, M: ANN, T: BO, N: BO, F: BO } }, small);
    const { body } = await s.declare('T', 'L', ['L']);
    expect((await s.respond(body.id, { response: 'redirect', targetId: 'F' })).body).toMatchObject({
      error: { code: 'bad-redirect' },
    });
    expect((await s.respond(body.id, { response: 'redirect', targetId: 'N' })).status).toBe(200);
    await s.reply(body.id, { reply: 'accept' });
    const w = await s.war(body.id);
    expect(w).toMatchObject({ targetId: 'N', redirectedFrom: 'T' });
    // T's home turf and mountains (+20%) against one supply line (−5%): Bo (Black) gets 15% more.
    const g = (await s.ann.get<GameView>(`/api/games/${w.games[0]!.id}`)).body;
    expect(g.timeControl).toMatchObject({
      kind: 'correspondence',
      white: { perMoveMs: 24 * HOUR },
      black: { perMoveMs: Math.round(24 * HOUR * 1.15) },
    });
  });
});

describe('fortifying', () => {
  it('costs a token and raises what a war on the country needs until the round after next', async () => {
    const s = await setup({}, { ann: 2, bo: 1 });
    const res = await s.fortify(s.bo, 'B7');
    expect(res.body).toEqual({ untilRound: 3 });
    const v = await s.view();
    expect(v.fortified).toEqual({ B7: 3 });
    expect(v.members.find((m) => m.userId === BO)!.tokens).toBe(0);
    expect(v.events.at(-1)).toMatchObject({
      type: 'country.fortified',
      actorId: BO,
      payload: { userId: BO, territoryId: 'B7', untilRound: 3 },
    });
    expect((await s.fortify(s.bo, 'B5')).body).toMatchObject({ error: { code: 'no-tokens' } });
    expect((await s.fortify(s.ann, 'B5')).body).toMatchObject({ error: { code: 'not-yours' } });
    // Fortified B7 (7) needs 9, not 6: A6 alone won't do, A6, A2 and A1 will.
    expect((await s.declare('B7', 'A6', ['A6'])).body).toMatchObject({ error: { code: 'too-small' } });
    expect((await s.declare('B7', 'A6', ['A6', 'A2', 'A1'])).status).toBe(201);
    await s.nextRound();
    expect((await s.view()).fortified).toEqual({ B7: 3 });
    await s.nextRound();
    expect((await s.view()).fortified).toEqual({});
  });

  it('ends when the country changes hands', async () => {
    const s = await setup();
    await s.fortify(s.bo, 'B5');
    const { body } = await s.declare('B5', 'A4', ['A4', 'A3']);
    await s.respond(body.id, { response: 'accept' });
    await s.play(await s.game(await s.war(body.id)), SCHOLARS_MATE);
    const v = await s.view();
    expect(v.holdings.B5).toBe(ANN);
    expect(v.fortified).toEqual({});
  });

  it('is off in campaigns with the original answers', async () => {
    const s = await setup({ war: ORIGINAL_ANSWERS });
    expect((await s.fortify(s.bo, 'B5')).body).toMatchObject({ error: { code: 'off' } });
  });
});

describe('calling off a declaration', () => {
  it('spends the token before an answer, with no truce after', async () => {
    const s = await setup({}, { ann: 2 });
    const { body } = await s.declare('B5', 'A4', ['A4']);
    const recall = (by: Client, warId: string, url = s.url) => by.post(`${url}/wars/${warId}/recall`);
    expect((await recall(s.bo, body.id)).status).toBe(403);
    expect((await recall(s.ann, body.id)).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({ status: 'resolved', outcome: 'withdrawn' });
    const v = await s.view();
    expect(v.truces).toEqual([]);
    expect(v.events.map((e) => e.type).slice(-2)).toEqual(['war.recalled', 'war.resolved']);
    expect(await s.tokensNow()).toMatchObject({ ann: 1 });
    // Once answered, the declaration stands.
    const second = await s.declare('B5', 'A4', ['A4']);
    await s.respond(second.body.id, { response: 'accept' });
    expect((await recall(s.ann, second.body.id)).body).toMatchObject({ error: { code: 'already-answered' } });
    const old = await setup({ war: ORIGINAL_ANSWERS });
    const w = await old.declare('B5', 'A4', ['A4']);
    expect((await recall(old.ann, w.body.id, old.url)).body).toMatchObject({ error: { code: 'no-recall' } });
  });
});

describe('peace terms', () => {
  it('replace tribute', async () => {
    const s = await setup();
    const { body } = await s.declare('B5', 'A4', ['A4']);
    expect((await s.respond(body.id, { response: 'tribute', territoryId: 'Q2' })).body).toMatchObject({
      error: { code: 'no-tribute' },
    });
    const old = await setup({ war: ORIGINAL_ANSWERS });
    const w = await old.declare('B5', 'A4', ['A4']);
    expect((await old.offer(old.bo, w.body.id, terms())).body).toMatchObject({ error: { code: 'off' } });
  });

  it('stay between the two players until accepted, then settle the war, signing any accord', async () => {
    const s = await setup({}, { ann: 1, bo: 2 }, { cy: true });
    const cy = s.cy!;
    const { body } = await s.declare('B5', 'A4', ['A4']);
    const offered = terms({ toAttacker: ['Q2'], tokensToAttacker: 1, accordRounds: 3 });
    const res = await s.offer(s.bo, body.id, offered);
    expect(res.status).toBe(201);
    const offerId = res.body.id;
    expect((await s.war(body.id)).peace).toEqual([
      expect.objectContaining({ id: offerId, proposerId: BO, recipientId: ANN, status: 'proposed', terms: offered }),
    ]);
    expect((await s.war(body.id, cy)).peace).toEqual([]);
    // No dispatch for an offer; Ann has it waiting for her answer.
    expect((await s.view()).events.at(-1)!.type).toBe('war.declared');
    const attention = async (c: Client) =>
      (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((x) => x.id === s.id)!.attention;
    expect(await attention(s.ann)).toBe(1);
    expect((await s.answer(cy, body.id, offerId, 'accept')).status).toBe(404);
    expect((await s.answer(s.bo, body.id, offerId, 'accept')).status).toBe(403);
    expect((await s.answer(s.ann, body.id, offerId, 'accept')).status).toBe(200);

    const v = await s.view();
    expect(v.wars.find((w) => w.id === body.id)).toMatchObject({ status: 'resolved', outcome: 'settled' });
    expect(v.holdings.Q2).toBe(ANN);
    expect(await s.tokensNow()).toEqual({ ann: 1, bo: 1 });
    expect(v.truces).toEqual([{ players: [ANN, BO].sort(), endsRound: 2 }]);
    expect(v.accords).toEqual([
      expect.objectContaining({ proposerId: BO, recipientId: ANN, status: 'active', rounds: 3, endsRound: 4 }),
    ]);
    const resolved = v.events.find((e) => e.type === 'war.resolved');
    expect(resolved).toMatchObject({ payload: { outcome: 'settled', terms: offered } });
    expect(v.events.at(-1)!.type).toBe('accord.signed');
    const stats = (await s.ann.get<CampaignStats>(`${s.url}/stats`)).body;
    expect(stats.empires.find((e) => e.userId === ANN)!.wars).toMatchObject({
      attacking: { settled: 1 },
      tokensTaken: 1,
    });
    expect(stats.acquisitions.Q2).toMatchObject({ via: 'peace', from: BO });
    expect((await s.offer(s.bo, body.id, terms())).body).toMatchObject({ error: { code: 'war-over' } });
  });

  it('can stop a game underway, keeping its moves; a move passes over terms offered to the player moving', async () => {
    const s = await setup();
    const { body } = await s.declare('B5', 'A4', ['A4']);
    await s.respond(body.id, { response: 'accept' });
    const w = await s.war(body.id);
    await s.play(await s.game(w), ['e2e4', 'e7e5']);
    // Ann offers a white peace; her own move doesn't touch it, Bo's passes over it.
    const first = await s.offer(s.ann, body.id, terms());
    await s.play(await s.game(w), ['g1f3']);
    expect((await s.war(body.id, s.bo)).peace[0]).toMatchObject({ id: first.body.id, status: 'proposed' });
    await s.play(await s.game(w), ['b8c6']);
    expect((await s.war(body.id, s.bo)).peace[0]).toMatchObject({ id: first.body.id, status: 'declined' });
    expect((await s.answer(s.bo, body.id, first.body.id, 'accept')).body).toMatchObject({
      error: { code: 'already-answered' },
    });
    // Offered again, and taken.
    const second = await s.offer(s.ann, body.id, terms());
    expect((await s.answer(s.bo, body.id, second.body.id, 'accept')).status).toBe(200);
    const after = await s.war(body.id);
    expect(after).toMatchObject({ status: 'resolved', outcome: 'settled' });
    const g = await s.game(after);
    expect(g).toMatchObject({ status: 'cancelled', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] });
    expect((await s.view()).holdings).toMatchObject({ B5: BO, A4: ANN });
    const move = await s.ann.post(`/api/games/${g.id}/move`, { uci: 'f1c4', ply: 4 });
    expect(move.body).toMatchObject({ error: { code: 'game-cancelled' } });
  });

  it('lapse unanswered, can be withdrawn, and a new offer replaces the last', async () => {
    const s = await setup();
    const { body } = await s.declare('B5', 'A4', ['A4']);
    const first = await s.offer(s.bo, body.id, terms({ toAttacker: ['B1'] }));
    server.clock.advance(1000);
    const second = await s.offer(s.bo, body.id, terms({ toAttacker: ['R2'] }));
    const peace = async () => (await s.war(body.id, s.bo)).peace;
    expect((await peace()).map((o) => [o.id, o.status])).toEqual([
      [second.body.id, 'proposed'],
      [first.body.id, 'withdrawn'],
    ]);
    const withdraw = (by: Client, offerId: string) => by.post(`${s.url}/wars/${body.id}/peace/${offerId}/withdraw`);
    expect((await withdraw(s.ann, second.body.id)).status).toBe(403);
    expect((await withdraw(s.bo, second.body.id)).status).toBe(200);
    const third = await s.offer(s.ann, body.id, terms());
    server.clock.advance(24 * HOUR + 1);
    await server.runDue();
    expect((await peace()).find((o) => o.id === third.body.id)).toMatchObject({ status: 'lapsed' });
    // Bo's answer ran out too, so the war went ahead as declared.
    expect(await s.war(body.id)).toMatchObject({ status: 'playing' });
  });

  it('refuse terms the rules rule out', async () => {
    const s = await setup({}, {}, { cy: true });
    const { body } = await s.declare('B5', 'A4', ['A4']);
    const refused = async (by: Client, t: PeaceTerms) => (await s.offer(by, body.id, t)).body;
    // A1 isn't staked; B7 is worth more than the target.
    expect(await refused(s.bo, terms({ toDefender: ['A1'] }))).toMatchObject({ error: { code: 'bad-country' } });
    expect(await refused(s.bo, terms({ toAttacker: ['B7'] }))).toMatchObject({ error: { code: 'bad-country' } });
    expect(await refused(s.bo, terms({ toAttacker: ['B5', 'Q2'] }))).toMatchObject({ error: { code: 'bad-tribute' } });
    expect(await refused(s.bo, terms({ tokensToAttacker: 1, tokensToDefender: 1 }))).toMatchObject({
      error: { code: 'tokens-both-ways' },
    });
    expect(await refused(s.bo, terms({ tokensToAttacker: 3 }))).toMatchObject({
      error: { code: 'short-of-tokens' },
    });
    expect(await refused(s.bo, terms({ accordRounds: 20 }))).toMatchObject({ error: { code: 'bad-accord' } });
    expect((await s.offer(s.cy!, body.id, terms())).status).toBe(403);
  });
});

describe('raising back and forth on their own map', () => {
  // Ann holds a1 to a4 (10 each, in a chain), a1 bordering Bo's t (8). Bo also holds b1 (4), b2 (6),
  // b3 (8), b4 (2) and b5 (12), all bordering t. New campaigns allow three raises.
  let ladder: TestServer;
  beforeAll(async () => {
    ladder = await startTestServer({
      version: 'war-test',
      generatedAt: '2026-01-01T00:00:00.000Z',
      attribution: [],
      territories: [
        makeTerritory('a1', 10, ['a2', 't']),
        makeTerritory('a2', 10, ['a1', 'a3']),
        makeTerritory('a3', 10, ['a2', 'a4']),
        makeTerritory('a4', 10, ['a3']),
        makeTerritory('t', 8, ['a1', 'b1', 'b2', 'b3', 'b4', 'b5']),
        makeTerritory('b1', 4, ['t']),
        makeTerritory('b2', 6, ['t']),
        makeTerritory('b3', 8, ['t']),
        makeTerritory('b4', 2, ['t']),
        makeTerritory('b5', 12, ['t']),
      ],
      seaLanes: [],
    });
  });
  afterAll(async () => {
    await ladder.close();
  });

  const owners = { a1: ANN, a2: ANN, a3: ANN, a4: ANN, t: BO, b1: BO, b2: BO, b3: BO, b4: BO, b5: BO };
  const start = async (rules: CampaignRulesInput = {}) => {
    const s = await setup(rules, {}, { owners }, ladder);
    const answer = (by: Client, warId: string, a: object) => by.post(`${s.url}/wars/${warId}/reply`, a);
    const attention = async (c: Client) =>
      (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((x) => x.id === s.id)?.attention;
    /** Ann attacks t from a1, Bo puts in b1 (Ann must reach 14), and Ann raises again by 6 with a1 and a2. */
    const raised = async () => {
      const { body } = await s.declare('t', 'a1', ['a1']);
      expect((await s.respond(body.id, { response: 'raise', territoryId: 'b1' })).status).toBe(200);
      expect((await answer(s.ann, body.id, { reply: 'raise', stake: ['a1', 'a2'] })).status).toBe(200);
      return body.id;
    };
    return { ...s, answer, attention, raised };
  };

  it('let the attacker raise again, and the defender who backs down yield the target', async () => {
    const s = await start();
    const { body } = await s.declare('t', 'a1', ['a1']);
    await s.respond(body.id, { response: 'raise', territoryId: 'b1' });
    // Raising again takes half the target (4) over the 14 the raise asks.
    expect((await s.answer(s.ann, body.id, { reply: 'raise', stake: ['a1'] })).body).toMatchObject({
      error: { code: 'too-small' },
    });
    expect((await s.answer(s.ann, body.id, { reply: 'raise', stake: ['a1', 'a2'] })).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({
      status: 'countered',
      stake: ['a1', 'a2'],
      counter: {
        kind: 'raise',
        minValue: 14,
        added: 'b1',
        declared: ['a1'],
        steps: [{ by: 'attacker', stake: ['a1', 'a2'], more: 6 }],
      },
    });
    // Now it's Bo's answer, not Ann's.
    expect((await s.answer(s.ann, body.id, { reply: 'withdraw' })).status).toBe(403);
    expect([await s.attention(s.ann), await s.attention(s.bo)]).toEqual([0, 1]);
    expect(ladder.notices.at(-1)).toMatchObject({ userId: BO, title: 'Ann raised again' });
    // b4 is worth less than the 6 asked; b1 is already in the war.
    for (const territoryId of ['b4', 'b1']) {
      expect((await s.answer(s.bo, body.id, { reply: 'accept', territoryId })).body).toMatchObject({
        error: { code: 'bad-raise' },
      });
    }
    expect((await s.answer(s.bo, body.id, { reply: 'withdraw' })).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({ status: 'resolved', outcome: 'yielded' });
    // Only the target goes, without a game; what Bo put in stays Bo's.
    expect((await s.view()).holdings).toMatchObject({ t: ANN, b1: BO, a1: ANN, a2: ANN });
    const events = (await s.view()).events;
    expect(events.find((e) => e.type === 'war.reply' && e.payload.by === 'defender')).toMatchObject({
      actorId: BO,
      payload: { reply: 'withdraw', auto: false },
    });
    expect(events.find((e) => e.type === 'war.resolved')).toMatchObject({
      payload: { outcome: 'yielded', transfers: [{ territoryId: 't', from: BO, to: ANN }] },
    });
  });

  it('let the defender raise again, and the attacker who backs down forfeit the stake as declared', async () => {
    const s = await start();
    const warId = await s.raised();
    // b5 (12) meets the 6 Ann asked and raises 6 more: within half the target to all of it.
    expect((await s.answer(s.bo, warId, { reply: 'raise', territoryId: 'b3' })).body).toMatchObject({
      error: { code: 'bad-raise' },
    });
    expect((await s.answer(s.bo, warId, { reply: 'raise', territoryId: 'b5' })).status).toBe(200);
    expect(await s.war(warId)).toMatchObject({ status: 'countered', counter: { minValue: 26 } });
    // Three raises: Ann can only meet it or back down.
    expect((await s.answer(s.ann, warId, { reply: 'raise', stake: ['a1', 'a2', 'a3', 'a4'] })).body).toMatchObject({
      error: { code: 'cannot-raise' },
    });
    expect((await s.answer(s.ann, warId, { reply: 'accept', stake: ['a1', 'a2'] })).body).toMatchObject({
      error: { code: 'too-small' },
    });
    expect((await s.answer(s.ann, warId, { reply: 'withdraw' })).status).toBe(200);
    expect(await s.war(warId)).toMatchObject({ status: 'resolved', outcome: 'forfeited' });
    expect((await s.view()).holdings).toMatchObject({ a1: BO, a2: ANN, t: BO, b1: BO, b5: BO });
  });

  it('fight for everything put in once a raise is met', async () => {
    const s = await start();
    const warId = await s.raised();
    expect((await s.answer(s.bo, warId, { reply: 'accept', territoryId: 'b2' })).status).toBe(200);
    const w = await s.war(warId);
    expect(w).toMatchObject({ status: 'playing', stake: ['a1', 'a2'] });
    await s.play(await s.game(w), SCHOLARS_MATE);
    expect((await s.view()).holdings).toMatchObject({ t: ANN, b1: ANN, b2: ANN, a1: ANN, a2: ANN, b5: BO });
  });

  it('take silence after raising as backing down', async () => {
    const s = await start();
    const warId = await s.raised();
    ladder.clock.advance(24 * HOUR + 1);
    await ladder.runDue();
    expect(await s.war(warId)).toMatchObject({ status: 'resolved', outcome: 'yielded' });
    expect((await s.view()).holdings).toMatchObject({ t: ANN });

    const t = await start();
    const again = await t.raised();
    await t.answer(t.bo, again, { reply: 'raise', territoryId: 'b5' });
    ladder.clock.advance(24 * HOUR + 1);
    await ladder.runDue();
    expect(await t.war(again)).toMatchObject({ status: 'resolved', outcome: 'forfeited' });
    expect((await t.view()).holdings).toMatchObject({ a1: BO, a2: ANN });
  });

  it('keep the single raise where the host allows one, as campaigns stored before', async () => {
    const s = await start({ war: { raises: 1 } });
    const { body } = await s.declare('t', 'a1', ['a1']);
    await s.respond(body.id, { response: 'raise', territoryId: 'b1' });
    expect((await s.answer(s.ann, body.id, { reply: 'raise', stake: ['a1', 'a2'] })).body).toMatchObject({
      error: { code: 'cannot-raise' },
    });
    expect((await s.answer(s.ann, body.id, { reply: 'withdraw' })).status).toBe(200);
    expect(await s.war(body.id)).toMatchObject({ status: 'resolved', outcome: 'withdrawn' });
    expect((await s.view()).holdings).toMatchObject({ a1: ANN, t: BO, b1: BO });
  });
});
