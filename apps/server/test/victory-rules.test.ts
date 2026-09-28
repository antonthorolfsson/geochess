import {
  seededRandom,
  type CampaignRules,
  type CampaignRulesInput,
  type CampaignStats,
  type CampaignView,
  type EventView,
  type FeedPage,
  type GameView,
  type PublicMissionSpec,
  type SecretMissionSpec,
  type WarView,
} from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { mutate } from '../src/campaigns/mutate';
import { staticDatasetProvider } from '../src/datasets';
import { campaigns, games, holdings, members, missionAwards, missionPlayers } from '../src/db/schema';
import { loadEnv } from '../src/env';
import { loadPlayers, loadWorld } from '../src/victory/state';
import { runDueWork } from '../src/wars/scheduler';
import { listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Victory mechanics on the war test map, driven through real wars. Ann holds A1 A2 A3 A4 A6
 * (values in the ids); Bo holds B1 B2 B5 B7 B10 Q2 R2. Sea lane A6 ~ B7.
 *
 *        Q2              R2
 *        |               |
 *   A1 - A2 - A6 ~~~~~~ B7 - B10
 *   |    |               |
 *   B1   A3 - A4 ------ B5
 *   |    |               |
 *   +--- B2 -------------+
 */
let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(warDataset(), {}, { random: seededRandom(7) });
});
afterAll(async () => {
  await server.close();
});

const ANN = 'dev_ann';
const BO = 'dev_bo';
const CY = 'dev_cy';
const HOUR = 3_600_000;
const SCHOLARS_MATE = 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'.split(' ');
const FOOLS_MATE = 'f2f3 e7e5 g2g4 d8h4'.split(' ');
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
const value = (id: string) => Number(id.slice(1));

/**
 * An Objectives campaign already at war (round 1), set up by hand: the given public missions,
 * holdings (the baseline too) and secret missions (none for a player not listed).
 */
async function objectives(opts: {
  missions: PublicMissionSpec[];
  secrets?: Record<string, SecretMissionSpec>;
  owners?: Record<string, string>;
  names?: string[];
  rules?: CampaignRulesInput;
  /** Minutes to hold a claim, written straight to the stored rules: shorter than the lobby allows. */
  holdMinutes?: number;
}) {
  const names = opts.names ?? ['Ann', 'Bo'];
  const clients = await Promise.all(names.map((n) => signIn(server.app, n)));
  const byId = Object.fromEntries(names.map((n, i) => [`dev_${n.toLowerCase()}`, clients[i]!])) as Record<
    string,
    Client
  >;
  const ann = clients[0]!;
  const created = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Missions',
    rules: { ...opts.rules, victory: { ...opts.rules?.victory, mode: 'objectives' } },
  });
  const id = created.body.id;
  const { inviteCode, rules } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  for (const c of clients.slice(1)) await c.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  const owners = opts.owners ?? OWNERS;
  await db
    .update(campaigns)
    .set({
      status: 'active',
      round: 1,
      roundStartedAt: server.clock.now(),
      rules: {
        ...rules,
        victory: {
          ...rules.victory,
          publicMissions: opts.missions,
          holdMinutes: opts.holdMinutes ?? rules.victory.holdMinutes,
        },
      },
    })
    .where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    Object.entries(owners).map(([territoryId, ownerId]) => ({
      campaignId: id,
      territoryId,
      ownerId,
      acquiredRound: 0,
    })),
  );
  await db.update(members).set({ tokens: 3 }).where(eq(members.campaignId, id));
  for (const userId of Object.keys(byId)) {
    const baseline = Object.entries(owners).flatMap(([t, o]) => (o === userId ? [t] : []));
    const secret = opts.secrets?.[userId] ?? null;
    await db.insert(missionPlayers).values({
      campaignId: id,
      userId,
      baseline,
      baselineValue: baseline.reduce((sum, t) => sum + value(t), 0),
      seed: 1,
      options: [],
      secretId: secret ? 'o1' : null,
      secret,
      selectedAt: server.clock.now(),
      noSecret: !secret,
    });
  }

  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  /** A change that touches nothing, so the missions are checked, as after any other. */
  const settle = () => mutate(server.app.ctx, id, async (s) => s.notifyOnly([]));
  /** Moves countries directly, as if won, and lets the campaign react. */
  const give = async (ids: string[], userId: string) => {
    await db
      .update(holdings)
      .set({ ownerId: userId })
      .where(and(eq(holdings.campaignId, id), inArray(holdings.territoryId, ids)));
    await settle();
  };
  const next = async () => expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(200);
  const declare = async (by: Client, targetId: string, launchId: string, stake: string[]) => {
    const res = await by.post<{ id: string }>(`/api/campaigns/${id}/wars`, { targetId, launchId, stake });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id;
  };
  const respond = (by: Client, warId: string, body: object) =>
    by.post(`/api/campaigns/${id}/wars/${warId}/respond`, body);
  const reply = (by: Client, warId: string, body: object) => by.post(`/api/campaigns/${id}/wars/${warId}/reply`, body);
  const war = async (warId: string) => (await view()).wars.find((w) => w.id === warId)!;
  const game = async (w: WarView, index = -1) => (await ann.get<GameView>(`/api/games/${w.games.at(index)!.id}`)).body;
  const play = async (g: GameView, moves: string[]) => {
    let ply = g.moves.length;
    for (const uci of moves) {
      const mover = byId[ply % 2 === 0 ? g.whiteId : g.blackId]!;
      const res = await mover.post<GameView>(`/api/games/${g.id}/move`, { uci, ply });
      expect(res.status, `${uci}: ${JSON.stringify(res.body)}`).toBe(200);
      ply++;
    }
  };
  const points = async (userId: string) => (await view()).victory!.players.find((p) => p.userId === userId)!.points;
  const claims = async () => (await view()).victory!.claims;
  // Round 1 has begun: drafted positions are checked, as when the war begins.
  await settle();
  return {
    ann,
    bo: byId[BO]!,
    cy: byId[CY],
    id,
    view,
    settle,
    give,
    next,
    declare,
    respond,
    reply,
    war,
    game,
    play,
    points,
    claims,
  };
}

