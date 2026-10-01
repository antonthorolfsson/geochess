import type { CampaignRulesInput, CampaignSummary, CampaignView, GameView, WarView } from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { ORIGINAL_ANSWERS, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Games played over the board, on a real board, with the result reported here. Ann holds A1 A2 A3
 * A4 A6 and Bo the B countries; Ann attacks B5 from A4, so she plays White.
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
};

/** An active campaign in round 1, with Ann's war on B5 accepted and its game underway. */
async function setup(rules: CampaignRulesInput = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Meet-up',
    rules: { victory: { mode: 'open' }, ...rules, war: { ...ORIGINAL_ANSWERS, ...rules.war } },
  });
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
  await db.update(members).set({ tokens: 1 }).where(eq(members.campaignId, id));
  const declared = await ann.post<{ id: string }>(`/api/campaigns/${id}/wars`, {
    targetId: 'B5',
    launchId: 'A4',
    stake: ['A4'],
  });
  await bo.post(`/api/campaigns/${id}/wars/${declared.body.id}/respond`, { response: 'accept' });

  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const war = async () => (await view()).wars.find((w) => w.id === declared.body.id)!;
  const game = async (w?: WarView) => {
    const g = (w ?? (await war())).games.at(-1)!;
    return (await ann.get<GameView>(`/api/games/${g.id}`)).body;
  };
  const gameId = (await game()).id;
  const otb = (c: Client, action: string) => c.post<GameView>(`/api/games/${gameId}/over-the-board`, { action });
  /** Ann offers, Bo accepts. */
  const moveOver = async () => {
    expect((await otb(ann, 'offer')).status).toBe(200);
    const res = await otb(bo, 'accept');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  /** What the home screen counts as waiting for the player in this campaign. */
  const attention = async (c: Client) =>
    (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)?.attention;
  return { ann, bo, id, view, war, game, gameId, otb, moveOver, attention };
}

describe('moving a game over the board', () => {
  it('takes one player’s offer and the other’s acceptance, and stops the game here', async () => {
    const { ann, bo, id, gameId, game, otb, attention } = await setup();
    expect([await attention(ann), await attention(bo)]).toEqual([1, 0]);
    const offered = await otb(ann, 'offer');
    expect(offered.body).toMatchObject({ overTheBoardOfferBy: ANN, overTheBoard: false });
    expect([await attention(ann), await attention(bo)]).toEqual([1, 1]);
    await tick();
    expect(server.notices.at(-1)).toMatchObject({
      userId: BO,
      title: 'Play over the board?',
      url: `/c/${id}?game=${gameId}`,
    });
    expect((await otb(ann, 'accept')).body).toMatchObject({ error: { code: 'no-offer' } });
    expect((await otb(bo, 'accept')).body).toMatchObject({
      overTheBoard: true,
      overTheBoardOfferBy: null,
      deadline: null,
      report: null,
    });
    // Nobody's move: the game is on a real board.
    expect([await attention(ann), await attention(bo)]).toEqual([0, 0]);
    // No moves or draw offers here meanwhile, and no clock.
    expect((await ann.post(`/api/games/${gameId}/move`, { uci: 'e2e4', ply: 0 })).body).toMatchObject({
      error: { code: 'over-the-board' },
    });
    expect((await ann.post(`/api/games/${gameId}/draw`, { action: 'offer' })).body).toMatchObject({
      error: { code: 'over-the-board' },
    });
    server.clock.advance(48 * HOUR);
    await server.runDue();
    expect(await game()).toMatchObject({ status: 'playing', overTheBoard: true });
  });

  it('can be declined, and an online move turns the offer down', async () => {
    const { ann, bo, gameId, otb } = await setup();
    await otb(ann, 'offer');
    expect((await otb(bo, 'decline')).body).toMatchObject({ overTheBoardOfferBy: null, overTheBoard: false });
    await otb(bo, 'offer');
    const moved = await ann.post<GameView>(`/api/games/${gameId}/move`, { uci: 'e2e4', ply: 0 });
    expect(moved.body).toMatchObject({ overTheBoardOfferBy: null });
  });

  it('freezes live clocks, and going back online starts them after a countdown', async () => {
    const { ann, bo, gameId, otb, moveOver } = await setup({
      war: { pace: 'live', liveClock: '3+2', clockModifiers: false },
    });
    server.clock.advance(15_000 + 10_000);
    await ann.post(`/api/games/${gameId}/move`, { uci: 'e2e4', ply: 0 });
    server.clock.advance(20_000);
    const over = await moveOver();
    expect(over.clocks).toEqual({ white: 172_000, black: 160_000 });
    server.clock.advance(10 * 60_000);
    await server.runDue();
    expect((await bo.get<GameView>(`/api/games/${gameId}`)).body).toMatchObject({
      status: 'playing',
      clocks: { white: 172_000, black: 160_000 },
    });

    const back = (await otb(bo, 'online')).body;
    expect(back).toMatchObject({ overTheBoard: false, clocks: { white: 172_000, black: 160_000 } });
    expect(back.startsAt).toBe(new Date(server.clock.now().getTime() + 15_000).toISOString());
    expect(back.deadline).toBe(new Date(server.clock.now().getTime() + 15_000 + 160_000).toISOString());
    expect((await bo.post(`/api/games/${gameId}/move`, { uci: 'e7e5', ply: 1 })).body).toMatchObject({
      error: { code: 'not-started' },
    });
    server.clock.advance(15_000 + 5_000);
    const moved = await bo.post<GameView>(`/api/games/${gameId}/move`, { uci: 'e7e5', ply: 1 });
    expect(moved.body.clocks).toEqual({ white: 172_000, black: 157_000 });
  });

  it('is only for two people', async () => {
    const { ann, id, gameId, otb } = await setup();
    await ann.put(`/api/campaigns/${id}/players/${BO}/stand-in`, { level: 2 });
    await server.bots();
    expect((await otb(ann, 'offer')).body).toMatchObject({ error: { code: 'bot' } });
  });
});

