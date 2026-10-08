import {
  roundMs,
  roundProgression,
  type CampaignRules,
  type CampaignRulesInput,
  type CampaignSummary,
  type CampaignView,
  type FeedPage,
  type GameView,
  type PublicMissionSpec,
} from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { mutate } from '../src/campaigns/mutate';
import { staticDatasetProvider } from '../src/datasets';
import { campaigns, holdings, members, missionClaims, missionPlayers } from '../src/db/schema';
import { loadEnv } from '../src/env';
import { runDueWork } from '../src/wars/scheduler';
import { advanceScheduledRounds } from '../src/wars/service';
import { ORIGINAL_STAKES, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Rounds on a schedule. On the war test map Ann holds A1 A2 A3 A4 A6 and Bo B1 B2 B5 B7 B10, with
 * Cy on Q2 R2 U3 when there are three (values are in the ids); campaigns are set up at war by hand.
 *
 *        Q2              R2
 *        |               |
 *   A1 - A2 - A6 ~~~~~~ B7 - B10
 *   |    |               |
 *   B1   A3 - A4 ------ B5
 *   |    |               |      U3 - A4
 *   +--- B2 -------------+
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
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
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
  Q2: CY,
  R2: CY,
  U3: CY,
};
const value = (id: string) => Number(id.slice(1));

/** A second server on the same database, as after a restart or alongside this one. */
function anotherServer() {
  return buildApp({
    db: server.app.ctx.db,
    env: loadEnv({ NODE_ENV: 'test', DEV_LOGIN: '1' }),
    datasets: staticDatasetProvider([warDataset()]),
    now: () => server.clock.now(),
    notifier: { send: async () => {} },
    scheduler: false,
  });
}

/**
 * A correspondence campaign at war, in round 1 from now, as the end of the draft leaves it: its
 * rounds a day long on a schedule unless `rules` say otherwise. Open-ended, unless `missions` make
 * it an Objectives campaign (missions alone, version 4), with every player's holdings as their
 * baseline and no secret missions.
 */