const eventTypes = (events: EventView[]) => events.map((e) => e.type);

describe('claims', () => {
  it('score only once the round after next has started and the holding time has passed', async () => {
    const s = await objectives({
      missions: [{ kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 }],
      rules: { war: { pace: 'live' } },
    });
    await s.give(['B1'], ANN);
    expect(await s.claims()).toEqual([
      expect.objectContaining({ userId: ANN, missionKey: 'p0', startedRound: 1, eligibleRound: 3, eligibleAt: null }),
    ]);
    const roundTwo = server.clock.now().getTime();
    await s.next();
    // Live: at least 10 minutes after round 2 starts.
    expect((await s.claims())[0]!.eligibleAt).toBe(new Date(roundTwo + 10 * 60_000).toISOString());
    await s.settle();
    expect(await s.points(ANN)).toBe(0);
    // The host rushes on to round 3: the holding time still has to pass.
    await s.next();
    await server.runDue();
    expect(await s.points(ANN)).toBe(0);
    server.clock.advance(10 * 60_000);
    await server.runDue();
    expect(await s.points(ANN)).toBe(2);
    expect(await s.claims()).toEqual([]);
  });

  it('never score in the round after the claim, however much time passes', async () => {
    const s = await objectives({ missions: [{ kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 }] });
    await s.give(['B1'], ANN);
    await s.next();
    server.clock.advance(72 * HOUR);
    await server.runDue();
    expect(await s.points(ANN)).toBe(0);
    await s.next();
    expect(await s.points(ANN)).toBe(2);
  });

  it('restart only the claim that was broken, as a new episode, and carry on through a changed set', async () => {
    const s = await objectives({
      missions: [
        { kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 },
        { kind: 'expansion', gain: 2 },
        { kind: 'strategic_positions', territories: ['Q2', 'R2', 'B10', 'A1', 'A2'], need: 4 },
      ],
    });
    await s.give(['B1', 'Q2', 'R2'], ANN);
    const first = await s.claims();
    expect(first.map((c) => c.missionKey)).toEqual(['p0', 'p1', 'p2']);
    await s.next();
    // Losing B1 breaks p0 only: Ann is still +4, and still holds four of p2's five.
    await s.give(['B1'], BO);
    const after = await s.claims();
    expect(after.map((c) => [c.missionKey, c.id])).toEqual([
      ['p1', first[1]!.id],
      ['p2', first[2]!.id],
    ]);
    // Swapping which four of p2's five she holds never breaks it.
    await s.give(['B10'], ANN);
    await s.give(['Q2'], BO);
    expect((await s.claims()).find((c) => c.missionKey === 'p2')!.id).toBe(first[2]!.id);
    // Winning B1 back starts p0 again, from this round.
    await s.give(['B1'], ANN);
    expect((await s.claims()).find((c) => c.missionKey === 'p0')).toMatchObject({ startedRound: 2, eligibleRound: 4 });
    const events = eventTypes((await s.view()).events);
    expect(events.filter((t) => t === 'claim.interrupted')).toHaveLength(1);
  });
});

