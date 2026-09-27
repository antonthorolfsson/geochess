import type { CampaignRulesInput, CampaignSummary, CampaignView, GameView, WarView } from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * War lifecycle tests on the war test map. Ann holds A1 A2 A3 A4 A6; Bo holds B1 B2 B5 B7 B10 Q2
 * R2. Values are in the ids. Ann attacks, so she plays White.
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

/** An active campaign in round 1 with the war map split between Ann and Bo, each holding `tokens`. */
async function setup(rules: CampaignRulesInput = {}, tokens = 1) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', { name: 'War Room', rules });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    Object.entries(OWNERS).map(([territoryId, ownerId]) => ({
      campaignId: id,
      territoryId,
      ownerId,
      acquiredRound: 0,
    })),
  );
  await db.update(members).set({ tokens }).where(eq(members.campaignId, id));

  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const war = async (warId: string) => (await view()).wars.find((w) => w.id === warId)!;
  const declare = (targetId: string, launchId: string, stake: string[], by = ann) =>
    by.post<{ id: string }>(`/api/campaigns/${id}/wars`, { targetId, launchId, stake });
  const respond = (warId: string, body: object) => bo.post(`/api/campaigns/${id}/wars/${warId}/respond`, body);
  const reply = (warId: string, body: object) => ann.post(`/api/campaigns/${id}/wars/${warId}/reply`, body);
  const game = async (w: WarView, index = -1) => (await ann.get<GameView>(`/api/games/${w.games.at(index)!.id}`)).body;
  /** Plays `moves` from the current position, alternating players as the colors dictate. */
  const play = async (g: GameView, moves: string[]) => {
    let last: { status: number; body: GameView } | undefined;
    let ply = g.moves.length;
    for (const uci of moves) {
      const mover = ply % 2 === 0 ? g.whiteId : g.blackId;
      last = await (mover === ANN ? ann : bo).post<GameView>(`/api/games/${g.id}/move`, { uci, ply });
      expect(last.status, `${uci}: ${JSON.stringify(last.body)}`).toBe(200);
      ply++;
    }
    return last!.body;
  };
  return { ann, bo, id, view, war, declare, respond, reply, game, play };
}

describe('declaring war', () => {
  it('spends a token, locks the stake and target, and tells the defender', async () => {
    const { ann, bo, id, view, declare } = await setup();
    const res = await declare('B5', 'A4', ['A4']);
    expect(res.status).toBe(201);
    const after = await view();
    expect(after.members.find((m) => m.userId === ANN)?.tokens).toBe(0);
    expect(after.wars[0]).toMatchObject({
      id: res.body.id,
      attackerId: ANN,
      defenderId: BO,
      targetId: 'B5',
      stake: ['A4'],
      status: 'declared',
      declaredRound: 1,
      respondBy: new Date(server.clock.now().getTime() + 24 * HOUR).toISOString(),
    });
    expect(after.events.at(-1)).toMatchObject({ type: 'war.declared', actorId: ANN });
    const summary = async (c: Client) =>
      (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)?.attention;
    expect(await summary(bo)).toBe(1);
    expect(await summary(ann)).toBe(0);
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: BO, url: `/c/${id}?war=${res.body.id}`, email: true });
  });

  it('refuses targets and stakes the rules rule out', async () => {
    const { declare, bo } = await setup({}, 2);
    expect((await declare('B10', 'A4', ['A4'])).body).toMatchObject({ error: { code: 'not-bordering' } });
    expect((await declare('B5', 'A3', ['A3', 'A4'])).body).toMatchObject({ error: { code: 'launcher-not-bordering' } });
    expect((await declare('B7', 'A6', ['A6', 'A4'])).body).toMatchObject({ error: { code: 'not-connected' } });
    expect((await declare('B7', 'A2', ['A2'])).body).toMatchObject({ error: { code: 'launcher-not-bordering' } });
    expect((await declare('B5', 'A4', ['A4'])).status).toBe(201);
    // The target and its stake are now locked.
    expect((await declare('B5', 'A4', ['A4'])).body).toMatchObject({ error: { code: 'in-war' } });
    expect((await declare('B2', 'A3', ['A3', 'A4'])).body).toMatchObject({ error: { code: 'in-war' } });
    expect((await declare('A4', 'B5', ['B5'], bo)).body).toMatchObject({ error: { code: 'in-war' } });
  });

  it('needs a token', async () => {
    const { declare } = await setup({}, 0);
    expect((await declare('B5', 'A4', ['A4'])).body).toMatchObject({ error: { code: 'no-tokens' } });
  });
});

