import type { CampaignRulesInput, CampaignSummary, CampaignView } from '@empire/rules';
import { turnOrder } from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, holdings, members } from '../src/db/schema';
import { ORIGINAL_STAKES, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Declaring in turns, as new campaigns play it. On the war test map Ann holds A1 A2 A3 A4 A6, Bo
 * B1 B2 B5 B7 B10, and Cy Q2 R2 U3 (values are in the ids). Seats go Ann, Bo, Cy, so round 2 goes
 * in that order.
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
  Q2: CY,
  R2: CY,
  U3: CY,
};

/**
 * An active campaign at the end of round 1, with everyone holding `tokens`; `start()` begins round
 * 2, which brings each player a token and the first turn to Ann.
 */
async function setup(rules: CampaignRulesInput = {}, opts: { owners?: Record<string, string>; tokens?: number } = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const cy = await signIn(server.app, 'Cy');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Turn Order',
    // The map is sized for the original stakes.
    rules: { victory: { mode: 'open' }, ...rules, war: { ...ORIGINAL_STAKES, ...rules.war } },
  });
  const id = body.id;
  const url = `/api/campaigns/${id}`;
  const { inviteCode } = (await ann.get<CampaignView>(url)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  await cy.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  await db
    .update(campaigns)
    .set({ status: 'active', round: 1, draftOrder: [ANN, BO, CY] })
    .where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    Object.entries(opts.owners ?? OWNERS).map(([territoryId, ownerId]) => ({
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

  const view = async (c: Client = ann) => (await c.get<CampaignView>(url)).body;
  const turns = async () => (await view()).turns;
  const start = () => ann.post(`${url}/round/next`);
  const declare = (by: Client, targetId: string, launchId: string) =>
    by.post<{ id: string }>(`${url}/wars`, { targetId, launchId, stake: [launchId] });
  const fortify = (by: Client, territoryId: string) => by.post(`${url}/fortify`, { territoryId });
  const pass = (by: Client, userId: string) => by.post(`${url}/turn/pass`, { userId });
  const lastEvents = async (n: number) => (await view()).events.slice(-n);
  return { ann, bo, cy, id, url, view, turns, start, declare, fortify, pass, lastEvents };
}

describe('declaring in turns', () => {
  it('starts each round at the top of an order that moves on a seat a round', async () => {
    const { turns, start, lastEvents } = await setup();
    expect(await turns()).toBeNull();
    expect((await start()).status).toBe(200);
    const now = server.clock.now().getTime();
    expect(await turns()).toEqual({
      order: [ANN, BO, CY],
      current: ANN,
      deadline: new Date(now + 24 * HOUR).toISOString(),
      passed: [],
    });
    const [started] = await lastEvents(1);
    expect(started).toMatchObject({ type: 'round.started', payload: { round: 2, order: [ANN, BO, CY] } });
    await tick();
    expect(server.notices.at(-1)).toMatchObject({
      userId: ANN,
      title: 'Your turn to declare war',
      body: 'Declare war, fortify a country or pass, within 24 hours.',
      email: true,
    });

    await start();
    expect(await turns()).toMatchObject({ order: [BO, CY, ANN], current: BO, passed: [] });
  });

  it('takes one declaration or fortification a turn, and refuses anyone out of turn', async () => {
    const { ann, bo, cy, turns, start, declare, fortify, view } = await setup();
    await start();
    const early = await declare(bo, 'A4', 'B5');
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({
      error: { code: 'not-your-turn', message: "It's Ann's turn to declare. Yours comes round." },
    });
    expect((await fortify(cy, 'Q2')).body).toMatchObject({ error: { code: 'not-your-turn' } });

    expect((await declare(ann, 'B5', 'A4')).status).toBe(201);
    expect(await turns()).toMatchObject({ current: BO });
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: BO, title: 'Your turn to declare war' });
    expect((await declare(ann, 'B1', 'A1')).body).toMatchObject({ error: { code: 'not-your-turn' } });

    expect((await fortify(bo, 'B7')).status).toBe(200);
    expect(await turns()).toMatchObject({ current: CY });
    expect((await declare(cy, 'A2', 'Q2')).status).toBe(201);
    // Round again: Ann has a token left.
    expect(await turns()).toMatchObject({ current: ANN, passed: [] });
    expect((await view()).members.map((m) => m.tokens)).toEqual([1, 1, 1]);
  });

  it('ends a player’s declaring when they pass, and everyone’s with the last pass', async () => {
    const { ann, bo, cy, turns, start, declare, pass, lastEvents } = await setup();
    await start();
    expect((await pass(ann, ANN)).status).toBe(200);
    expect(await turns()).toMatchObject({ current: BO, passed: [ANN] });
    expect((await lastEvents(1))[0]).toMatchObject({
      type: 'turn.passed',
      actorId: ANN,
      payload: { userId: ANN, auto: false },
    });
    expect((await pass(ann, ANN)).body).toMatchObject({ error: { code: 'not-your-turn' } });
    await pass(bo, BO);
    // Cy declares; with the others done, the turn comes back to Cy.
    expect((await declare(cy, 'A2', 'Q2')).status).toBe(201);
    expect(await turns()).toMatchObject({ current: CY, passed: [ANN, BO] });
    await pass(cy, CY);
    expect(await turns()).toMatchObject({ current: null, deadline: null, passed: [ANN, BO, CY] });
    expect((await lastEvents(2)).map((e) => e.type)).toEqual(['turn.passed', 'turns.ended']);
    expect((await declare(ann, 'B5', 'A4')).body).toMatchObject({
      error: { code: 'turns-over', message: 'Declaring is over for this round. The next round brings new turns.' },
    });
    expect((await pass(ann, ANN)).body).toMatchObject({ error: { code: 'turns-over' } });
    await start();
    expect(await turns()).toMatchObject({ current: BO, passed: [] });
  });

  it('lets the host pass for whoever holds the turn, naming them', async () => {
    const { ann, bo, cy, turns, start, pass, lastEvents } = await setup();
    await start();
    await pass(ann, ANN);
    expect((await pass(cy, BO)).status).toBe(403);
    expect((await pass(ann, CY)).body).toMatchObject({
      error: { code: 'not-your-turn', message: 'The turn has moved on.' },
    });
    expect((await pass(ann, BO)).status).toBe(200);
    expect((await lastEvents(1))[0]).toMatchObject({
      type: 'turn.passed',
      actorId: ANN,
      payload: { userId: BO, auto: false },
    });
    expect(await turns()).toMatchObject({ current: CY, passed: [ANN, BO] });
    expect((await pass(bo, BO)).body).toMatchObject({ error: { code: 'not-your-turn' } });
  });

  it('passes a turn nobody takes in time', async () => {
    const { turns, start, lastEvents } = await setup();
    await start();
    server.clock.advance(24 * HOUR - 1000);
    await server.runDue();
    expect(await turns()).toMatchObject({ current: ANN });
    server.clock.advance(2000);
    await server.runDue();
    expect(await turns()).toMatchObject({ current: BO, passed: [ANN] });
    expect((await lastEvents(1))[0]).toMatchObject({
      type: 'turn.passed',
      actorId: null,
      payload: { userId: ANN, auto: true },
    });
  });

  it('passes over players with nothing to do', async () => {
    // Cy holds nothing: nothing to declare war from, nothing to fortify.
    const owners = { ...OWNERS, Q2: BO, R2: BO, U3: ANN };
    const { ann, bo, turns, start, declare, fortify } = await setup({}, { owners, tokens: 0 });
    await start();
    expect(await turns()).toMatchObject({ order: [ANN, BO, CY], current: ANN });
    expect((await declare(ann, 'B5', 'A4')).status).toBe(201);
    expect(await turns()).toMatchObject({ current: BO });
    expect((await fortify(bo, 'B7')).status).toBe(200);
    // Nobody has a token left, and Cy has nothing anyway: declaring is over.
    expect(await turns()).toMatchObject({ current: null, passed: [] });
  });

  it('holds live games back until declaring is over', async () => {
    const { ann, bo, cy, url, turns, start, declare, pass, view } = await setup({ war: { pace: 'live' } });
    await tick();
    const before = server.notices.length;
    await start();
    expect((await turns())?.deadline).toBe(new Date(server.clock.now().getTime() + 5 * 60_000).toISOString());
    const { body } = await declare(ann, 'B5', 'A4');
    expect((await bo.post(`${url}/wars/${body.id}/respond`, { response: 'accept' })).status).toBe(200);
    const war = async () => (await view()).wars.find((w) => w.id === body.id)!;
    expect(await war()).toMatchObject({ status: 'ready', games: [{ status: 'waiting' }] });
    await pass(bo, BO);
    await pass(cy, CY);
    expect(await war()).toMatchObject({ status: 'ready' });
    await pass(ann, ANN);
    expect(await turns()).toMatchObject({ current: null });
    expect(await war()).toMatchObject({ status: 'playing', games: [{ status: 'playing' }] });
    await tick();
    // Live turns are too short for email.
    const turnNotices = server.notices.slice(before).filter((n) => n.title === 'Your turn to declare war');
    expect(turnNotices.map((n) => [n.userId, n.email])).toEqual([
      [ANN, false],
      [BO, false],
      [CY, false],
      [ANN, false],
    ]);
  });

  it('leaves campaigns without turns declaring whenever they like', async () => {
    const { bo, turns, start, declare, lastEvents, pass } = await setup({ war: { turns: false } });
    await start();
    expect(await turns()).toBeNull();
    expect((await lastEvents(1))[0]).toMatchObject({ type: 'round.started', payload: { round: 2 } });
    expect((await lastEvents(1))[0]!.payload).not.toHaveProperty('order');
    expect((await declare(bo, 'A4', 'B5')).status).toBe(201);
    expect((await pass(bo, BO)).body).toMatchObject({ error: { code: 'no-turns' } });
  });

  it('begin with round 1 when the draft ends', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Straight to War',
      rules: { victory: { mode: 'open' } },
    });
    const url = `/api/campaigns/${body.id}`;
    const { inviteCode } = (await ann.get<CampaignView>(url)).body;
    await bo.post(`/api/invites/${inviteCode}/join`);
    expect((await ann.post(`${url}/draft/start`)).status).toBe(200);
    expect((await ann.post(`${url}/draft/end`)).status).toBe(200);
    const view = (await ann.get<CampaignView>(url)).body;
    expect(view).toMatchObject({ status: 'active', round: 1 });
    const order = turnOrder(view.draft!.order, 1);
    expect(view.turns).toMatchObject({ order, current: order[0], passed: [] });
  });

  it('count the turn in what needs the player on the home screen', async () => {
    const { ann, bo, id, start } = await setup();
    await start();
    const attention = async (c: Client) =>
      (await c.get<CampaignSummary[]>('/api/campaigns')).body.find((s) => s.id === id)!.attention;
    expect(await attention(ann)).toBe(1);
    expect(await attention(bo)).toBe(0);
  });
});