async function atWar(
  rules: CampaignRulesInput = {},
  opts: { names?: string[]; missions?: PublicMissionSpec[]; tokens?: number } = {},
) {
  const names = opts.names ?? ['Ann', 'Bo', 'Cy'];
  const clients = await Promise.all(names.map((n) => signIn(server.app, n)));
  const byId = Object.fromEntries(names.map((n, i) => [`dev_${n.toLowerCase()}`, clients[i]!])) as Record<
    string,
    Client
  >;
  const ann = clients[0]!;
  const objectives = opts.missions !== undefined;
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'On Schedule',
    rules: {
      ...rules,
      rounds: { progression: 'scheduled', hours: 24, ...rules.rounds },
      // The map is sized for the original stakes.
      war: { ...ORIGINAL_STAKES, ...rules.war },
      victory: objectives ? { hold: 'turns', ...rules.victory, mode: 'objectives' } : { mode: 'open' },
    },
  });
  const id = body.id;
  const url = `/api/campaigns/${id}`;
  const created = (await ann.get<CampaignView>(url)).body;
  for (const c of clients.slice(1)) await c.post(`/api/invites/${created.inviteCode}/join`);
  const db = server.app.ctx.db;
  const now = server.clock.now();
  const ids = Object.keys(byId);
  const owners = Object.fromEntries(
    Object.entries(OWNERS).map(([t, o]) => [t, ids.includes(o) ? o : BO]), // Cy's countries go to Bo without Cy
  );
  await db
    .update(campaigns)
    .set({
      status: 'active',
      round: 1,
      draftOrder: ids,
      roundStartedAt: now,
      nextRoundAt:
        roundProgression(created.rules) === 'scheduled' ? new Date(now.getTime() + roundMs(created.rules)) : null,
      ...(objectives && {
        rules: { ...created.rules, victory: { ...created.rules.victory, version: 4, publicMissions: opts.missions! } },
      }),
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
  await db
    .update(members)
    .set({ tokens: opts.tokens ?? 1 })
    .where(eq(members.campaignId, id));
  if (objectives) {
    for (const userId of ids) {
      const baseline = Object.entries(owners).flatMap(([t, o]) => (o === userId ? [t] : []));
      await db.insert(missionPlayers).values({
        campaignId: id,
        userId,
        baseline,
        baselineValue: baseline.reduce((sum, t) => sum + value(t), 0),
        seed: 1,
        options: [],
        noSecret: true,
      });
    }
  }

  const view = async (c: Client = ann) => (await c.get<CampaignView>(url)).body;
  /** A change that touches nothing, so the missions are checked, as after any other. */
  const settle = () => mutate(server.app.ctx, id, async (s) => s.notifyOnly([]));
  /** Moves countries directly, as if won, and lets the campaign react. */
  const give = async (territoryIds: string[], userId: string) => {
    await db
      .update(holdings)
      .set({ ownerId: userId })
      .where(and(eq(holdings.campaignId, id), inArray(holdings.territoryId, territoryIds)));
    await settle();
  };
  const declare = async (by: Client, targetId: string, launchId: string) => {
    const res = await by.post<{ id: string }>(`${url}/wars`, { targetId, launchId, stake: [launchId] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id;
  };
  /** Passes whoever's turn it is to declare, on their behalf, until declaring is over for the round. */
  const passAll = async () => {
    for (let turn = (await view()).turns?.current; turn; turn = (await view()).turns?.current) {
      expect((await byId[turn]!.post(`${url}/turn/pass`, { userId: turn })).status).toBe(200);
    }
  };
  const roundStarts = async () => (await view()).events.filter((e) => e.type === 'round.started');
  const points = async (userId: string) => (await view()).victory!.players.find((p) => p.userId === userId)!.points;
  // Round 1 has begun: drafted positions are checked, as when the war begins.
  if (objectives) await settle();
  return { ann, bo: byId[BO]!, cy: byId[CY], id, url, view, settle, give, declare, passAll, roundStarts, points };
}

describe('choosing how rounds move on', () => {
  it('leaves rounds to the host unless a correspondence campaign chooses a schedule', async () => {
    const ann = await signIn(server.app, 'Ann');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', { name: 'Choosing' });
    const url = `/api/campaigns/${body.id}`;
    const rules = async () => (await ann.get<CampaignView>(url)).body.rules;
    expect((await rules()).rounds).toEqual({ progression: 'manual', hours: 72 });
    expect((await ann.patch(url, { rules: { rounds: { progression: 'scheduled', hours: 48 } } })).status).toBe(200);
    expect((await rules()).rounds).toEqual({ progression: 'scheduled', hours: 48 });
    // Going live puts rounds back in the host's hands.
    expect((await ann.patch(url, { rules: { war: { pace: 'live' } } })).status).toBe(200);
    expect((await rules()).rounds).toEqual({ progression: 'manual', hours: 48 });
    const refused = await ann.patch(url, { rules: { rounds: { progression: 'scheduled' } } });
    expect(refused).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'invalid-rules',
          message:
            'Rounds run on a schedule only in correspondence campaigns: in a live one, the host starts each round.',
        },
      },
    });
    // Only the lengths on offer.
    const odd = await ann.patch(url, { rules: { war: { pace: 'correspondence' }, rounds: { hours: 30 } } });
    expect(odd.status).toBe(400);
    expect((await rules()).war.pace).toBe('live');
  });

  it('times round 1 from the end of the draft, and starts the next when its time is up', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Draft to Schedule',
      rules: { victory: { mode: 'open' }, rounds: { progression: 'scheduled', hours: 24 } },
    });
    const url = `/api/campaigns/${body.id}`;
    const view = async () => (await ann.get<CampaignView>(url)).body;
    await bo.post(`/api/invites/${(await view()).inviteCode}/join`);
    expect((await view()).schedule).toBeNull();
    expect((await ann.post(`${url}/draft/start`)).status).toBe(200);
    expect((await ann.post(`${url}/draft/end`)).status).toBe(200);
    const start = server.clock.now().getTime();
    const one = await view();
    expect(one).toMatchObject({ status: 'active', round: 1 });
    expect(one.schedule).toEqual({ roundStartedAt: iso(start), nextRoundAt: iso(start + DAY), paused: null });
    const listed = async () => (await ann.get<CampaignSummary[]>('/api/campaigns')).body.find((c) => c.id === body.id)!;
    expect((await listed()).nextRoundAt).toBe(iso(start + DAY));

    server.clock.advance(DAY - 1000);
    await server.runDue();
    expect((await view()).round).toBe(1);
    server.clock.advance(1000);
    await server.runDue();
    const two = await view();
    expect(two.round).toBe(2);
    expect(two.events.filter((e) => e.type === 'round.started').at(-1)).toMatchObject({
      actorId: null,
      payload: { round: 2, scheduled: true },
    });
    // The new round's turns, tokens and time, as when the host starts one.
    expect(two.turns).toMatchObject({ current: two.turns!.order[0], passed: [] });
    expect(two.members.map((m) => m.tokens)).toEqual([2, 2]);
    expect(two.schedule).toEqual({ roundStartedAt: iso(start + DAY), nextRoundAt: iso(start + 2 * DAY), paused: null });
    // Paused, the list gives no time.
    expect((await ann.post(`${url}/schedule/pause`)).status).toBe(200);
    expect((await listed()).nextRoundAt).toBeNull();
  });
});