describe('a correspondence war', () => {
  it('is accepted, fought and won by the attacker, who takes the target', async () => {
    const { ann, bo, id, view, war, declare, respond, game, play } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    expect((await ann.post(`/api/campaigns/${id}/wars/${body.id}/respond`, { response: 'accept' })).status).toBe(403);
    expect((await respond(body.id, { response: 'accept' })).status).toBe(200);

    const started = await war(body.id);
    expect(started.status).toBe('playing');
    const g = await game(started);
    const attention = async (c: Client) =>
      (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)?.attention;
    expect([await attention(ann), await attention(bo)]).toEqual([1, 0]);
    // Home turf (+10%) against one supply line (+5%) gives the defender, Black, 5% more time per move.
    expect(g).toMatchObject({
      whiteId: ANN,
      blackId: BO,
      status: 'playing',
      timeControl: { kind: 'correspondence', white: { perMoveMs: 24 * HOUR }, black: { perMoveMs: 25.2 * HOUR } },
      deadline: new Date(server.clock.now().getTime() + 24 * HOUR).toISOString(),
    });

    const socket = await listen(server.app, bo);
    const end = await play(g, SCHOLARS_MATE);
    await tick();
    socket.close();
    expect(end).toMatchObject({ status: 'finished', result: '1-0', reason: 'checkmate' });
    expect(socket.messages.filter((m) => m.type === 'game.update')).toHaveLength(SCHOLARS_MATE.length);

    const after = await view(bo);
    expect(after.holdings.B5).toBe(ANN);
    expect(after.acquired).toEqual({ B5: 1 });
    expect(after.wars[0]).toMatchObject({ status: 'resolved', outcome: 'attacker', resolvedRound: 1 });
    expect(after.truces).toEqual([{ players: [ANN, BO], endsRound: 2 }]);
    expect(after.events.at(-1)).toMatchObject({
      type: 'war.resolved',
      payload: {
        outcome: 'attacker',
        result: '1-0',
        reason: 'checkmate',
        transfers: [{ territoryId: 'B5', from: BO, to: ANN }],
      },
    });
  });

  it('hands the stake to a defender who wins', async () => {
    const { view, war, declare, respond, game, play } = await setup();
    const { body } = await declare('B7', 'A6', ['A6', 'A2']);
    await respond(body.id, { response: 'accept' });
    await play(await game(await war(body.id)), FOOLS_MATE);
    const after = await view();
    expect(after.holdings).toMatchObject({ A6: BO, A2: BO });
    expect(after.acquired).toEqual({ A6: 1, A2: 1 });
    expect(after.wars[0]).toMatchObject({ outcome: 'defender' });
  });

  it('refuses moves out of turn, stale or illegal, and hides games from outsiders', async () => {
    const { ann, bo, war, declare, respond, game } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    const g = await game(await war(body.id));
    const move = (c: Client, uci: string, ply: number) => c.post(`/api/games/${g.id}/move`, { uci, ply });
    expect((await move(bo, 'e7e5', 0)).body).toMatchObject({ error: { code: 'not-your-move' } });
    expect((await move(ann, 'e2e5', 0)).body).toMatchObject({ error: { code: 'illegal-move' } });
    expect((await move(ann, 'e2e4', 1)).body).toMatchObject({ error: { code: 'stale-move' } });
    expect((await move(ann, 'e2e4', 0)).status).toBe(200);
    const cy = await signIn(server.app, 'Cy');
    expect((await cy.get(`/api/games/${g.id}`)).status).toBe(404);
    expect((await move(cy, 'e7e5', 1)).status).toBe(403);
  });

  it('is lost on time when a move doesn’t come within the time per move', async () => {
    const { view, war, declare, respond, game } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    await game(await war(body.id));
    server.clock.advance(24 * HOUR - 1000);
    await server.runDue();
    expect((await war(body.id)).status).toBe('playing');
    server.clock.advance(2000);
    await server.runDue();
    const after = await view();
    expect(after.wars[0]).toMatchObject({ status: 'resolved', outcome: 'defender' });
    expect(after.holdings.A4).toBe(BO);
    expect(after.events.at(-1)).toMatchObject({ payload: { result: '0-1', reason: 'timeout' } });
  });
});