describe('claims and wars', () => {
  it('wait while a war could break the position, ignore wars that could not, and score when it ends well', async () => {
    const s = await objectives({
      missions: [
        { kind: 'strategic_positions', territories: ['A1', 'B1', 'Q2'], need: 3 },
        { kind: 'expansion', gain: 3 },
      ],
    });
    await s.give(['B1', 'Q2'], ANN);
    await s.next();
    await s.next();
    server.clock.advance(24 * HOUR);
    // Before the check runs, Bo declares war on A4. Unanswered, Ann could still pay a position as
    // tribute, so both claims wait.
    const warId = await s.declare(s.bo, 'A4', 'B5', ['B5']);
    const declared = await s.claims();
    expect(declared.map((c) => c.blockedBy)).toEqual([[warId], [warId]]);
    expect(await s.points(ANN)).toBe(0);
    // Accepted: only A4 and B5 are at stake. The positions are safe and score now; the value
    // could still fall below +3, so Expansion waits.
    expect((await s.respond(s.ann, warId, { response: 'accept' })).status).toBe(200);
    expect(await s.points(ANN)).toBe(2);
    expect(await s.claims()).toEqual([expect.objectContaining({ missionKey: 'p1', blockedBy: [warId] })]);
    // Ann wins the defence: the war is over without breaking anything, so Expansion scores at
    // once, without waiting out the time again.
    await s.play(await s.game(await s.war(warId)), FOOLS_MATE);
    expect(await s.points(ANN)).toBe(4);
    const awarded = (await s.view()).events.filter((e) => e.type === 'mission.awarded');
    expect(awarded.map((e) => e.round)).toEqual([3, 3]);
  });

  it('reveal a secret completed in one jump by a defensive win, then claim it, in the same change', async () => {
    const s = await objectives({
      missions: [{ kind: 'campaign_veteran', wins: 5, opponents: 1, attackWins: 1 }],
      secrets: { [BO]: { kind: 'hidden_triangle', territories: ['A3', 'A4', 'B5'], need: 3, reveal: 2 } },
    });
    expect((await s.view(s.ann)).victory!.players.find((p) => p.userId === BO)!.secret).toBeNull();
    const warId = await s.declare(s.ann, 'B5', 'A4', ['A4', 'A3']);
    await s.respond(s.bo, warId, { response: 'accept' });
    const socket = await listen(server.app, s.ann);
    await s.play(await s.game(await s.war(warId)), FOOLS_MATE);
    await tick();
    socket.close();
    const pushed = socket.messages.flatMap((m) => (m.type === 'campaign.events' ? [eventTypes(m.events)] : []));
    const resolved = pushed.find((types) => types.includes('war.resolved'))!;
    expect(resolved.slice(resolved.indexOf('war.resolved'))).toEqual([
      'war.resolved',
      'mission.revealed',
      'claim.started',
    ]);
    const v = await s.view(s.ann);
    expect(v.victory!.players.find((p) => p.userId === BO)!.secret).toMatchObject({
      reason: 'claim',
      revealedRound: 1,
    });
    expect(v.victory!.claims).toEqual([expect.objectContaining({ userId: BO, missionKey: 'secret', startedRound: 1 })]);
  });

  it('count a country taken as tribute', async () => {
    const s = await objectives({ missions: [{ kind: 'strategic_positions', territories: ['Q2'], need: 1 }] });
    const warId = await s.declare(s.ann, 'B5', 'A4', ['A4']);
    expect((await s.respond(s.bo, warId, { response: 'tribute', territoryId: 'Q2' })).status).toBe(200);
    expect((await s.reply(s.ann, warId, { reply: 'accept' })).status).toBe(200);
    const v = await s.view();
    expect(v.holdings.Q2).toBe(ANN);
    expect(v.victory!.claims).toEqual([expect.objectContaining({ userId: ANN, missionKey: 'p0' })]);
  });

  it('judge Across the Seas on the attack as fought, after any redirect', async () => {
    const s = await objectives({ missions: [{ kind: 'across_the_seas', count: 2 }] });
    // A6 ~ B7 is a sea lane.
    const bySea = await s.declare(s.ann, 'B7', 'A6', ['A6']);
    await s.respond(s.bo, bySea, { response: 'accept' });
    await s.play(await s.game(await s.war(bySea)), SCHOLARS_MATE);
    await s.next();
    // By land from A3 at B2, redirected to Q2: not across a sea lane either way.
    const byLand = await s.declare(s.ann, 'B2', 'A3', ['A3']);
    expect((await s.respond(s.bo, byLand, { response: 'redirect', targetId: 'Q2' })).status).toBe(200);
    expect((await s.reply(s.ann, byLand, { reply: 'accept' })).status).toBe(200);
    await s.play(await s.game(await s.war(byLand)), SCHOLARS_MATE);
    const v = await s.view();
    expect(v.holdings).toMatchObject({ B7: ANN, Q2: ANN });
    expect(v.victory!.players.find((p) => p.userId === ANN)!.progress.p0).toMatchObject({
      complete: false,
      parts: [{ have: 1, need: 2 }],
      evidence: { territories: ['B7'], wars: [bySea] },
    });
  });

  it('count a war settled by Armageddon once', async () => {
    const s = await objectives({
      missions: [{ kind: 'campaign_veteran', wins: 2, opponents: 1, attackWins: 0 }],
      rules: { war: { draws: 'armageddon' } },
    });
    const warId = await s.declare(s.ann, 'B5', 'A4', ['A4']);
    await s.respond(s.bo, warId, { response: 'accept' });
    const first = await s.game(await s.war(warId));
    await s.ann.post(`/api/games/${first.id}/draw`, { action: 'offer' });
    await s.bo.post(`/api/games/${first.id}/draw`, { action: 'offer' });
    const tiebreak = await s.game(await s.war(warId));
    await s.bo.post(`/api/games/${tiebreak.id}/draw`, { action: 'offer' });
    await s.ann.post(`/api/games/${tiebreak.id}/draw`, { action: 'accept' });
    const v = await s.view();
    expect(v.wars.find((w) => w.id === warId)).toMatchObject({ outcome: 'attacker', games: [{}, {}] });
    expect(v.victory!.players.find((p) => p.userId === ANN)!.progress.p0!.parts[0]).toMatchObject({ have: 1, need: 2 });
  });
});

