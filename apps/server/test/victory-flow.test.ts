import {
  seededRandom,
  type CampaignStats,
  type CampaignSummary,
  type CampaignView,
  type Dataset,
  type FeedPage,
  type ServerMessage,
} from '@empire/rules';
import { and, eq, inArray } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutate } from '../src/campaigns/mutate';
import { campaigns, holdings, missionPlayers } from '../src/db/schema';
import { listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Victory missions from campaign creation to final results, on the real map: lobby missions, the
 * draft, private secret missions, reveals, claims through the response window, points, victory
 * and the read-only ending.
 */
const dataset = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve('@empire/data/datasets/2026.2/territories.json')), 'utf8'),
) as Dataset;

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(dataset, {}, { random: seededRandom(2026) });
});
afterAll(async () => {
  await server.close();
});

const ANN = 'dev_ann';
const BO = 'dev_bo';
const CY = 'dev_cy';
const HOUR = 3_600_000;
const MED = ['ESP', 'FRA', 'ITA', 'TUN'];

/**
 * Three players in a new campaign's lobby. Mission rules version 4 unless asked otherwise, so the
 * missions' points are all there is; `version: null` keeps what new campaigns get.
 */
async function table({ version = 4 }: { version?: number | null } = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const cy = await signIn(server.app, 'Cy');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', { name: 'Grand Strategy' });
  const id = body.id;
  if (version !== null) {
    const [row] = await server.app.ctx.db.select().from(campaigns).where(eq(campaigns.id, id));
    const rules = { ...row!.rules, victory: { ...row!.rules.victory, version } };
    await server.app.ctx.db.update(campaigns).set({ rules }).where(eq(campaigns.id, id));
  }
  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const { inviteCode } = await view();
  await bo.post(`/api/invites/${inviteCode}/join`);
  await cy.post(`/api/invites/${inviteCode}/join`);
  /** Moves countries to a player directly, as if won, then lets the campaign react. */
  const give = async (ids: string[], userId: string) => {
    await server.app.ctx.db
      .update(holdings)
      .set({ ownerId: userId })
      .where(and(eq(holdings.campaignId, id), inArray(holdings.territoryId, ids)));
    await mutate(server.app.ctx, id, async (scope) => scope.notifyOnly([]));
  };
  const nextRound = async () => expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(200);
  const players: Record<string, Client> = { [ANN]: ann, [BO]: bo, [CY]: cy };
  /** Everyone passes their turn to declare, in order, until declaring is over for the round. */
  const passAll = async () => {
    for (let turn = (await view()).turns?.current; turn; turn = (await view()).turns?.current) {
      expect((await players[turn]!.post(`/api/campaigns/${id}/turn/pass`, { userId: turn })).status).toBe(200);
    }
  };
  return { ann, bo, cy, id, view, give, nextRound, passAll };
}