describe('defender responses', () => {
  it('raise: the attacker stakes more, and the game goes ahead', async () => {
    const { war, declare, respond, reply } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    expect((await respond(body.id, { response: 'raise' })).status).toBe(200);
    expect(await war(body.id)).toMatchObject({ status: 'countered', counter: { kind: 'raise', minValue: 7 } });
    expect((await reply(body.id, { reply: 'accept', stake: ['A4', 'A2'] })).body).toMatchObject({
      error: { code: 'not-connected' },
    });
    expect((await reply(body.id, { reply: 'accept', stake: ['A4'] })).body).toMatchObject({
      error: { code: 'too-small' },
    });
    expect((await reply(body.id, { reply: 'accept', stake: ['A3', 'A4'] })).status).toBe(200);
    expect(await war(body.id)).toMatchObject({ status: 'playing', stake: ['A4', 'A3'] });
  });

  it('raise: an attacker who withdraws loses the token, and no truce follows', async () => {
    const { view, war, declare, respond, reply } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'raise' });
    expect((await reply(body.id, { reply: 'refuse' })).body).toMatchObject({ error: { code: 'bad-reply' } });
    await reply(body.id, { reply: 'withdraw' });
    expect(await war(body.id)).toMatchObject({ status: 'resolved', outcome: 'withdrawn' });
    const after = await view();
    expect(after.truces).toEqual([]);
    expect(after.members.find((m) => m.userId === ANN)?.tokens).toBe(0);
  });

  it('cannot raise a stake that already meets it', async () => {
    const { declare, respond } = await setup();
    const { body } = await declare('B5', 'A4', ['A4', 'A3']);
    expect((await respond(body.id, { response: 'raise' })).body).toMatchObject({ error: { code: 'cannot-raise' } });
  });

  it('redirect: the war moves to a same-value country bordering the attacker', async () => {
    const { war, declare, respond, reply, game } = await setup();
    const { body } = await declare('B2', 'A3', ['A3']);
    expect((await respond(body.id, { response: 'redirect', targetId: 'R2' })).body).toMatchObject({
      error: { code: 'bad-redirect' },
    });
    await respond(body.id, { response: 'redirect', targetId: 'Q2' });
    await reply(body.id, { reply: 'accept' });
    const w = await war(body.id);
    expect(w).toMatchObject({ status: 'playing', targetId: 'Q2', redirectedFrom: 'B2', stake: ['A3'] });
    expect((await game(w)).whiteId).toBe(ANN);
  });

  it('tribute in land: accepted, it ends the war with a truce', async () => {
    const { view, war, declare, respond, reply } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    expect((await respond(body.id, { response: 'tribute', territoryId: 'B5' })).body).toMatchObject({
      error: { code: 'bad-tribute' },
    });
    expect((await respond(body.id, { response: 'tribute', territoryId: 'B2', tokens: 1 })).body).toMatchObject({
      error: { code: 'bad-tribute' },
    });
    await respond(body.id, { response: 'tribute', territoryId: 'B2' });
    await reply(body.id, { reply: 'accept' });
    expect(await war(body.id)).toMatchObject({ status: 'resolved', outcome: 'tribute' });
    const after = await view();
    expect(after.holdings.B2).toBe(ANN);
    expect(after.truces).toHaveLength(1);
  });

  it('tribute in tokens: held back while offered, and returned when refused', async () => {
    const { view, war, declare, respond, reply } = await setup({}, 2);
    const { body } = await declare('B5', 'A4', ['A4']);
    expect((await respond(body.id, { response: 'tribute', tokens: 3 })).body).toMatchObject({
      error: { code: 'not-enough-tokens' },
    });
    await respond(body.id, { response: 'tribute', tokens: 2 });
    const tokens = async () => Object.fromEntries((await view()).members.map((m) => [m.userId, m.tokens]));
    expect(await tokens()).toEqual({ [ANN]: 1, [BO]: 0 });
    await reply(body.id, { reply: 'refuse' });
    expect(await tokens()).toEqual({ [ANN]: 1, [BO]: 2 });
    expect((await war(body.id)).status).toBe('playing');
  });
});