describe('a scheduled round', () => {
  it('starts once, however many sweeps or servers find it due at once', async () => {
    const s = await atWar();
    server.clock.advance(DAY);
    const other = await anotherServer();
    await Promise.all([
      advanceScheduledRounds(server.app.ctx),
      advanceScheduledRounds(server.app.ctx),
      runDueWork(other.ctx),
      server.runDue(),
    ]);
    await other.close();
    await server.runDue();
    expect((await s.view()).round).toBe(2);
    expect(await s.roundStarts()).toHaveLength(1);
  });

  it('after an outage, starts one round when the server is back, not one for every round missed', async () => {
    const s = await atWar();
    // Down for three and a half rounds; a fresh server then finds the campaign on the same database.
    server.clock.advance(3.5 * DAY);
    const restarted = await anotherServer();
    const back = server.clock.now().getTime();
    await runDueWork(restarted.ctx);
    await runDueWork(restarted.ctx);
    expect((await s.view()).round).toBe(2);
    expect(await s.roundStarts()).toHaveLength(1);
    expect((await s.view()).schedule).toMatchObject({ roundStartedAt: iso(back), nextRoundAt: iso(back + DAY) });
    server.clock.advance(DAY - 1000);
    await runDueWork(restarted.ctx);
    expect((await s.view()).round).toBe(2);
    server.clock.advance(1000);
    await runDueWork(restarted.ctx);
    expect((await s.view()).round).toBe(3);
    await restarted.close();
  });

  it('lets the host move on sooner, timing the new round from then, and refuses a press that crosses the schedule', async () => {
    const s = await atWar();
    expect((await s.bo.post(`${s.url}/round/next`, { round: 1 })).status).toBe(403);
    server.clock.advance(5 * HOUR);
    expect((await s.ann.post(`${s.url}/round/next`, { round: 1 })).status).toBe(200);
    const now = server.clock.now().getTime();
    const v = await s.view();
    expect(v.round).toBe(2);
    const [started] = await s.roundStarts();
    expect(started).toMatchObject({ actorId: ANN, payload: { round: 2 } });
    expect(started!.payload).not.toHaveProperty('scheduled');
    expect(v.schedule).toMatchObject({ roundStartedAt: iso(now), nextRoundAt: iso(now + DAY) });

    // The schedule gets there first while the host is still looking at round 2.
    server.clock.advance(DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(3);
    const late = await s.ann.post(`${s.url}/round/next`, { round: 2 });
    expect(late).toMatchObject({
      status: 409,
      body: { error: { code: 'round-moved-on', message: 'Round 3 has already begun.' } },
    });
    expect((await s.view()).round).toBe(3);
    // Old clients name no round.
    expect((await s.ann.post(`${s.url}/round/next`)).status).toBe(200);
    expect((await s.view()).round).toBe(4);
  });

  it('carries wars on as they stand: answers due, games and their clocks, and locked countries', async () => {
    const s = await atWar({ war: { turns: false } });
    server.clock.advance(23 * HOUR);
    // A war being fought, and a declaration waiting for an answer, an hour before the round ends.
    const fought = await s.declare(s.ann, 'B5', 'A4');
    expect((await s.bo.post(`${s.url}/wars/${fought}/respond`, { response: 'accept' })).status).toBe(200);
    const waiting = await s.declare(s.cy!, 'A2', 'Q2');
    const before = await s.view();
    const gameId = before.wars.find((w) => w.id === fought)!.games[0]!.id;
    const game = async () => (await s.ann.get<GameView>(`/api/games/${gameId}`)).body;
    const { deadline, moves } = await game();
    expect(deadline).not.toBeNull();

    server.clock.advance(HOUR);
    await server.runDue();
    const after = await s.view();
    expect(after.round).toBe(2);
    const war = (id: string) => after.wars.find((w) => w.id === id)!;
    expect(war(fought)).toMatchObject({ status: 'playing', declaredRound: 1 });
    expect(war(waiting)).toMatchObject({
      status: 'declared',
      respondBy: before.wars.find((w) => w.id === waiting)!.respondBy,
    });
    expect(await game()).toMatchObject({ status: 'playing', deadline, moves });
    // The countries in both wars stay locked.
    const locked = await s.bo.post(`${s.url}/wars`, { targetId: 'A4', launchId: 'B5', stake: ['B5'] });
    expect(locked).toMatchObject({ status: 409, body: { error: { code: 'in-war' } } });
    // Unused tokens carried over: Bo kept his and gained one; Ann and Cy spent theirs.
    expect(after.members.map((m) => [m.userId, m.tokens])).toEqual([
      [ANN, 1],
      [BO, 2],
      [CY, 1],
    ]);
  });
});

describe('pausing the schedule', () => {
  it('is the host’s: the round keeps the time it had left, and ends once that has run after resuming', async () => {
    const s = await atWar();
    expect((await s.bo.post(`${s.url}/schedule/pause`)).status).toBe(403);
    expect((await s.ann.post(`${s.url}/schedule/resume`)).body).toMatchObject({ error: { code: 'not-paused' } });
    server.clock.advance(6 * HOUR);
    expect((await s.ann.post(`${s.url}/schedule/pause`)).status).toBe(200);
    const pausedAt = server.clock.now().getTime();
    let v = await s.view();
    expect(v.schedule).toMatchObject({ nextRoundAt: null, paused: { since: iso(pausedAt), remainingMs: 18 * HOUR } });
    expect(v.events.at(-1)).toMatchObject({
      type: 'schedule.paused',
      actorId: ANN,
      payload: { remainingMs: 18 * HOUR },
    });
    expect((await s.ann.post(`${s.url}/schedule/pause`)).body).toMatchObject({ error: { code: 'paused' } });
    // In the Wars feed, with the round starts.
    const feed = (await s.bo.get<FeedPage>(`${s.url}/feed?filter=wars`)).body;
    expect(feed.items.some((i) => i.kind === 'event' && i.event.type === 'schedule.paused')).toBe(true);

    // Days go by, and the round stays.
    server.clock.advance(3 * DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(1);

    expect((await s.ann.post(`${s.url}/schedule/resume`)).status).toBe(200);
    const resumedAt = server.clock.now().getTime();
    v = await s.view();
    expect(v.schedule).toMatchObject({ nextRoundAt: iso(resumedAt + 18 * HOUR), paused: null });
    expect(v.events.at(-1)).toMatchObject({
      type: 'schedule.resumed',
      actorId: ANN,
      payload: { nextRoundAt: iso(resumedAt + 18 * HOUR) },
    });
    server.clock.advance(18 * HOUR - 1000);
    await server.runDue();
    expect((await s.view()).round).toBe(1);
    server.clock.advance(1000);
    await server.runDue();
    expect((await s.view()).round).toBe(2);
  });

  it('leaves turns, answers and games to their own deadlines meanwhile', async () => {
    const s = await atWar();
    expect((await s.ann.post(`${s.url}/round/next`, { round: 1 })).status).toBe(200);
    const first = (await s.view()).turns!.current!;
    expect((await s.ann.post(`${s.url}/schedule/pause`)).status).toBe(200);
    server.clock.advance(DAY);
    await server.runDue();
    const v = await s.view();
    expect(v.round).toBe(2);
    // The turn ran out and passed, as it would have anyway.
    expect(v.turns).toMatchObject({ passed: [first] });
    expect(v.events.some((e) => e.type === 'turn.passed' && e.payload.userId === first && e.payload.auto)).toBe(true);
  });

  it('stays paused when the host starts a round, which keeps its whole time for later', async () => {
    const s = await atWar();
    expect((await s.ann.post(`${s.url}/schedule/pause`)).status).toBe(200);
    server.clock.advance(2 * HOUR);
    expect((await s.ann.post(`${s.url}/round/next`, { round: 1 })).status).toBe(200);
    const now = server.clock.now().getTime();
    expect((await s.view()).schedule).toMatchObject({
      nextRoundAt: null,
      paused: { since: iso(now), remainingMs: DAY },
    });
    server.clock.advance(5 * DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(2);
  });

  it('is only for rounds on a schedule', async () => {
    const s = await atWar({ rounds: { progression: 'manual' } });
    expect((await s.ann.post(`${s.url}/schedule/pause`)).body).toMatchObject({
      error: { code: 'no-schedule', message: 'The host starts each round in this campaign: there is no schedule.' },
    });
  });
});

describe('rounds the host starts', () => {
  it('stay that way for campaigns stored before schedules, however much time passes', async () => {
    const s = await atWar({ rounds: { progression: 'manual' } });
    // Rules as stored before schedules existed: no `rounds` at all.
    const { rounds: _rounds, ...stored } = (await s.view()).rules;
    await server.app.ctx.db
      .update(campaigns)
      .set({ rules: stored as CampaignRules })
      .where(eq(campaigns.id, s.id));
    let v = await s.view();
    expect(v.rules.rounds.progression).toBe('manual');
    expect(v.schedule).toBeNull();
    server.clock.advance(10 * DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(1);
    expect((await s.ann.post(`${s.url}/round/next`)).status).toBe(200);
    v = await s.view();
    expect(v.round).toBe(2);
    expect(v.schedule).toBeNull();
    const [row] = await server.app.ctx.db
      .select({ nextRoundAt: campaigns.nextRoundAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.id));
    expect(row!.nextRoundAt).toBeNull();
  });

  it('stay that way in a live campaign, whatever its stored rules say', async () => {
    const s = await atWar({ rounds: { progression: 'manual' } });
    const rules = (await s.view()).rules;
    // Written past the lobby's checks, and with a time set as if the schedule had run.
    await server.app.ctx.db
      .update(campaigns)
      .set({
        rules: { ...rules, war: { ...rules.war, pace: 'live' }, rounds: { progression: 'scheduled', hours: 24 } },
        nextRoundAt: server.clock.now(),
      })
      .where(eq(campaigns.id, s.id));
    expect((await s.view()).schedule).toBeNull();
    server.clock.advance(2 * DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(1);
    const [row] = await server.app.ctx.db
      .select({ nextRoundAt: campaigns.nextRoundAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.id));
    expect(row!.nextRoundAt).toBeNull();
  });
});

describe('claims under a schedule', () => {
  const MISSION: PublicMissionSpec[] = [{ kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 }];

  it('held by turns, score as a scheduled round starts once everyone has had their turns', async () => {
    const s = await atWar({}, { names: ['Ann', 'Bo'], missions: MISSION });
    await s.give(['B1'], ANN);
    server.clock.advance(DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(2);
    await s.passAll();
    expect(await s.points(ANN)).toBe(0);
    server.clock.advance(DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(3);
    expect(await s.points(ANN)).toBe(2);
  });

  it('held by turns, wait for a round whose declaring runs to its end when the schedule cuts one short', async () => {
    const s = await atWar({}, { names: ['Ann', 'Bo'], missions: MISSION });
    await s.give(['B1'], ANN);
    expect((await s.view()).victory!.claims).toEqual([
      expect.objectContaining({ userId: ANN, startedRound: 1, eligibleRound: 3, turnsHeld: false }),
    ]);
    server.clock.advance(DAY);
    await server.runDue();
    // Round 2's time runs out with only one turn taken (passed for want of an answer).
    server.clock.advance(DAY);
    await server.runDue();
    const three = await s.view();
    expect(three.round).toBe(3);
    expect(three.events.some((e) => e.type === 'turns.ended' && e.payload.round === 2)).toBe(false);
    expect(await s.points(ANN)).toBe(0);
    expect(three.victory!.claims).toEqual([expect.objectContaining({ turnsHeld: false })]);
    // Round 3's turns run their course: now the claim scores.
    await s.passAll();
    expect(await s.points(ANN)).toBe(2);
    expect((await s.view()).victory!.claims).toEqual([]);
  });

  it('held for a time, wait out the holding time however many scheduled rounds start meanwhile', async () => {
    const s = await atWar(
      { victory: { hold: 'time', holdMinutes: 72 * 60 } },
      { names: ['Ann', 'Bo'], missions: MISSION },
    );
    await s.give(['B1'], ANN);
    server.clock.advance(DAY);
    await server.runDue();
    const roundTwo = server.clock.now().getTime();
    expect((await s.view()).victory!.claims).toEqual([
      expect.objectContaining({ eligibleAt: iso(roundTwo + 3 * DAY) }),
    ]);
    // Rounds 3 and 4 start on schedule within the holding time: no points yet.
    server.clock.advance(DAY);
    await server.runDue();
    server.clock.advance(DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(4);
    expect(await s.points(ANN)).toBe(0);
    server.clock.advance(DAY - 1000);
    await server.runDue();
    expect(await s.points(ANN)).toBe(0);
    server.clock.advance(1000);
    await server.runDue();
    expect(await s.points(ANN)).toBe(2);
  });
});

describe('the last round on a schedule', () => {
  it('ends the campaign on points when its time is up: wars underway are called off and waiting claims lapse', async () => {
    const s = await atWar(
      { victory: { lastRound: 2 } },
      { names: ['Ann', 'Bo'], missions: [{ kind: 'strategic_positions', territories: ['A1', 'B1'], need: 2 }] },
    );
    await tick();
    const before = server.notices.length;
    server.clock.advance(DAY);
    await server.runDue();
    const last = await s.view();
    expect(last.round).toBe(2);
    expect(last.schedule!.nextRoundAt).toBe(iso(server.clock.now().getTime() + DAY));
    await tick();
    const told = server.notices.slice(before).filter((n) => n.title === 'Round 2, the last');
    expect(told.map((n) => n.userId).sort()).toEqual([ANN, BO]);
    expect(told[0]!.body).toBe(
      "On Schedule ends on points when this round's 24 hours are up. Wars still underway then are called off, and claims that haven't scored don't count.",
    );

    // A claim too late to score, and a war still waiting for an answer.
    await s.give(['B1'], ANN);
    const turn = (await s.view()).turns!.current!;
    const war = await s.declare(turn === ANN ? s.ann : s.bo, turn === ANN ? 'B5' : 'A4', turn === ANN ? 'A4' : 'B5');
    server.clock.advance(DAY);
    await server.runDue();
    const over = await s.view();
    expect(over.status).toBe('finished');
    expect(over.round).toBe(2);
    expect(over.schedule).toBeNull();
    expect(over.victory!.result).toMatchObject({ seasonEnd: true, round: 2 });
    expect(over.victory!.result).not.toHaveProperty('endedEarly');
    expect(over.events.find((e) => e.type === 'campaign.won')).toMatchObject({ payload: { seasonEnd: true } });
    expect(over.wars.find((w) => w.id === war)).toMatchObject({ status: 'resolved', outcome: 'cancelled' });
    const claims = await server.app.ctx.db
      .select({ status: missionClaims.status })
      .from(missionClaims)
      .where(eq(missionClaims.campaignId, s.id));
    expect(claims).toEqual([{ status: 'cancelled' }]);
    const [row] = await server.app.ctx.db
      .select({ nextRoundAt: campaigns.nextRoundAt, roundPausedAt: campaigns.roundPausedAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.id));
    expect(row).toEqual({ nextRoundAt: null, roundPausedAt: null });

    // Nothing more happens, however long it waits or whoever presses.
    const events = over.events.length;
    server.clock.advance(3 * DAY);
    await server.runDue();
    expect((await s.view()).events).toHaveLength(events);
    expect((await s.ann.post(`${s.url}/round/next`, { round: 2 })).body).toMatchObject({
      error: { code: 'not-active' },
    });
    expect((await s.ann.post(`${s.url}/schedule/pause`)).body).toMatchObject({ error: { code: 'not-active' } });
  });

  it('waits while paused, then ends once the time it had left has run', async () => {
    const s = await atWar({ victory: { lastRound: 2 } }, { names: ['Ann', 'Bo'], missions: [] });
    server.clock.advance(DAY);
    await server.runDue();
    expect((await s.view()).round).toBe(2);
    server.clock.advance(20 * HOUR);
    expect((await s.ann.post(`${s.url}/schedule/pause`)).status).toBe(200);
    server.clock.advance(4 * DAY);
    await server.runDue();
    expect((await s.view()).status).toBe('active');
    expect((await s.ann.post(`${s.url}/schedule/resume`)).status).toBe(200);
    server.clock.advance(4 * HOUR);
    await server.runDue();
    expect((await s.view()).status).toBe('finished');
  });
});
