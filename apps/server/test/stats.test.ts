import type { CampaignRulesInput, CampaignStats, CampaignView, GameView } from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { signIn, startTestServer, type Client, type TestServer, ORIGINAL_ANSWERS } from './helpers';

/**
 * Empire statistics on the war test map. Ann holds A1 A2 A3 A4 A6 (16); Bo holds B1 B2 B5 B7 B10
 * Q2 R2 (29). Values are in the ids.
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

async function setup(rules: CampaignRulesInput = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Records',
    rules: { victory: { mode: 'open' }, ...rules },
  });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    Object.entries(OWNERS).map(([territoryId, ownerId], pick) => ({
      campaignId: id,
      territoryId,
      ownerId,
      acquiredRound: 0,
      pickNumber: pick,
    })),
  );
  await db.update(members).set({ tokens: 3 }).where(eq(members.campaignId, id));

  const stats = async (c: Client = ann) => (await c.get<CampaignStats>(`/api/campaigns/${id}/stats`)).body;
  const declare = async (by: Client, targetId: string, launchId: string, stake: string[]) => {
    const res = await by.post<{ id: string }>(`/api/campaigns/${id}/wars`, { targetId, launchId, stake });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id;
  };
  const respond = (by: Client, warId: string, input: object) =>
    by.post(`/api/campaigns/${id}/wars/${warId}/respond`, input);
  /** Plays out the war's game from the start. */
  const fight = async (warId: string, moves: string[]) => {
    const view = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    const war = view.wars.find((w) => w.id === warId)!;
    const game = (await ann.get<GameView>(`/api/games/${war.games.at(-1)!.id}`)).body;
    for (const [ply, uci] of moves.entries()) {
      const mover = ply % 2 === 0 ? game.whiteId : game.blackId;
      const res = await (mover === ANN ? ann : bo).post(`/api/games/${game.id}/move`, { uci, ply });
      expect(res.status, uci).toBe(200);
    }
  };
  return { ann, bo, id, stats, declare, respond, fight };
}