describe('answer deadlines', () => {
  it('a silent defender accepts the war as declared', async () => {
    const { view, war, declare } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    server.clock.advance(24 * HOUR + 1);
    await server.runDue();
    expect((await war(body.id)).status).toBe('playing');
    expect((await view()).events.find((e) => e.type === 'war.response')).toMatchObject({
      actorId: null,
      payload: { response: 'accept', auto: true },
    });
  });

  it('a silent attacker withdraws from a raise but takes a tribute', async () => {
    const { war, declare, respond } = await setup({}, 2);
    const raised = (await declare('B5', 'A4', ['A4'])).body.id;
    const paid = (await declare('B7', 'A6', ['A6'])).body.id;
    await respond(raised, { response: 'raise' });
    await respond(paid, { response: 'tribute', territoryId: 'R2' });
    server.clock.advance(24 * HOUR + 1);
    await server.runDue();
    expect(await war(raised)).toMatchObject({ status: 'resolved', outcome: 'withdrawn' });
    expect(await war(paid)).toMatchObject({ status: 'resolved', outcome: 'tribute' });
  });
});

describe('a live war', () => {
  const live: CampaignRulesInput = { war: { pace: 'live', liveClock: '3+2', clockModifiers: false } };

  it('opens with a countdown, runs the clocks, and flags a player who runs out', async () => {
    const { ann, view, war, declare, respond, game, play } = await setup(live);
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    const g = await game(await war(body.id));
    expect(g.clocks).toEqual({ white: 180_000, black: 180_000 });
    expect(g.startsAt).toBe(new Date(server.clock.now().getTime() + 15_000).toISOString());
    expect((await ann.post(`/api/games/${g.id}/move`, { uci: 'e2e4', ply: 0 })).body).toMatchObject({
      error: { code: 'not-started' },
    });

    server.clock.advance(15_000 + 10_000);
    let state = await play(g, ['e2e4']);
    expect(state.clocks).toEqual({ white: 172_000, black: 180_000 });
    server.clock.advance(30_000);
    state = await play(state, ['e7e5']);
    expect(state.clocks).toEqual({ white: 172_000, black: 152_000 });

    // White's flag falls 172 s later; the server allows a little grace for moves in flight.
    server.clock.advance(172_000);
    await server.runDue();
    expect((await war(body.id)).status).toBe('playing');
    server.clock.advance(1000);
    await server.runDue();
    expect((await view()).wars[0]).toMatchObject({ outcome: 'defender' });
    expect((await game(await war(body.id))).clocks?.white).toBe(0);
  });

  it('queues a second game until both players are free', async () => {
    const { ann, war, declare, respond, game } = await setup(live, 2);
    const first = (await declare('B5', 'A4', ['A4'])).body.id;
    const second = (await declare('B7', 'A6', ['A6'])).body.id;
    await respond(first, { response: 'accept' });
    await respond(second, { response: 'accept' });
    expect(await war(second)).toMatchObject({ status: 'ready', games: [{ status: 'waiting' }] });
    await ann.post(`/api/games/${(await game(await war(first))).id}/resign`);
    expect(await war(first)).toMatchObject({ status: 'resolved', outcome: 'defender' });
    expect(await war(second)).toMatchObject({ status: 'playing', games: [{ status: 'playing' }] });
  });
});