/** Every public mission Ann completes by taking B1 (value 1). */
const FOUR: PublicMissionSpec[] = [
  { kind: 'strategic_positions', territories: ['B1'], need: 1 },
  { kind: 'expansion', gain: 1 },
  { kind: 'great_powers', minValue: 1, count: 6, newCount: 1 },
  { kind: 'regional_power', region: 'West', territories: ['A1', 'B1'], totalValue: 2, needValue: 2, minTerritories: 2 },
];

describe('winning', () => {
  it('takes four public missions (8 points) without a secret one', async () => {
    const s = await objectives({ missions: FOUR });
    await s.give(['B1'], ANN);
    expect(await s.claims()).toHaveLength(4);
    await s.next();
    await s.next();
    server.clock.advance(24 * HOUR);
    await server.runDue();
    const v = await s.view(s.bo);
    expect(v.status).toBe('finished');
    expect(v.victory!.result).toMatchObject({
      winners: [ANN],
      standings: [
        expect.objectContaining({ userId: ANN, points: 8, secret: null }),
        expect.objectContaining({ userId: BO, points: 0 }),
      ],
    });
    expect(v.events.filter((e) => e.type === 'mission.awarded')).toHaveLength(4);
  });

  async function crossTogether(seed: Record<string, [string, number][]>) {
    const s = await objectives({ missions: [{ kind: 'strategic_positions', territories: ['A1', 'B1'], need: 1 }] });
    // Points already scored, straight into the ledger.
    await server.app.ctx.db.insert(missionAwards).values(
      Object.entries(seed).flatMap(([userId, awards]) =>
        awards.map(([missionKey, points]) => ({
          campaignId: s.id,
          userId,
          missionKey,
          kind: 'expansion',
          points,
          round: 1,
          awardedAt: server.clock.now(),
        })),
      ),
    );
    // Both drafted a position, so both claims started with round 1 and come due together.
    expect((await s.claims()).map((c) => c.userId).sort()).toEqual([ANN, BO]);
    await s.next();
    await s.next();
    server.clock.advance(24 * HOUR);
    await server.runDue();
    return s.view();
  }

  it('is shared by players crossing the line together on equal totals', async () => {
    const v = await crossTogether({
      [ANN]: [
        ['x1', 2],
        ['x2', 3],
      ],
      [BO]: [
        ['x1', 3],
        ['x2', 2],
      ],
    });
    expect(v.victory!.result).toMatchObject({ winners: [ANN, BO] });
    expect(v.events.at(-1)).toMatchObject({
      type: 'campaign.won',
      payload: { winners: [ANN, BO], points: { [ANN]: 7, [BO]: 7 } },
    });
  });

  it('goes to the higher total when several cross together', async () => {
    const v = await crossTogether({
      [ANN]: [
        ['x1', 2],
        ['x2', 2],
        ['x3', 2],
      ],
      [BO]: [
        ['x1', 2],
        ['x2', 3],
      ],
    });
    expect(v.victory!.result).toMatchObject({ winners: [ANN] });
    expect(v.victory!.players.map((p) => [p.userId, p.points])).toEqual([
      [ANN, 8],
      [BO, 7],
    ]);
  });

  it('awards once however often and wherever it is checked, surviving a restart', async () => {
    const s = await objectives({ missions: [{ kind: 'strategic_positions', territories: ['B1'], need: 1 }] });
    await s.give(['B1'], ANN);
    await s.next();
    await s.next();
    server.clock.advance(24 * HOUR);
    // The server restarts: a fresh app on the same database finds the claim due.
    const restarted = await buildApp({
      db: server.app.ctx.db,
      env: loadEnv({ NODE_ENV: 'test', DEV_LOGIN: '1' }),
      datasets: staticDatasetProvider([warDataset()]),
      now: () => server.clock.now(),
      notifier: { send: async () => {} },
      scheduler: false,
    });
    await Promise.all([runDueWork(restarted.ctx), server.runDue(), s.settle(), server.runDue()]);
    await restarted.close();
    await server.runDue();
    const v = await s.view();
    expect(v.victory!.players.find((p) => p.userId === ANN)!.points).toBe(2);
    expect(v.events.filter((e) => e.type === 'mission.awarded')).toHaveLength(1);
    // The ledger itself refuses a second award for the same mission.
    await expect(
      server.app.ctx.db.insert(missionAwards).values({
        campaignId: s.id,
        userId: ANN,
        missionKey: 'p0',
        kind: 'strategic_positions',
        points: 2,
        round: 3,
        awardedAt: server.clock.now(),
      }),
    ).rejects.toThrow();
  });

  /** Four missions Ann completes by taking Q2: eight points, enough to win. */
  const TAKING_Q2_WINS: PublicMissionSpec[] = [
    { kind: 'strategic_positions', territories: ['A1', 'Q2'], need: 2 },
    { kind: 'expansion', gain: 2 },
    { kind: 'great_powers', minValue: 1, count: 6, newCount: 1 },
    {
      kind: 'regional_power',
      region: 'West',
      territories: ['A1', 'Q2'],
      totalValue: 3,
      needValue: 3,
      minTerritories: 2,
    },
  ];

  it('ends the campaign: wars and games underway are cancelled, keeping their moves and counting nothing', async () => {
    const s = await objectives({
      names: ['Ann', 'Bo', 'Cy'],
      missions: TAKING_Q2_WINS,
      owners: { ...OWNERS, B1: CY, B7: CY, B10: CY, R2: CY },
      // A minute, so both wars are still open when the claim scores.
      holdMinutes: 1,
    });
    const cy = s.cy!;
    // Cy attacks Bo, and the game gets going.
    const fighting = await s.declare(cy, 'B5', 'B7', ['B7']);
    await s.respond(s.bo, fighting, { response: 'accept' });
    const game = await s.game(await s.war(fighting));
    await s.play(game, ['e2e4', 'e7e5']);
    // Bo attacks Cy, who offers two tokens as tribute (held back meanwhile).
    const bargaining = await s.declare(s.bo, 'B1', 'B2', ['B2']);
    await s.respond(cy, bargaining, { response: 'tribute', tokens: 2 });
    await s.give(['Q2'], ANN);
    await s.next();
    await s.next();
    const tokensBefore = (await s.view()).members.find((m) => m.userId === CY)!.tokens;
    server.clock.advance(60_000);
    await server.runDue();

    const v = await s.view(cy);
    expect(v.status).toBe('finished');
    expect(v.victory!.result!.winners).toEqual([ANN]);
    expect(v.wars.find((w) => w.id === fighting)).toMatchObject({ status: 'resolved', outcome: 'cancelled' });
    expect(v.wars.find((w) => w.id === bargaining)).toMatchObject({ status: 'resolved', outcome: 'cancelled' });
    expect(v.members.find((m) => m.userId === CY)!.tokens).toBe(tokensBefore + 2);
    const stopped = (await cy.get<GameView>(`/api/games/${game.id}`)).body;
    expect(stopped).toMatchObject({ status: 'cancelled', result: null, moves: ['e2e4', 'e7e5'], deadline: null });
    expect((await cy.post(`/api/games/${game.id}/move`, { uci: 'g1f3', ply: 2 })).body).toMatchObject({
      error: { code: 'game-cancelled' },
    });
    expect((await s.reply(s.bo, bargaining, { reply: 'accept' })).status).toBe(409);
    // Neither war is won, lost or drawn; the game is no result.
    const stats = (await cy.get<CampaignStats>(`/api/campaigns/${s.id}/stats`)).body;
    const record = (userId: string) => stats.empires.find((e) => e.userId === userId)!;
    expect(record(CY).wars.attacking).toMatchObject({ won: 0, lost: 0, drawn: 0, cancelled: 1, underway: 0 });
    expect(record(CY).wars.defending).toMatchObject({ won: 0, lost: 0, tribute: 0, cancelled: 1 });
    expect(record(CY).chess).toMatchObject({ played: 0, underway: 0 });
    expect(v.holdings).toMatchObject({ B5: BO, B7: CY, B1: CY, B2: BO });
  });

  it('sends only the news of the ending from the change that ends the campaign', async () => {
    const s = await objectives({
      names: ['Ann', 'Bo', 'Cy'],
      missions: TAKING_Q2_WINS,
      owners: { ...OWNERS, B1: CY, R2: CY },
      holdMinutes: 1,
    });
    await s.give(['Q2'], ANN);
    await s.next();
    await s.next();
    server.clock.advance(60_000);
    // Nothing has looked at the claims since their time came, so Bo's declaration is what scores them.
    await tick();
    const before = server.notices.length;
    const warId = await s.declare(s.bo, 'B1', 'B2', ['B2']);
    await tick();
    const v = await s.view();
    expect(v.status).toBe('finished');
    expect(v.wars.find((w) => w.id === warId)).toMatchObject({ status: 'resolved', outcome: 'cancelled' });
    // No "war declared" for Cy, and no award notices: just the result, once each.
    const sent = server.notices.slice(before);
    expect(sent.map((n) => n.userId).sort()).toEqual([ANN, BO, CY]);
    expect(sent.every((n) => n.tag === `victory:${s.id}`)).toBe(true);
  });

  it('counts a game that ended just before the change that ends the campaign, rather than cancelling its war', async () => {
    const s = await objectives({
      names: ['Ann', 'Bo', 'Cy'],
      missions: TAKING_Q2_WINS,
      owners: { ...OWNERS, B1: CY, B7: CY, B10: CY, R2: CY },
      holdMinutes: 1,
    });
    const fighting = await s.declare(s.cy!, 'B5', 'B7', ['B7']);
    await s.respond(s.bo, fighting, { response: 'accept' });
    const game = await s.game(await s.war(fighting));
    await s.give(['Q2'], ANN);
    await s.next();
    await s.next();
    server.clock.advance(60_000);
    // Bo resigns, and the change that scores Ann's claims gets to the campaign before the one that
    // settles the war.
    await server.app.ctx.db
      .update(games)
      .set({ status: 'finished', result: '1-0', reason: 'resignation', finishedAt: server.clock.now() })
      .where(eq(games.id, game.id));
    await s.settle();

    const v = await s.view();
    expect(v.status).toBe('finished');
    expect(v.wars.find((w) => w.id === fighting)).toMatchObject({ status: 'resolved', outcome: 'attacker' });
    expect(v.holdings.B5).toBe(CY);
    expect(v.victory!.result!.holdings.B5).toBe(CY);
    const stats = (await s.ann.get<CampaignStats>(`/api/campaigns/${s.id}/stats`)).body;
    expect(stats.empires.find((e) => e.userId === CY)!.wars.attacking).toMatchObject({ won: 1, cancelled: 0 });
  });

  it('keeps the campaign going when its missions cannot be worked out, and picks up once they can', async () => {
    const s = await objectives({ missions: [{ kind: 'strategic_positions', territories: ['Q2'], need: 1 }] });
    const db = server.app.ctx.db;
    const [{ rules }] = (await db.select({ rules: campaigns.rules }).from(campaigns).where(eq(campaigns.id, s.id))) as [
      { rules: CampaignRules },
    ];
    // Mission rules from a later release, say, after rolling back to this one, which doesn't know them.
    await db
      .update(campaigns)
      .set({ rules: { ...rules, victory: { ...rules.victory, version: 99 } } })
      .where(eq(campaigns.id, s.id));
    await s.give(['Q2'], ANN);
    await s.next();
    expect(await s.view()).toMatchObject({ round: 2, holdings: { Q2: ANN }, victory: null, mySecret: null });

    await db.update(campaigns).set({ rules }).where(eq(campaigns.id, s.id));
    await s.settle();
    expect(await s.claims()).toEqual([expect.objectContaining({ userId: ANN, status: 'pending', startedRound: 2 })]);
  });
});