describe('reporting the result', () => {
  it('a win the other player confirms decides the war', async () => {
    const { ann, bo, id, gameId, view, otb, moveOver, attention } = await setup();
    await moveOver();
    const reported = (await otb(bo, 'report-win')).body;
    expect([await attention(ann), await attention(bo)]).toEqual([1, 0]);
    expect(reported).toMatchObject({ report: { by: BO, result: '0-1' } });
    expect(reported.deadline).toBe(new Date(server.clock.now().getTime() + 24 * HOUR).toISOString());
    await tick();
    expect(server.notices.at(-1)).toMatchObject({
      userId: ANN,
      title: 'Bo reports a win',
      url: `/c/${id}?game=${gameId}`,
      email: true,
    });
    // Ann answers it; she can't report over it, or take the game online until she has.
    expect((await otb(ann, 'report-win')).body).toMatchObject({ error: { code: 'report-waiting' } });
    expect((await otb(ann, 'online')).body).toMatchObject({ error: { code: 'report-waiting' } });
    expect((await otb(bo, 'confirm')).body).toMatchObject({ error: { code: 'no-report' } });

    expect((await otb(ann, 'confirm')).body).toMatchObject({
      status: 'finished',
      result: '0-1',
      reason: 'over-the-board',
      report: null,
      deadline: null,
    });
    const after = await view();
    expect(after.wars[0]).toMatchObject({ status: 'resolved', outcome: 'defender' });
    expect(after.wars[0]!.games).toEqual([expect.objectContaining({ overTheBoard: true, reason: 'over-the-board' })]);
    expect(after.holdings.A4).toBe(BO);
    expect(after.events.at(-1)).toMatchObject({
      type: 'war.resolved',
      payload: { outcome: 'defender', result: '0-1', reason: 'over-the-board' },
    });
  });

  it('a disputed report leaves the game over the board', async () => {
    const { ann, bo, otb, moveOver } = await setup();
    await moveOver();
    await otb(ann, 'report-win');
    expect((await otb(bo, 'dispute')).body).toMatchObject({
      status: 'playing',
      overTheBoard: true,
      report: null,
      deadline: null,
    });
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'Result disputed' });
    server.clock.advance(48 * HOUR);
    await server.runDue();
    expect((await otb(ann, 'online')).body).toMatchObject({ overTheBoard: false, status: 'playing' });
  });

  it('stands when the other player doesn’t answer in time', async () => {
    const { ann, view, otb, moveOver } = await setup();
    await moveOver();
    await otb(ann, 'report-draw');
    server.clock.advance(24 * HOUR - 1000);
    await server.runDue();
    expect((await view()).wars[0]!.status).toBe('playing');
    server.clock.advance(2000);
    await server.runDue();
    const after = await view();
    expect(after.wars[0]).toMatchObject({ status: 'resolved', outcome: 'held' });
    expect(after.events.at(-1)).toMatchObject({ payload: { result: '1/2-1/2', reason: 'over-the-board' } });
  });

  it('resigning over the board reports a loss at once', async () => {
    const { ann, gameId, view, moveOver } = await setup();
    await moveOver();
    expect((await ann.post(`/api/games/${gameId}/resign`)).body).toMatchObject({
      status: 'finished',
      result: '0-1',
      reason: 'over-the-board',
    });
    expect((await view()).wars[0]).toMatchObject({ outcome: 'defender' });
  });

  it('a draw over the board takes the Armageddon tiebreak over the board too', async () => {
    const { ann, bo, game, otb, war, moveOver } = await setup({ war: { draws: 'armageddon' } });
    await moveOver();
    await otb(ann, 'report-draw');
    await otb(bo, 'confirm');
    const tiebreak = await game(await war());
    expect(tiebreak).toMatchObject({ armageddon: true, status: 'playing', overTheBoard: true, deadline: null });
    await bo.post(`/api/games/${tiebreak.id}/over-the-board`, { action: 'report-win' });
    await ann.post(`/api/games/${tiebreak.id}/over-the-board`, { action: 'confirm' });
    expect(await war()).toMatchObject({ status: 'resolved', outcome: 'defender' });
  });
});

describe('a bot standing in', () => {
  it('takes a game played over the board back online, and plays it', async () => {
    const { ann, id, gameId, game, moveOver } = await setup();
    await ann.post(`/api/games/${gameId}/move`, { uci: 'e2e4', ply: 0 });
    await moveOver();
    expect((await ann.put(`/api/campaigns/${id}/players/${BO}/stand-in`, { level: 2 })).status).toBe(200);
    await server.runDue();
    const g = await game();
    expect(g).toMatchObject({ overTheBoard: false, status: 'playing' });
    expect(g.moves).toHaveLength(2);
  });
});