describe('empire statistics', () => {
  it('are worked out from the campaign’s wars, games and accords', async () => {
    const { ann, bo, id, stats, declare, respond, fight } = await setup({
      war: { ...ORIGINAL_ANSWERS, truceRounds: 0 },
    });

    // Round 1: Ann takes B5 with Scholar's mate.
    const first = await declare(ann, 'B5', 'A4', ['A4']);
    await respond(bo, first, { response: 'accept' });
    await fight(first, SCHOLARS_MATE);
    expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(200);

    // Round 2: Ann buys off an attack on A1 with a token, then wins B2 and B1 defending A3.
    const second = await declare(bo, 'A1', 'B1', ['B1']);
    await respond(ann, second, { response: 'tribute', tokens: 1 });
    await bo.post(`/api/campaigns/${id}/wars/${second}/reply`, { reply: 'accept' });
    const third = await declare(bo, 'A3', 'B2', ['B2', 'B1']);
    await respond(ann, third, { response: 'accept' });
    await fight(third, FOOLS_MATE);

    // Bo breaks an accord. Proposals declined, withdrawn or waiting for an answer stay private.
    const propose = (rounds: number) =>
      ann.post<{ id: string }>(`/api/campaigns/${id}/accords`, { partnerId: BO, rounds });
    const declined = await propose(1);
    await bo.post(`/api/campaigns/${id}/accords/${declined.body.id}/answer`, { answer: 'decline' });
    const withdrawn = await propose(1);
    await ann.post(`/api/campaigns/${id}/accords/${withdrawn.body.id}/withdraw`);
    const accord = await propose(3);
    await bo.post(`/api/campaigns/${id}/accords/${accord.body.id}/answer`, { answer: 'accept' });
    await bo.post(`/api/campaigns/${id}/accords/${accord.body.id}/renounce`);
    expect((await propose(2)).status).toBe(201);

    const s = await stats(bo);
    expect(s.history.points.map((p) => [p.round, p.value[ANN], p.value[BO], p.countries[ANN]])).toEqual([
      [0, 16, 29, 5],
      [1, 21, 24, 6],
      [2, 24, 21, 8],
    ]);
    expect(s.history.wars.map((w) => [w.warId, w.round, w.outcome])).toEqual([
      [first, 1, 'attacker'],
      [third, 2, 'defender'],
    ]);
    expect(s.acquisitions).toMatchObject({
      B5: { via: 'war', warId: first, round: 1, from: BO },
      B1: { via: 'war', warId: third, round: 2, from: BO },
      A1: { via: 'draft', pick: 0 },
    });

    const ann$ = s.empires.find((e) => e.userId === ANN)!;
    const bo$ = s.empires.find((e) => e.userId === BO)!;
    expect(s.empires.map((e) => e.userId)).toEqual([ANN, BO]);
    expect(ann$.wars.attacking).toMatchObject({ won: 1, lost: 0 });
    expect(ann$.wars.defending).toMatchObject({ won: 1, tribute: 1 });
    expect(ann$.wars.gained.map((c) => c.territoryId)).toEqual(['B5', 'B2', 'B1']);
    expect([ann$.wars.tokensPaid, bo$.wars.tokensTaken]).toEqual([1, 1]);
    expect(bo$.wars.attacking).toMatchObject({ lost: 1, tribute: 1 });
    expect(bo$.wars.lost.map((c) => [c.territoryId, c.otherId])).toEqual([
      ['B5', ANN],
      ['B2', ANN],
      ['B1', ANN],
    ]);
    expect(ann$.accords).toEqual({ signed: 1, kept: 0, broken: 0, betrayed: 1, inForce: 0 });
    expect(bo$.accords).toEqual({ signed: 1, kept: 0, broken: 1, betrayed: 0, inForce: 0 });

    expect(ann$.chess).toMatchObject({
      played: 2,
      underway: 0,
      asWhite: { won: 1, drawn: 0, lost: 0 },
      asBlack: { won: 1, drawn: 0, lost: 0 },
      endings: { checkmate: { won: 2, drawn: 0, lost: 0 } },
      // Scholar's mate is 4 moves and Fool's mate 2.
      averageMoves: 3,
    });
    expect(ann$.chess.openings.map((o) => [o.family, o.color, o.games])).toEqual([
      ['Barnes Opening', 'black', 1],
      ["Bishop's Opening", 'white', 1],
    ]);
    expect(ann$.chess.games.map((g) => [g.opponentId, g.color, g.result, g.opening?.name])).toEqual([
      [BO, 'black', 'won', "Barnes Opening: Fool's Mate"],
      [BO, 'white', 'won', "Bishop's Opening"],
    ]);
    expect(bo$.chess).toMatchObject({ played: 2, asWhite: { lost: 1 }, asBlack: { lost: 1 } });
  });

  it('follow the draft as it happens, from the lobby on', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Draft Records',
      rules: { victory: { mode: 'open' } },
    });
    const id = body.id;
    const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    await bo.post(`/api/invites/${inviteCode}/join`);
    const stats = async () => (await ann.get<CampaignStats>(`/api/campaigns/${id}/stats`)).body;

    const lobby = await stats();
    expect(lobby.history.points).toEqual([
      { round: 0, value: { [ANN]: 0, [BO]: 0 }, countries: { [ANN]: 0, [BO]: 0 } },
    ]);
    expect(lobby.acquisitions).toEqual({});

    await ann.post(`/api/campaigns/${id}/draft/start`);
    for (let pick = 0; pick < 3; pick++) {
      const { draft } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
      const picker = draft!.currentPicker === ANN ? ann : bo;
      expect((await picker.post(`/api/campaigns/${id}/draft/autopick`)).status).toBe(200);
    }
    const drafting = await stats();
    expect(drafting.history.points).toHaveLength(1);
    const picks = Object.values(drafting.acquisitions).map((a) => (a.via === 'draft' ? a.pick : null));
    expect(picks.sort()).toEqual([0, 1, 2]);
  });

  it('start from the draft, and are for members only', async () => {
    const { stats } = await setup();
    const s = await stats();
    expect(s.history.points).toEqual([
      { round: 0, value: { [ANN]: 16, [BO]: 29 }, countries: { [ANN]: 5, [BO]: 7 } },
      { round: 1, value: { [ANN]: 16, [BO]: 29 }, countries: { [ANN]: 5, [BO]: 7 } },
    ]);
    expect(s.history.wars).toEqual([]);
    expect(s.empires[0]!.chess).toMatchObject({ played: 0, averageMoves: null, games: [] });

    const cy = await signIn(server.app, 'Cy');
    const outsider = await cy.get(`/api/campaigns/${(await setup()).id}/stats`);
    expect(outsider.status).toBe(404);
  });
});