describe('secrecy', () => {
  it('hides a secret mission from the host and the other players until it is revealed', async () => {
    const s = await objectives({
      names: ['Ann', 'Bo', 'Cy'],
      missions: [{ kind: 'expansion', gain: 30 }],
      secrets: { [BO]: { kind: 'hidden_triangle', territories: ['A1', 'A2', 'A3'], need: 3, reveal: 2 } },
    });
    const cy = s.cy!;
    const socket = await listen(server.app, cy);
    await s.give(['A1'], BO);
    await tick();
    socket.close();
    const leaks = async (c: Client) => [
      JSON.stringify(await s.view(c)),
      JSON.stringify((await c.get<FeedPage>(`/api/campaigns/${s.id}/feed`)).body),
      JSON.stringify((await c.get<CampaignStats>(`/api/campaigns/${s.id}/stats`)).body),
    ];
    for (const c of [s.ann, cy])
      for (const text of await leaks(c)) expect(text).not.toMatch(/hidden_triangle|Hidden Triangle/);
    expect(JSON.stringify(socket.messages)).not.toMatch(/hidden_triangle/);
    const notices = server.notices.filter((n) => n.url.includes(s.id) && n.userId !== BO);
    expect(JSON.stringify(notices)).not.toMatch(/Hidden Triangle/);
    // Bo sees it, with his progress.
    expect((await s.view(s.bo)).mySecret).toMatchObject({
      revealed: false,
      mission: { spec: { kind: 'hidden_triangle' } },
      progress: { near: false, parts: [{ have: 1, need: 3 }] },
    });
    // The host can't choose, or read, anyone else's secret mission.
    expect((await s.ann.post(`/api/campaigns/${s.id}/secret`, { optionId: 'o1' })).body).toMatchObject({
      error: { code: 'not-selecting' },
    });
    expect((await s.view(s.ann)).mySecret).toMatchObject({ mission: null, none: true });

    // Two of three: revealed to everyone, with the exact targets and progress.
    await s.give(['A2'], BO);
    const seen = (await s.view(cy)).victory!.players.find((p) => p.userId === BO)!;
    expect(seen.secret).toMatchObject({ reason: 'near', mission: { spec: { territories: ['A1', 'A2', 'A3'] } } });
    expect(seen.progress.secret).toMatchObject({ near: true, parts: [{ have: 2, need: 3 }] });
  });
});