describe('draws', () => {
  it('leave everything in place when the defender holds', async () => {
    const { ann, bo, view, war, declare, respond, game } = await setup();
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    const g = await game(await war(body.id));
    expect((await bo.post(`/api/games/${g.id}/draw`, { action: 'accept' })).body).toMatchObject({
      error: { code: 'no-draw-offer' },
    });
    await ann.post(`/api/games/${g.id}/draw`, { action: 'offer' });
    await bo.post(`/api/games/${g.id}/draw`, { action: 'accept' });
    const after = await view();
    expect(after.wars[0]).toMatchObject({ status: 'resolved', outcome: 'held' });
    expect(after.holdings).toMatchObject({ A4: ANN, B5: BO });
    expect(after.truces).toHaveLength(1);
  });

  it('go to Armageddon when the host chose it: colors swap and Black wins a draw', async () => {
    const { ann, bo, view, war, declare, respond, game } = await setup({ war: { draws: 'armageddon' } });
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    const first = await game(await war(body.id));
    await ann.post(`/api/games/${first.id}/draw`, { action: 'offer' });
    await bo.post(`/api/games/${first.id}/draw`, { action: 'offer' });

    const w = await war(body.id);
    expect(w.status).toBe('playing');
    const tiebreak = await game(w);
    expect(tiebreak).toMatchObject({ armageddon: true, whiteId: BO, blackId: ANN });
    expect(tiebreak.timeControl).toMatchObject({
      white: { perMoveMs: 25.2 * HOUR },
      black: { perMoveMs: 24 * HOUR * 0.8 },
    });
    await bo.post(`/api/games/${tiebreak.id}/draw`, { action: 'offer' });
    await ann.post(`/api/games/${tiebreak.id}/draw`, { action: 'accept' });
    const after = await view();
    expect(after.wars[0]).toMatchObject({ outcome: 'attacker' });
    expect(after.holdings.B5).toBe(ANN);
  });
});

describe('rounds, locks and truces', () => {
  it('only the host starts a round, which refills tokens up to the cap', async () => {
    const { ann, bo, id, view } = await setup({}, 2);
    expect((await bo.post(`/api/campaigns/${id}/round/next`)).status).toBe(403);
    await ann.post(`/api/campaigns/${id}/round/next`);
    await ann.post(`/api/campaigns/${id}/round/next`);
    const after = await view();
    expect(after.round).toBe(3);
    expect(after.members.map((m) => m.tokens)).toEqual([3, 3]);
    expect(after.events.at(-1)).toMatchObject({ type: 'round.started', payload: { round: 3 } });
  });

  it('keep newly won countries out of stakes, and rivals apart for a round', async () => {
    const { ann, bo, id, war, declare, respond, game, play } = await setup({}, 3);
    const { body } = await declare('B5', 'A4', ['A4']);
    await respond(body.id, { response: 'accept' });
    await play(await game(await war(body.id)), SCHOLARS_MATE);

    // Round 1: the truce holds, both ways.
    expect((await declare('B7', 'A6', ['A6'])).body).toMatchObject({ error: { code: 'truce' } });
    expect((await declare('A1', 'B1', ['B1'], bo)).body).toMatchObject({ error: { code: 'truce' } });
    await ann.post(`/api/campaigns/${id}/round/next`);
    // Round 2: war again, but B5 (won in round 1) can't be staked before round 3.
    expect((await declare('B7', 'B5', ['B5'])).body).toMatchObject({ error: { code: 'newly-won' } });
    expect((await declare('B7', 'A6', ['A6'])).status).toBe(201);
    await ann.post(`/api/campaigns/${id}/round/next`);
    expect((await declare('B2', 'B5', ['B5'])).status).toBe(201);
  });
});