describe('the lobby', () => {
  it('gives new campaigns four public missions, visible to everyone before the draft', async () => {
    const { bo, view } = await table({ version: null });
    const c = await view(bo);
    expect(c.rules.victory.mode).toBe('objectives');
    expect(c.victory).toMatchObject({
      version: 6,
      pointsToWin: 10,
      publicPoints: 2,
      secretPoints: 3,
      titlePoints: 1,
      holdMs: 24 * HOUR,
      lastRound: 25,
    });
    expect(c.victory!.publicMissions.map((m) => m.spec.kind)).toEqual([
      'expansion',
      'strategic_positions',
      'great_powers',
      'campaign_veteran',
    ]);
    expect(c.victory!.publicMissions.map((m) => m.key)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(c.mySecret).toBeNull();
  });

  it('lets only the host choose another valid set, and redraw targets, until the draft starts', async () => {
    const { ann, bo, id, view } = await table();
    const kinds = ['expansion', 'regional_power', 'two_fronts', 'great_powers'];
    expect((await bo.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(403);
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    expect((await view()).victory!.publicMissions.map((m) => m.spec.kind)).toEqual(kinds);

    const twice = await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds: [...kinds.slice(1), 'two_fronts'] });
    expect(twice.body).toMatchObject({ error: { code: 'bad-missions' } });
    const contiguous = await ann.put(`/api/campaigns/${id}/victory/missions`, {
      kinds: ['expansion', 'consolidation', 'two_fronts', 'great_powers'],
    });
    expect(contiguous.body).toMatchObject({ error: { message: expect.stringMatching(/free drafts/) } });

    const before = (await view()).victory!.publicMissions[1]!.spec;
    expect((await ann.post(`/api/campaigns/${id}/victory/missions/1/reroll`)).status).toBe(200);
    expect((await view()).victory!.publicMissions[1]!.spec).not.toEqual(before);

    // Targets are generated by the server; a rules patch can't write them.
    const forged = { publicMissions: [{ kind: 'expansion', gain: 1 }], version: 99 };
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: forged } })).status).toBe(200);
    expect((await view()).rules.victory).toMatchObject({ version: 4, publicMissions: expect.arrayContaining([]) });
    expect((await view()).victory!.publicMissions).toHaveLength(4);
    expect((await view()).victory!.publicMissions[0]!.spec).toEqual({ kind: 'expansion', gain: 22 });
  });

  it('lets the host have four public missions drawn at random, until the draft starts', async () => {
    const { ann, bo, id, view } = await table();
    const random = (c: Client) => c.post(`/api/campaigns/${id}/victory/missions/random`);
    expect((await random(bo)).status).toBe(403);
    const draws = new Set<string>();
    for (let i = 0; i < 4; i++) {
      expect((await random(ann)).status).toBe(200);
      const kinds = (await view(bo)).victory!.publicMissions.map((m) => m.spec.kind);
      expect(new Set(kinds).size).toBe(4);
      // Only what a contiguous draft can play.
      expect(kinds).not.toContain('consolidation');
      draws.add(kinds.join());
    }
    expect(draws.size).toBeGreaterThan(1);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await random(ann)).body).toMatchObject({ error: { message: expect.stringMatching(/locked/) } });
  });

  it('refuses a rules change that would leave a chosen mission unplayable', async () => {
    const { ann, id } = await table();
    await ann.patch(`/api/campaigns/${id}`, { rules: { draft: { mode: 'free' } } });
    const kinds = ['expansion', 'consolidation', 'two_fronts', 'great_powers'];
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    const back = await ann.patch(`/api/campaigns/${id}`, { rules: { draft: { mode: 'contiguous' } } });
    expect(back.body).toMatchObject({
      error: { code: 'mission-unplayable', message: expect.stringMatching(/Consolidation/) },
    });
  });

  it("holds claims at least the pace's default, and resets the timings when the pace changes", async () => {
    const { ann, id, view } = await table();
    const short = await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { holdMinutes: 12 * 60 } } });
    expect(short.body).toMatchObject({ error: { code: 'invalid-rules', message: expect.stringMatching(/24 hours/) } });
    const longer = { holdMinutes: 48 * 60, selectionMinutes: 12 * 60 };
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: longer } })).status).toBe(200);
    expect((await view()).victory!.holdMs).toBe(48 * HOUR);

    // Days to hold would make no sense in a live campaign: its own defaults apply.
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { war: { pace: 'live' } } })).status).toBe(200);
    expect((await view()).rules.victory).toMatchObject({ holdMinutes: null, selectionMinutes: null });
    expect((await view()).victory!.holdMs).toBe(10 * 60_000);
    const fast = await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { holdMinutes: 5 } } });
    expect(fast.body).toMatchObject({
      error: { message: 'Claims have to be held at least 10 minutes in live campaigns.' },
    });
    const both = { war: { pace: 'correspondence' }, victory: { holdMinutes: 72 * 60 } };
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: both })).status).toBe(200);
    expect((await view()).rules.victory).toMatchObject({ holdMinutes: 72 * 60, selectionMinutes: null });
  });

  it('leaves open-ended campaigns without missions', async () => {
    const ann = await signIn(server.app, 'Ann');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Sandbox',
      rules: { victory: { mode: 'open' } },
    });
    const c = (await ann.get<CampaignView>(`/api/campaigns/${body.id}`)).body;
    expect(c.victory).toBeNull();
    expect(c.rules.victory.publicMissions).toEqual([]);
  });
});