describe('choosing secret missions', () => {
  it('waits for the host, rather than going on silently, when nothing fits a player', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Nothing Fits',
      rules: { draft: { mode: 'free' }, victory: { mode: 'objectives', selectionMinutes: 60 } },
    });
    const id = body.id;
    const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
    const { inviteCode, rules } = await view();
    await bo.post(`/api/invites/${inviteCode}/join`);
    // This little map can't host the default missions; four simple ones stand in.
    const missions: PublicMissionSpec[] = [
      { kind: 'expansion', gain: 30 },
      { kind: 'campaign_veteran', wins: 3, opponents: 1, attackWins: 1 },
      { kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 },
      { kind: 'consolidation', sharePct: 80, newCount: 2 },
    ];
    const db = server.app.ctx.db;
    await db
      .update(campaigns)
      .set({ rules: { ...rules, victory: { ...rules.victory, publicMissions: missions } } })
      .where(eq(campaigns.id, id));
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    expect((await view()).status).toBe('selection');
    // Whatever was dealt, suppose nothing fitted Bo's empire.
    await db
      .update(missionPlayers)
      .set({ options: [] })
      .where(and(eq(missionPlayers.campaignId, id), eq(missionPlayers.userId, BO)));
    expect((await view(bo)).mySecret).toMatchObject({ options: [], mission: null, none: false });
    expect((await view()).victory!.selection).toMatchObject({ unresolved: [BO] });
    // Only the host can decide, and only for players with nothing to choose from.
    expect((await bo.post(`/api/campaigns/${id}/victory/proceed`)).status).toBe(403);

    // Time runs out: Ann is given her best fit (if she had options); Bo's case waits for the host.
    server.clock.advance(60 * 60_000 + 1);
    await server.runDue();
    await tick();
    const stuck = await view();
    expect(stuck.status).toBe('selection');
    expect(server.notices.at(-1)).toMatchObject({ userId: ANN, title: 'A player has no secret mission' });
    await server.runDue();
    expect((await view()).events.filter((e) => e.type === 'round.started')).toHaveLength(0);

    expect((await ann.post(`/api/campaigns/${id}/victory/proceed`)).status).toBe(200);
    const started = await view(bo);
    expect(started).toMatchObject({ status: 'active', round: 1 });
    expect(started.mySecret).toMatchObject({ mission: null, none: true });
    expect(started.victory!.players.find((p) => p.userId === BO)).toMatchObject({ ready: true, secret: null });
  });
});

describe('open-ended campaigns', () => {
  it('have no missions, points or victory events, before or after changes', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Old Style',
      rules: { victory: { mode: 'open' } },
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
    await db.update(members).set({ tokens: 3 }).where(eq(members.campaignId, id));
    const warId = (
      await ann.post<{ id: string }>(`/api/campaigns/${id}/wars`, { targetId: 'B5', launchId: 'A4', stake: ['A4'] })
    ).body.id;
    await bo.post(`/api/campaigns/${id}/wars/${warId}/respond`, { response: 'tribute', territoryId: 'Q2' });
    await ann.post(`/api/campaigns/${id}/wars/${warId}/reply`, { reply: 'accept' });
    await ann.post(`/api/campaigns/${id}/round/next`);
    const v = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    expect(v).toMatchObject({ status: 'active', round: 2, victory: null, mySecret: null });
    expect(v.events.some((e) => /^(mission|claim|missions|campaign\.won)/.test(e.type))).toBe(false);
    expect(await loadPlayers(db, id)).toEqual([]);
  });
});

describe('mission history', () => {
  it('reads accords, renewals, renunciations and round starts from the event log in order', async () => {
    const s = await objectives({ names: ['Ann', 'Bo', 'Cy'], missions: [{ kind: 'expansion', gain: 30 }] });
    const cy = s.cy!;
    const propose = (by: Client, partnerId: string) =>
      by.post<{ id: string }>(`/api/campaigns/${s.id}/accords`, { partnerId, rounds: 3 });
    const accept = (by: Client, accordId: string) =>
      by.post(`/api/campaigns/${s.id}/accords/${accordId}/answer`, { answer: 'accept' });
    const first = (await propose(s.ann, BO)).body.id;
    await accept(s.bo, first);
    await s.next();
    const renewal = (await propose(s.bo, ANN)).body.id;
    await accept(s.ann, renewal);
    const withCy = (await propose(s.ann, CY)).body.id;
    await accept(cy, withCy);
    await s.next();
    await s.ann.post(`/api/campaigns/${s.id}/accords/${withCy}/renounce`);

    const db = server.app.ctx.db;
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, s.id));
    const players = await loadPlayers(db, s.id);
    const world = await loadWorld(server.app.ctx, db, { ...campaign!, rules: campaign!.rules }, [ANN, BO, CY], players);
    const { accords, roundStarts } = world.history;
    expect(roundStarts.map((r) => r.round)).toEqual([2, 3]);
    const byId = new Map(accords.map((a) => [a.id, a]));
    // The renewal ends the first accord exactly where it begins.
    expect(byId.get(first)!.to).toBe(byId.get(renewal)!.from);
    expect(byId.get(renewal)!.to).toBeNull();
    // Renounced in round 3, after it started.
    expect(byId.get(withCy)!.to).toBeGreaterThan(roundStarts[1]!.seq);
    expect(byId.get(withCy)!.from).toBeLessThan(roundStarts[1]!.seq);
  });
});