describe('an Objectives campaign from start to finish', () => {
  it('deals secrets privately, reveals, claims through the response window, scores and ends', async () => {
    const { ann, bo, cy, id, view, give, nextRound, passAll } = await table();
    // Missions that can't be completed by accident while countries are moved about below.
    const kinds = ['expansion', 'strategic_positions', 'campaign_veteran', 'across_the_seas'];
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);

    // --- Choosing secret missions -------------------------------------------------------------
    const dealt = await view();
    expect(dealt).toMatchObject({ status: 'selection', round: 0 });
    expect(dealt.events.at(-1)).toMatchObject({ type: 'missions.dealt' });
    expect(dealt.victory!.selection).toMatchObject({ unresolved: [] });
    const annOptions = dealt.mySecret!.options!;
    expect(annOptions.length).toBeGreaterThanOrEqual(1);
    expect(annOptions.length).toBeLessThanOrEqual(3);
    // Persisted: a refresh shows the very same options.
    expect((await view()).mySecret!.options).toEqual(annOptions);
    const boOptions = (await view(bo)).mySecret!.options!;
    const cyOptions = (await view(cy)).mySecret!.options!;
    // Nobody sees anyone else's options, the host included. (Two players can be dealt the same
    // mission, so only options the viewer wasn't dealt themselves are looked for.)
    const secretsOf = (options: typeof annOptions, except: typeof annOptions = []) =>
      options.map((o) => JSON.stringify(o.spec)).filter((s) => !except.some((e) => JSON.stringify(e.spec) === s));
    for (const s of secretsOf(boOptions, annOptions)) expect(JSON.stringify(await view(ann))).not.toContain(s);
    for (const s of secretsOf(annOptions, boOptions)) expect(JSON.stringify(await view(bo))).not.toContain(s);
    expect((await bo.post(`/api/campaigns/${id}/round/next`)).status).toBe(403);
    expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(409);

    const socket = await listen(server.app, bo);
    expect((await ann.post(`/api/campaigns/${id}/secret`, { optionId: 'nope' })).status).toBe(400);
    expect((await ann.post(`/api/campaigns/${id}/secret`, { optionId: annOptions[0]!.id })).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/secret`, { optionId: annOptions[0]!.id })).status).toBe(409);
    const afterAnn = await view(bo);
    expect(afterAnn.victory!.players.find((p) => p.userId === ANN)).toMatchObject({ ready: true, secret: null });
    expect(afterAnn.victory!.players.find((p) => p.userId === BO)).toMatchObject({ ready: false });
    const mine = await view();
    expect(mine.mySecret).toMatchObject({
      options: null,
      auto: false,
      revealed: false,
      mission: { spec: annOptions[0]!.spec },
    });
    expect((await bo.post(`/api/campaigns/${id}/secret`, { optionId: boOptions.at(-1)!.id })).status).toBe(200);
    await tick();
    socket.close();
    for (const s of secretsOf(annOptions)) expect(JSON.stringify(socket.messages)).not.toContain(s);

    // Cy never chooses: when time runs out the best fit is assigned, privately.
    server.clock.advance(24 * HOUR + 1);
    await server.runDue();
    await tick();
    const started = await view(cy);
    expect(started).toMatchObject({ status: 'active', round: 1 });
    const roundOne = started.events.findIndex((e) => e.type === 'round.started' && e.payload.round === 1);
    expect(roundOne).toBeGreaterThan(-1);
    // Drafted holdings count: a player who drafted three positions has a claim, started with
    // round 1 (not before), which must serve the whole response window like any other.
    for (const claim of started.victory!.claims) {
      expect(claim).toMatchObject({ missionKey: 'p1', startedRound: 1, eligibleRound: 3, eligibleAt: null });
      expect(started.events.findIndex((e) => e.type === 'claim.started')).toBeGreaterThan(roundOne);
    }
    expect(started.mySecret).toMatchObject({
      auto: true,
      mission: { spec: cyOptions.find((o) => o.rank === 1)!.spec },
    });
    const cyNotice = server.notices.find((n) => n.userId === CY && n.title.startsWith('Your secret mission'));
    expect(cyNotice).toBeDefined();
    expect(server.notices.filter((n) => n.userId !== CY && n.title === cyNotice!.title)).toEqual([]);
    expect(started.members.every((m) => m.tokens === 1)).toBe(true);

    // --- Known secrets for the script below ----------------------------------------------------
    // Ann's is the Mediterranean Arc. Bo's and Cy's are three countries of each other's that the
    // script never hands them, so nothing below completes them by accident.
    const c1 = await view();
    const positions = c1.victory!.publicMissions[1]!.spec;
    if (positions.kind !== 'strategic_positions') throw new Error('positions');
    const owned = (userId: string) => Object.entries(c1.holdings).flatMap(([t, o]) => (o === userId ? [t] : []));
    const annHeld = new Set(owned(ANN));
    const reserved = new Set([...positions.territories, ...MED]);
    const big = dataset.territories
      .filter((t) => !annHeld.has(t.id) && !reserved.has(t.id))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((t) => t.id);
    for (const t of big) reserved.add(t);
    const untouched = (userId: string) =>
      owned(userId)
        .filter((t) => !reserved.has(t))
        .slice(0, 3);
    const setSecret = (userId: string, secret: object) =>
      server.app.ctx.db
        .update(missionPlayers)
        .set({ secret: secret as never })
        .where(and(eq(missionPlayers.campaignId, id), eq(missionPlayers.userId, userId)));
    await setSecret(ANN, { kind: 'mediterranean_arc', territories: MED, need: 4, reveal: 3 });
    await setSecret(BO, { kind: 'hidden_triangle', territories: untouched(CY), need: 3, reveal: 3 });
    await setSecret(CY, { kind: 'hidden_triangle', territories: untouched(BO), need: 3, reveal: 3 });
    const annSecret = JSON.stringify({ kind: 'mediterranean_arc', territories: MED, need: 4, reveal: 3 });

    // --- Public missions: Expansion and Strategic Positions, claimed in round 1 ---------------
    // Ann must hold none of the Mediterranean yet; move any she drafted to Bo.
    const drafted = MED.filter((t) => annHeld.has(t));
    if (drafted.length > 0) await give(drafted, BO);
    // Taking three positions from whoever drafted them interrupts any claim they had.
    const draftedClaim = started.victory!.claims[0];
    await give([...positions.territories.slice(0, 3), ...big], ANN);
    const claimed = await view(bo);
    expect(
      claimed.victory!.claims.map((c) => [c.userId, c.missionKey, c.startedRound, c.eligibleRound]).sort(),
    ).toEqual([
      [ANN, 'p0', 1, 3],
      [ANN, 'p1', 1, 3],
    ]);
    const annClaims = claimed.events.filter((e) => e.type === 'claim.started' && e.payload.userId === ANN);
    expect(annClaims).toHaveLength(2);
    if (draftedClaim?.userId === ANN) {
      // Ann drafted them: a different three of five still qualifies, so her claim carries on.
      expect(claimed.victory!.claims.find((c) => c.missionKey === 'p1')!.id).toBe(draftedClaim.id);
    } else if (draftedClaim) {
      expect(claimed.events).toContainEqual(
        expect.objectContaining({
          type: 'claim.interrupted',
          payload: expect.objectContaining({ claimId: draftedClaim.id }),
        }),
      );
    }
    const progress = claimed.victory!.players.find((p) => p.userId === ANN)!.progress;
    // Version 3: at least one of the positions held was won since the draft.
    expect(progress.p1).toMatchObject({
      complete: true,
      parts: [
        { need: 3, done: true },
        { need: 1, done: true },
      ],
    });
    expect(progress.p1!.evidence.territories.length).toBe(progress.p1!.parts[0]!.have);

    // New campaigns hold claims through a round's turns, not for a time.
    expect(claimed.victory!.hold).toBe('turns');
    await nextRound();
    const r2 = await view();
    expect(r2.victory!.claims.every((c) => c.eligibleAt === null && !c.turnsHeld)).toBe(true);
    expect(r2.victory!.players.find((p) => p.userId === ANN)!.points).toBe(0);
    // The host moves on at once: round 3 has come, but nobody has had a turn since the claims began.
    await nextRound();
    expect((await view()).victory!.players.find((p) => p.userId === ANN)!.points).toBe(0);
    // Turns that run out pass on their own; the last one ends declaring, and the claims score.
    const turns = (await view()).turns!;
    expect(turns.current).not.toBeNull();
    for (let i = 0; i < turns.order.length && (await view()).turns?.current; i++) {
      expect((await view()).victory!.players.find((p) => p.userId === ANN)!.points).toBe(0);
      server.clock.advance(24 * HOUR);
      await server.runDue();
    }
    const scored = await view(bo);
    expect(scored.turns!.current).toBeNull();
    expect(scored.victory!.players.find((p) => p.userId === ANN)).toMatchObject({ points: 4 });
    expect(scored.events.filter((e) => e.type === 'mission.awarded').map((e) => e.payload)).toEqual([
      expect.objectContaining({ userId: ANN, missionKey: 'p0', points: 2, total: 2 }),
      expect.objectContaining({ userId: ANN, missionKey: 'p1', points: 2, total: 4 }),
    ]);

    // Points are permanent: losing a position afterwards costs nothing. Bo can score it too.
    await give(positions.territories.slice(0, 3), BO);
    const nonexclusive = await view();
    expect(nonexclusive.victory!.players.find((p) => p.userId === ANN)!.points).toBe(4);
    expect(nonexclusive.victory!.claims.map((c) => [c.userId, c.missionKey, c.startedRound])).toContainEqual([
      BO,
      'p1',
      3,
    ]);

    // --- The secret: revealed one step away, claimed when complete ----------------------------
    const beforeReveal = [
      JSON.stringify(await view(bo)),
      JSON.stringify(await view(cy)),
      JSON.stringify((await bo.get<FeedPage>(`/api/campaigns/${id}/feed`)).body),
      JSON.stringify((await bo.get<CampaignStats>(`/api/campaigns/${id}/stats`)).body),
      JSON.stringify(server.notices.filter((n) => n.userId !== ANN)),
    ];
    await tick();
    for (const text of beforeReveal) expect(text).not.toMatch(/mediterranean/i);

    const watch = await listen(server.app, cy);
    await give(MED.slice(0, 3), ANN);
    await tick();
    watch.close();
    const revealed = await view(cy);
    const annPublic = revealed.victory!.players.find((p) => p.userId === ANN)!;
    expect(annPublic.secret).toMatchObject({ reason: 'near', revealedRound: 3, mission: { key: 'secret' } });
    expect(annPublic.secret!.mission.spec).toEqual(JSON.parse(annSecret));
    expect(annPublic.progress.secret).toMatchObject({ complete: false, near: true, parts: [{ have: 3, need: 4 }] });
    const pushed = watch.messages.flatMap((m: ServerMessage) => (m.type === 'campaign.events' ? m.events : []));
    expect(pushed).toContainEqual(
      expect.objectContaining({ type: 'mission.revealed', payload: expect.objectContaining({ userId: ANN }) }),
    );
    expect(server.notices.some((n) => n.userId === CY && n.title.includes('Mediterranean Arc'))).toBe(true);

    // Losing progress never hides it again.
    await give(['ESP'], BO);
    expect((await view(cy)).victory!.players.find((p) => p.userId === ANN)!.secret).not.toBeNull();
    await give(['ESP', 'TUN'], ANN);
    const secretClaim = (await view(bo)).victory!.claims.find((c) => c.userId === ANN && c.missionKey === 'secret');
    expect(secretClaim).toMatchObject({ startedRound: 3, eligibleRound: 5 });

    // --- Round 5, once everyone has had their turns in round 4: 2 + 2 + 3 = 7 -------------------
    await nextRound();
    await passAll();
    await nextRound();
    const done = await view(bo);
    expect(done.status).toBe('finished');
    expect(done.victory!.result).toMatchObject({ winners: [ANN], round: 5 });
    expect(done.victory!.result!.standings[0]).toMatchObject({ userId: ANN, points: 7 });
    // Bo's Strategic Positions claim from round 3 scored in the same batch.
    expect(done.victory!.players.find((p) => p.userId === BO)!.points).toBe(2);
    // Every secret mission is public in the results, finished or not.
    for (const s of done.victory!.result!.standings) {
      expect(s.secret).not.toBeNull();
      expect(s.secret!.completed).toBe(s.userId === ANN);
    }
    expect(done.victory!.players.every((p) => p.secret !== null)).toBe(true);
    const types = done.events.map((e) => e.type);
    expect(types.at(-1)).toBe('campaign.won');
    expect(types.filter((t) => t === 'mission.revealed')).toHaveLength(3);
    await tick();
    expect(server.notices.filter((n) => n.tag === `victory:${id}`)).toHaveLength(3);

    // Read-only from here on.
    expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(409);
    const target = Object.entries(done.holdings).find(([, o]) => o === BO)![0];
    const declared = await ann.post(`/api/campaigns/${id}/wars`, {
      targetId: target,
      launchId: target,
      stake: [target],
    });
    expect(declared.status).toBe(409);
    expect((await ann.post(`/api/campaigns/${id}/accords`, { partnerId: BO, rounds: 2 })).status).toBe(409);
    // Running the deadlines again changes nothing.
    const eventCount = done.events.length;
    server.clock.advance(48 * HOUR);
    await server.runDue();
    expect((await view()).events).toHaveLength(eventCount);
  });
});

describe('titles', () => {
  it('go to the leaders when round 1 starts, count as points, and move with the lead', async () => {
    const { ann, bo, id, view, give } = await table({ version: null });
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    expect((await view()).victory!.titles.every((t) => t.holderId === null)).toBe(true);
    server.clock.advance(24 * HOUR + 1);
    await server.runDue();
    await tick();

    const started = await view(bo);
    expect(started).toMatchObject({ status: 'active', round: 1 });
    const titles = started.victory!.titles;
    expect(titles.map((t) => t.kind)).toEqual(['population', 'land', 'economy', 'military']);
    for (const t of titles) {
      // Whoever holds it leads, and every player's figure is there.
      const totals = Object.values(t.totals);
      expect(totals).toHaveLength(3);
      expect(t.holderId).not.toBeNull();
      expect(t.totals[t.holderId!]).toBe(Math.max(...totals));
    }
    const changed = started.events.filter((e) => e.type === 'title.changed');
    expect(changed).toHaveLength(4);
    for (const p of started.victory!.players) {
      const held = titles.filter((t) => t.holderId === p.userId).map((t) => t.kind);
      expect(p.titles).toEqual(held);
      expect(p.points).toBe(held.length);
    }

    // Everything but one country each goes to Bo, who then leads on every figure.
    const owners = Object.entries(started.holdings);
    const keep = new Set([ANN, CY].map((u) => owners.find(([, o]) => o === u)![0]));
    await give(
      owners.filter(([t, o]) => o !== BO && !keep.has(t)).map(([t]) => t),
      BO,
    );
    await tick();
    const after = await view(bo);
    expect(after.victory!.titles.map((t) => t.holderId)).toEqual([BO, BO, BO, BO]);
    expect(after.victory!.players.find((p) => p.userId === BO)).toMatchObject({ points: 4 });
    expect(after.victory!.players.filter((p) => p.userId !== BO).every((p) => p.points === 0)).toBe(true);
    const moved = after.events.filter((e) => e.type === 'title.changed').slice(4);
    expect(moved.every((e) => e.type === 'title.changed' && e.payload.to === BO)).toBe(true);
    // The race round by round takes the titles away from their old holders too.
    const stats = (await bo.get<CampaignStats>(`/api/campaigns/${id}/stats`)).body;
    expect(stats.history.points.map((p) => p.victoryPoints)).toEqual([
      { [ANN]: 0, [BO]: 0, [CY]: 0 },
      { [ANN]: 0, [BO]: 4, [CY]: 0 },
    ]);
    // Told of each title taken; those who lost one are told too.
    for (const t of titles.filter((t) => t.holderId !== BO)) {
      const name = {
        population: 'Largest Population',
        land: 'Largest Territory',
        economy: 'Largest Economy',
        military: 'Greatest Military Might',
      }[t.kind];
      expect(server.notices.some((n) => n.userId === BO && n.title === `+1 victory point: ${name}`)).toBe(true);
      expect(server.notices.some((n) => n.userId === t.holderId && n.title === `${name} lost`)).toBe(true);
    }
  });
});

describe('the season', () => {
  it('ends after the last round the host set: the most points win, and the campaign is over', async () => {
    const { ann, bo, cy, id, view, give, nextRound, passAll } = await table();
    // Records that need wars, and Expansion: nothing below completes by accident but Expansion.
    const kinds = ['expansion', 'campaign_veteran', 'across_the_seas', 'lightning_campaign'];
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    expect((await bo.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 3 } } })).status).toBe(403);
    const tooShort = await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 1 } } });
    expect(tooShort.status).toBe(400);
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 3 } } })).status).toBe(200);
    expect((await view()).victory!.lastRound).toBe(3);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    for (const c of [ann, bo, cy]) {
      const options = (await view(c)).mySecret!.options!;
      expect((await c.post(`/api/campaigns/${id}/secret`, { optionId: options[0]!.id })).status).toBe(200);
    }
    // Secrets nobody can complete by accident: countries of a rival that the script never moves.
    const start = await view();
    const owned = (userId: string) => Object.entries(start.holdings).flatMap(([t, o]) => (o === userId ? [t] : []));
    const triangle = (userId: string) => ({
      kind: 'hidden_triangle',
      territories: owned(userId).slice(-3),
      need: 3,
      reveal: 3,
    });
    for (const [player, rival] of [
      [ANN, BO],
      [BO, CY],
      [CY, ANN],
    ] as const) {
      await server.app.ctx.db
        .update(missionPlayers)
        .set({ secret: triangle(rival) as never })
        .where(and(eq(missionPlayers.campaignId, id), eq(missionPlayers.userId, player)));
    }
    // Ann gains well over the value Expansion asks for in round 1, from whoever is richest.
    const richest = [BO, CY].map((userId) => owned(userId).slice(0, -3)).sort((a, b) => b.length - a.length)[0]!;
    await give(richest.slice(0, 12), ANN);
    expect((await view()).victory!.claims).toContainEqual(
      expect.objectContaining({ userId: ANN, missionKey: 'p0', eligibleRound: 3 }),
    );

    await nextRound();
    await passAll();
    await nextRound();
    const last = await view(bo);
    expect(last).toMatchObject({ status: 'active', round: 3 });
    expect(last.victory!.players.find((p) => p.userId === ANN)!.points).toBe(2);

    // Moving on from the last round ends the campaign instead of starting round 4.
    await nextRound();
    const done = await view(bo);
    expect(done).toMatchObject({ status: 'finished', round: 3 });
    expect(done.victory!.result).toMatchObject({ winners: [ANN], round: 3, seasonEnd: true });
    expect(done.events.at(-1)).toMatchObject({ type: 'campaign.won', payload: { winners: [ANN], seasonEnd: true } });
    const stats = (await bo.get<CampaignStats>(`/api/campaigns/${id}/stats`)).body;
    expect(stats.history.points.map((p) => [p.round, p.victoryPoints![ANN], p.victoryPoints![BO]])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 2, 0],
    ]);
    await tick();
    const ending = server.notices.filter((n) => n.tag === `victory:${id}`);
    expect(ending).toHaveLength(3);
    expect(ending[0]!.body).toMatch(/round 3 was its last/);
    // The news of the ending opens the results.
    expect(ending.every((n) => n.url === `/c/${id}/results`)).toBe(true);
    expect((await ann.post(`/api/campaigns/${id}/round/next`)).status).toBe(409);
  });

  /**
   * Plays a three-round season in which nobody scores, so everyone ends level on points. `stored`
   * strips the tiebreak from the rules, as campaigns created before it stored them.
   */
  async function levelSeason(stored = false) {
    const { ann, bo, cy, id, view, nextRound } = await table();
    const kinds = ['expansion', 'campaign_veteran', 'across_the_seas', 'lightning_campaign'];
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 3 } } })).status).toBe(200);
    if (stored) {
      const { rules } = await view();
      const { tiebreak: _, ...victory } = rules.victory;
      await server.app.ctx.db
        .update(campaigns)
        .set({ rules: { ...rules, victory } as never })
        .where(eq(campaigns.id, id));
    }
    expect((await view()).victory!.tiebreak).toBe(stored ? 'value' : 'realWorld');
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.post(`/api/campaigns/${id}/draft/end`)).status).toBe(200);
    for (const c of [ann, bo, cy]) {
      const options = (await view(c)).mySecret!.options!;
      expect((await c.post(`/api/campaigns/${id}/secret`, { optionId: options[0]!.id })).status).toBe(200);
    }
    // Secrets nobody completes: three countries of a rival that never change hands.
    const start = await view();
    const owned = (userId: string) => Object.entries(start.holdings).flatMap(([t, o]) => (o === userId ? [t] : []));
    for (const [player, rival] of [
      [ANN, BO],
      [BO, CY],
      [CY, ANN],
    ] as const) {
      const secret = { kind: 'hidden_triangle', territories: owned(rival).slice(-3), need: 3, reveal: 3 };
      await server.app.ctx.db
        .update(missionPlayers)
        .set({ secret: secret as never })
        .where(and(eq(missionPlayers.campaignId, id), eq(missionPlayers.userId, player)));
    }
    for (let round = 1; round <= 3; round++) {
      server.clock.advance(25 * HOUR);
      await nextRound();
    }
    const done = await view(bo);
    expect(done.status).toBe('finished');
    const byId = new Map(dataset.territories.map((t) => [t.id, t]));
    // Summed in id order, as the server sums them, so fractional areas add up to the same figure.
    const total = (userId: string, of: (t: Dataset['territories'][number]) => number) =>
      owned(userId)
        .sort()
        .reduce((sum, t) => sum + of(byId.get(t)!), 0);
    return { result: done.victory!.result!, total };
  }

  it('settles a tie on points by population, then land area, then GDP', async () => {
    const { result, total } = await levelSeason();
    expect(result).toMatchObject({ seasonEnd: true, tiebreak: 'realWorld' });
    expect(result.standings.map((s) => s.points)).toEqual([0, 0, 0]);
    const people = (userId: string) => total(userId, (t) => t.stats.population ?? 0);
    const largest = [ANN, BO, CY].sort((a, b) => people(b) - people(a))[0]!;
    expect(result.winners).toEqual([largest]);
    expect(result.standings.map((s) => s.userId)[0]).toBe(largest);
    expect(result.standings[0]!.measures).toEqual([
      people(largest),
      total(largest, (t) => t.stats.areaKm2 ?? 0),
      total(largest, (t) => t.stats.gdpNominalUsd ?? 0),
    ]);
    // The game value would have crowned someone else.
    const value = (userId: string) => total(userId, (t) => t.value);
    expect([ANN, BO, CY].sort((a, b) => value(b) - value(a))[0]).not.toBe(largest);
    const order = result.standings.map((s) => s.measures![0]!);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it('keeps the most valuable empire for campaigns stored before the real-world tiebreak', async () => {
    const { result, total } = await levelSeason(true);
    expect(result).toMatchObject({ seasonEnd: true, tiebreak: 'value' });
    const value = (userId: string) => total(userId, (t) => t.value);
    const richest = [ANN, BO, CY].sort((a, b) => value(b) - value(a))[0]!;
    expect(result.winners).toEqual([richest]);
    expect(result.standings[0]!.measures).toEqual([value(richest)]);
  });

  it('is off for campaigns stored before it existed', async () => {
    const { ann, id, view } = await table();
    // As a version 2 campaign stored its rules: no last round.
    const { rules } = await view();
    const { lastRound: _, ...stored } = rules.victory;
    await server.app.ctx.db
      .update(campaigns)
      .set({ rules: { ...rules, victory: { ...stored, version: 2 } } as never })
      .where(eq(campaigns.id, id));
    expect((await view()).victory).toMatchObject({ version: 2, lastRound: null });
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 20 } } })).status).toBe(200);
    expect((await view()).victory).toMatchObject({ version: 2, lastRound: 20 });
  });
});

describe('the size of the table', () => {
  it('keeps The Great Connection and Mare Nostrum to four players or fewer', async () => {
    const { ann, id, view } = await table();
    const { inviteCode } = await view();
    const kinds = ['expansion', 'great_connection', 'campaign_veteran', 'two_fronts'];
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);
    const di = await signIn(server.app, 'Di');
    expect((await di.post(`/api/invites/${inviteCode}/join`)).status).toBe(200);
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).status).toBe(200);

    // A fifth player joins: the mission stays chosen, and other settings can still change, but the
    // draft can't start with it.
    const ed = await signIn(server.app, 'Ed');
    expect((await ed.post(`/api/invites/${inviteCode}/join`)).status).toBe(200);
    expect((await ann.patch(`/api/campaigns/${id}`, { rules: { victory: { lastRound: 20 } } })).status).toBe(200);
    const refused = await ann.post(`/api/campaigns/${id}/draft/start`);
    expect(refused.body).toMatchObject({
      error: {
        code: 'missions-not-ready',
        message: expect.stringMatching(/The Great Connection: Only for campaigns of up to four players/),
      },
    });
    expect((await ann.put(`/api/campaigns/${id}/victory/missions`, { kinds })).body).toMatchObject({
      error: { code: 'bad-missions', message: expect.stringMatching(/up to four players/) },
    });
    for (let i = 0; i < 6; i++) {
      expect((await ann.post(`/api/campaigns/${id}/victory/missions/random`)).status).toBe(200);
      const drawn = (await view()).victory!.publicMissions.map((m) => m.spec.kind);
      expect(drawn).not.toContain('great_connection');
      expect(drawn).not.toContain('mare_nostrum');
    }
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
  });
});

describe('ending early', () => {
  /** Three players at war in round 1, every secret mission chosen. */
  async function atWar() {
    const t = await table();
    expect((await t.ann.post(`/api/campaigns/${t.id}/draft/start`)).status).toBe(200);
    expect((await t.ann.post(`/api/campaigns/${t.id}/draft/end`)).status).toBe(200);
    for (const c of [t.ann, t.bo, t.cy]) {
      const options = (await t.view(c)).mySecret!.options!;
      expect((await c.post(`/api/campaigns/${t.id}/secret`, { optionId: options[0]!.id })).status).toBe(200);
    }
    expect(await t.view()).toMatchObject({ status: 'active', round: 1 });
    return t;
  }

  it('lets the host end the campaign on points before the last round, and deletes it a week later', async () => {
    const { ann, bo, id, view } = await atWar();
    expect((await bo.post(`/api/campaigns/${id}/end`)).status).toBe(403);
    const socket = await listen(server.app, bo);
    expect((await ann.post(`/api/campaigns/${id}/end`)).status).toBe(200);
    const done = await view(bo);
    expect(done).toMatchObject({ status: 'finished', round: 1 });
    expect(done.victory!.result).toMatchObject({ round: 1, seasonEnd: true, endedEarly: true });
    expect(done.victory!.result!.winners).toHaveLength(1);
    expect(done.events.at(-1)).toMatchObject({
      type: 'campaign.won',
      payload: { seasonEnd: true, endedEarly: true },
    });
    await tick();
    const ending = server.notices.filter((n) => n.tag === `victory:${id}`);
    expect(ending).toHaveLength(3);
    expect(ending[0]!.body).toMatch(/^The host ended Grand Strategy in round 1, and the most points won/);
    expect((await ann.post(`/api/campaigns/${id}/end`)).body).toMatchObject({ error: { code: 'not-active' } });

    // Kept a week from the end, for the results, then deleted for everyone without a notice.
    const deleteAt = Date.parse(done.deleteAt!);
    expect(deleteAt).toBe(Date.parse(done.victory!.result!.finishedAt) + 7 * 24 * HOUR);
    const listed = (await bo.get<CampaignSummary[]>('/api/campaigns')).body.find((c) => c.id === id);
    expect(listed?.deleteAt).toBe(done.deleteAt);
    const notices = server.notices.length;
    server.clock.advance(deleteAt - server.clock.now().getTime() - 60_000);
    await server.runDue();
    expect((await bo.get(`/api/campaigns/${id}`)).status).toBe(200);
    server.clock.advance(60_000);
    await server.runDue();
    await tick();
    socket.close();
    expect((await bo.get(`/api/campaigns/${id}`)).status).toBe(404);
    expect(socket.messages).toContainEqual({ type: 'campaign.deleted', campaignId: id });
    // Other campaigns' deadlines passed in that week too: only this campaign's notices count.
    expect(server.notices.slice(notices).filter((n) => n.url.includes(id) || n.tag?.includes(id))).toEqual([]);
  });

  it('is only for an Objectives campaign at war', async () => {
    const { ann, id } = await table();
    expect((await ann.post(`/api/campaigns/${id}/end`)).body).toMatchObject({ error: { code: 'not-active' } });
    const open = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Open Ended',
      rules: { victory: { mode: 'open' } },
    });
    await server.app.ctx.db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, open.body.id));
    expect((await ann.post(`/api/campaigns/${open.body.id}/end`)).body).toMatchObject({
      error: { code: 'open-ended' },
    });
    // The host can still delete it.
    expect((await ann.del(`/api/campaigns/${open.body.id}`)).status).toBe(200);
  });
});
