import {
  INITIAL_FEN,
  WHITE_PEACE,
  seededRandom,
  type CampaignRulesInput,
  type CampaignView,
  type GameView,
  type WarView,
} from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEVEL_PLAY } from '../src/bots/chess';
import { isBotId } from '../src/bots/ids';
import { campaigns, games, holdings, members, users, wars } from '../src/db/schema';
import { newId } from '../src/lib/ids';
import { ORIGINAL_STAKES, signIn, startTestServer, testEngine, tick, type Client, type TestServer } from './helpers';

/**
 * Bot players on the war test map. Ann holds A1 A2 A3 A4 A6; her bot opponent holds B1 B2 B5 B7
 * B10 Q2 R2 (values are in the ids).
 */
const engine = testEngine();
let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(warDataset(), {}, { engine, random: seededRandom(7) });
});
afterAll(async () => {
  await server.close();
});

const ANN = 'dev_ann';
const A = ['A1', 'A2', 'A3', 'A4', 'A6'];
const B = ['B1', 'B2', 'B5', 'B7', 'B10', 'Q2', 'R2'];
const SCHOLARS_MATE = 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'.split(' ');

async function lobby(rules: CampaignRulesInput = {}) {
  const ann = await signIn(server.app, 'Ann');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Bot Lobby',
    // The war map is sized for the original stakes.
    rules: { victory: { mode: 'open' }, ...rules, war: { ...ORIGINAL_STAKES, ...rules.war } },
  });
  const id = body.id;
  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const addBot = (level: number, by = ann) => by.post<{ userId: string }>(`/api/campaigns/${id}/bots`, { level });
  return { ann, id, view, addBot };
}

/**
 * An active campaign in round 1 with the war map split between Ann and a bot, who has `botTokens`.
 * No raising and nearby redirects, so a declaration on B5 can only be accepted.
 */
async function atWar(rules: CampaignRulesInput = {}, opts: { level?: number; botTokens?: number } = {}) {
  const l = await lobby({ ...rules, war: { raise: 'off', redirect: 'nearby', ...rules.war } });
  const bot = (await l.addBot(opts.level ?? 4)).body.userId;
  const db = server.app.ctx.db;
  await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, l.id));
  await db.insert(holdings).values(
    [...A.map((t) => [t, ANN] as const), ...B.map((t) => [t, bot] as const)].map(([territoryId, ownerId]) => ({
      campaignId: l.id,
      territoryId,
      ownerId,
      acquiredRound: 0,
    })),
  );
  await db
    .update(members)
    .set({ tokens: 1 })
    .where(and(eq(members.campaignId, l.id), eq(members.userId, ANN)));
  await db
    .update(members)
    .set({ tokens: opts.botTokens ?? 0, botRound: 1 })
    .where(and(eq(members.campaignId, l.id), eq(members.userId, bot)));
  const war = async (warId: string) => (await l.view()).wars.find((w) => w.id === warId)!;
  const game = async (w: WarView) => (await l.ann.get<GameView>(`/api/games/${w.games.at(-1)!.id}`)).body;
  const move = (g: GameView, uci: string) =>
    l.ann.post<GameView>(`/api/games/${g.id}/move`, { uci, ply: g.moves.length });
  /** Ann attacks B5 from A4, and the bot answers. */
  const declare = async () => {
    const res = await l.ann.post<{ id: string }>(`/api/campaigns/${l.id}/wars`, {
      targetId: 'B5',
      launchId: 'A4',
      stake: ['A4'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await server.bots();
    return war(res.body.id);
  };
  return { ...l, bot, war, game, move, declare };
}

describe('bots in the lobby', () => {
  it('are added by the host with a level, a call sign and a free color, and draft by themselves', async () => {
    const { id, view, addBot } = await lobby();
    const res = await addBot(5);
    expect(res.status).toBe(201);
    expect(isBotId(res.body.userId)).toBe(true);
    const v = await view();
    const bot = v.members.find((m) => m.userId === res.body.userId)!;
    expect(bot).toMatchObject({ name: 'Alpha', bot: { level: 5 }, autodraft: true, color: 1 });
    expect(v.members.find((m) => m.userId === ANN)?.bot).toBeNull();
    expect(v.events.at(-1)).toMatchObject({
      type: 'member.joined',
      actorId: ANN,
      payload: { userId: bot.userId, name: 'Alpha', bot: { level: 5 } },
    });
    expect((await addBot(3)).status).toBe(201);
    expect((await view()).members.map((m) => m.name)).toEqual(['Ann', 'Alpha', 'Bravo']);
    expect(id).toBeTruthy();
  });

  it('are only the host’s to add, at a level there is, while there are seats', async () => {
    const { id, ann, addBot } = await lobby({ maxPlayers: 3 });
    const bo = await signIn(server.app, 'Bo');
    const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    await bo.post(`/api/invites/${inviteCode}/join`);
    expect((await addBot(4, bo)).status).toBe(403);
    expect((await addBot(0)).status).toBe(400);
    expect((await addBot(9)).status).toBe(400);
    expect((await addBot(4)).status).toBe(201);
    expect((await addBot(4)).body).toMatchObject({ error: { code: 'full' } });
  });

  it('change level until the draft starts, and go (user and all) when removed', async () => {
    const { id, ann, view, addBot } = await lobby();
    const bot = (await addBot(2)).body.userId;
    expect((await ann.patch(`/api/campaigns/${id}/bots/${bot}`, { level: 6 })).status).toBe(200);
    expect((await view()).members.find((m) => m.userId === bot)?.bot).toEqual({ level: 6, standIn: false });
    expect((await ann.patch(`/api/campaigns/${id}/bots/${ANN}`, { level: 6 })).body).toMatchObject({
      error: { code: 'not-a-bot' },
    });
    expect((await ann.post(`/api/campaigns/${id}/kick`, { userId: bot })).status).toBe(200);
    expect((await view()).members.map((m) => m.userId)).toEqual([ANN]);
    expect(await server.app.ctx.db.select().from(users).where(eq(users.id, bot))).toEqual([]);

    const other = (await addBot(3)).body.userId;
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect((await ann.patch(`/api/campaigns/${id}/bots/${other}`, { level: 5 })).body).toMatchObject({
      error: { code: 'not-in-lobby' },
    });
  });

  it('don’t read messages', async () => {
    const { id, ann, addBot } = await lobby();
    const bot = (await addBot(3)).body.userId;
    const res = await ann.post(`/api/campaigns/${id}/messages`, { body: 'Truce?', to: bot });
    expect(res.body).toMatchObject({ error: { code: 'bot-recipient' } });
  });

  it('are deleted with their campaign', async () => {
    const { id, ann, addBot } = await lobby();
    const bot = (await addBot(3)).body.userId;
    expect((await ann.del(`/api/campaigns/${id}`)).status).toBe(200);
    expect(await server.app.ctx.db.select().from(users).where(eq(users.id, bot))).toEqual([]);
  });
});

describe('bots in the draft', () => {
  it('pick at once when their turn comes, legally, until the map is full', async () => {
    const { id, ann, view, addBot } = await lobby();
    await addBot(3);
    await addBot(3);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    for (let i = 0; i < 20; i++) {
      const v = await view();
      if (v.status !== 'draft') break;
      expect(v.draft?.currentPicker).toBe(ANN);
      const free = warDataset().territories.find((t) => !v.holdings[t.id] && pickable(v, t.id));
      expect((await ann.post(`/api/campaigns/${id}/draft/pick`, { territoryId: free!.id })).status).toBe(200);
    }
    const done = await view();
    expect(done.status).toBe('active');
    expect(Object.keys(done.holdings)).toHaveLength(warDataset().territories.length);
    const picks = done.events.flatMap((e) => (e.type === 'draft.pick' && isBotId(e.payload.userId) ? [e] : []));
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((e) => e.payload.auto && e.actorId === null)).toBe(true);
  });
});

/** Whether Ann may claim `id` next in a contiguous draft. */
function pickable(v: CampaignView, id: string): boolean {
  const mine = Object.entries(v.holdings).filter(([, o]) => o === ANN);
  if (mine.length === 0) return true;
  const t = warDataset().territories.find((x) => x.id === id)!;
  const borders = [...t.land, ...t.sea].some((n) => v.holdings[n] === ANN);
  const anyBordering = warDataset().territories.some(
    (x) => !v.holdings[x.id] && [...x.land, ...x.sea].some((n) => v.holdings[n] === ANN),
  );
  return borders || !anyBordering;
}

describe('bots at war', () => {
  it('answer a declaration at once, and reply to each move', async () => {
    const { bot, declare, game, move, war } = await atWar();
    const w = await declare();
    expect(w.status).toBe('playing');
    let g = await game(w);
    expect(g).toMatchObject({ whiteId: ANN, blackId: bot, moves: [] });
    expect((await move(g, 'e2e4')).status).toBe(200);
    await server.bots();
    g = await game(await war(w.id));
    expect(g.moves).toHaveLength(2);
    expect(engine.requests.at(-1)).toMatchObject({ moves: ['e2e4'], elo: LEVEL_PLAY[4]!.elo });
  });

  it('play their games to the end', async () => {
    const { bot, declare, game, move, war, view } = await atWar();
    const w = await declare();
    engine.script = SCHOLARS_MATE;
    try {
      for (const uci of SCHOLARS_MATE.filter((_, i) => i % 2 === 0)) {
        const g = await game(await war(w.id));
        expect((await move(g, uci)).status, uci).toBe(200);
        await server.bots();
      }
    } finally {
      engine.script = [];
    }
    const over = await war(w.id);
    expect(over).toMatchObject({ status: 'resolved', outcome: 'attacker' });
    expect((await view()).holdings.B5).toBe(ANN);
    expect(bot).toBeTruthy();
  });

  it('take a draw that holds the war, and turn one down when better', async () => {
    // Ann offers each draw on her own move, so the bot answers it rather than moving.
    const offer = async (s: Awaited<ReturnType<typeof atWar>>) => {
      const w = await s.declare();
      const g = await s.game(w);
      await s.move(g, 'e2e4');
      await server.bots();
      expect((await s.ann.post(`/api/games/${g.id}/draw`, { action: 'offer' })).status).toBe(200);
      await server.bots();
      return { w: await s.war(w.id), g: await s.game(await s.war(w.id)) };
    };
    const held = await offer(await atWar());
    expect(held.w).toMatchObject({ status: 'resolved', outcome: 'held' });

    // The engine says Ann, to move, stands worse: the bot plays on.
    engine.score = { cp: -250 };
    try {
      const refused = await offer(await atWar());
      expect(refused.w.status).toBe('playing');
      expect(refused.g).toMatchObject({ status: 'playing', drawOfferBy: null });
      expect(refused.g.moves).toHaveLength(2);
    } finally {
      engine.score = { cp: 0 };
    }
  });

  it('take peace terms worth more than fighting on', async () => {
    const { id, ann, bot, declare, war, view } = await atWar();
    const w = await declare();
    const offer = await ann.post(`/api/campaigns/${id}/wars/${w.id}/peace`, {
      terms: { ...WHITE_PEACE, toDefender: ['A4'] },
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    await server.bots();
    expect(await war(w.id)).toMatchObject({ status: 'resolved', outcome: 'settled' });
    expect((await view()).holdings.A4).toBe(bot);
  });

  it('answer accord proposals', async () => {
    const { id, ann, bot, view } = await atWar();
    const res = await ann.post<{ id: string }>(`/api/campaigns/${id}/accords`, { partnerId: bot, rounds: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await server.bots();
    const accord = (await view()).accords.find((a) => a.id === res.body.id);
    expect(accord?.status === 'active' || accord?.status === 'declined', accord?.status).toBe(true);
  });

  it('move first as White once the clocks start, and wait out a live countdown', async () => {
    const { id, bot, game } = await atWar({ war: { pace: 'live' } });
    const db = server.app.ctx.db;
    const warId = newId();
    const now = server.clock.now();
    await db.insert(wars).values({
      id: warId,
      campaignId: id,
      attackerId: bot,
      defenderId: ANN,
      targetId: 'A4',
      launchId: 'B5',
      stake: ['B5'],
      status: 'playing',
      declaredRound: 1,
      declaredAt: now,
    });
    const startsAt = new Date(now.getTime() + 15_000);
    const [row] = await db
      .insert(games)
      .values({
        id: newId(),
        warId,
        campaignId: id,
        whiteId: bot,
        blackId: ANN,
        timeControl: {
          kind: 'live',
          white: { initialMs: 300_000, incrementMs: 3_000 },
          black: { initialMs: 300_000, incrementMs: 3_000 },
        },
        fen: INITIAL_FEN,
        clocks: { white: 300_000, black: 300_000 },
        status: 'playing',
        startsAt,
        lastMoveAt: startsAt,
        deadline: new Date(startsAt.getTime() + 300_000),
      })
      .returning();
    const w = { games: [{ id: row!.id }] } as WarView;
    await server.runDue();
    expect((await game(w)).moves).toEqual([]);
    server.clock.advance(15_000);
    await server.runDue();
    expect((await game(w)).moves).toHaveLength(1);
  });

  it('play several live games at once, starting each as soon as the person in it is free', async () => {
    const { id, ann, bot } = await atWar({ war: { pace: 'live' } });
    await signIn(server.app, 'Bo');
    const BO = 'dev_bo';
    const db = server.app.ctx.db;
    await db.insert(members).values({ campaignId: id, userId: BO, color: 5 });
    const clock = { initialMs: 300_000, incrementMs: 3_000 };
    const at = server.clock.now();
    /** A war fought, or waiting to be fought, over a live game. */
    const fight = async (whiteId: string, blackId: string, playing: boolean) => {
      const warId = newId();
      await db.insert(wars).values({
        id: warId,
        campaignId: id,
        attackerId: whiteId,
        defenderId: blackId,
        targetId: 'B5',
        launchId: 'A4',
        stake: ['A4'],
        status: playing ? 'playing' : 'ready',
        declaredRound: 1,
        declaredAt: at,
      });
      const [game] = await db
        .insert(games)
        .values({
          id: newId(),
          warId,
          campaignId: id,
          whiteId,
          blackId,
          timeControl: { kind: 'live', white: clock, black: clock },
          fen: INITIAL_FEN,
          clocks: { white: clock.initialMs, black: clock.initialMs },
          status: playing ? 'playing' : 'waiting',
          ...(playing ? { startsAt: at, lastMoveAt: at, deadline: new Date(at.getTime() + clock.initialMs) } : {}),
        })
        .returning();
      return game!.id;
    };
    // Ann and Bo are at the board, so the bot's games with each of them wait.
    const theirs = await fight(ANN, BO, true);
    const queued = [await fight(bot, ANN, false), await fight(bot, BO, false)];
    expect((await ann.post(`/api/games/${theirs}/resign`)).status).toBe(200);
    await server.bots();
    for (const gameId of queued) {
      expect((await ann.get<GameView>(`/api/games/${gameId}`)).body.status).toBe('playing');
    }
  });

  it('are picked up by the sweep when nothing told them (after a restart)', async () => {
    const { id, bot } = await atWar();
    const db = server.app.ctx.db;
    await db
      .update(members)
      .set({ botRound: null })
      .where(and(eq(members.campaignId, id), eq(members.userId, bot)));
    await server.runDue();
    const [row] = await db
      .select({ botRound: members.botRound })
      .from(members)
      .where(and(eq(members.campaignId, id), eq(members.userId, bot)));
    expect(row?.botRound).toBe(1);
  });

  it('are never sent notices', async () => {
    await atWar().then((s) => s.declare());
    expect(server.notices.length).toBeGreaterThan(0);
    expect(server.notices.filter((n) => isBotId(n.userId))).toEqual([]);
  });
});

/** An active campaign on the war map between Ann, the host, and Bo, a person who may go quiet. */
async function withBo(rules: CampaignRulesInput = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Stand-in',
    rules: {
      victory: { mode: 'open' },
      ...rules,
      war: { ...ORIGINAL_STAKES, raise: 'off', redirect: 'nearby', ...rules.war },
    },
  });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  const db = server.app.ctx.db;
  await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
  await db.insert(holdings).values(
    [...A.map((t) => [t, ANN] as const), ...B.map((t) => [t, BO] as const)].map(([territoryId, ownerId]) => ({
      campaignId: id,
      territoryId,
      ownerId,
      acquiredRound: 0,
    })),
  );
  await db.update(members).set({ tokens: 1 }).where(eq(members.campaignId, id));
  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const standIn = (level: number, by = ann, userId = BO) =>
    by.put(`/api/campaigns/${id}/players/${userId}/stand-in`, { level });
  const takeBack = (by = bo) => by.del(`/api/campaigns/${id}/players/${BO}/stand-in`);
  const declare = async () => {
    const res = await ann.post<{ id: string }>(`/api/campaigns/${id}/wars`, {
      targetId: 'B5',
      launchId: 'A4',
      stake: ['A4'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await server.bots();
    return (await view()).wars.find((w) => w.id === res.body.id)!;
  };
  return { ann, bo, id, view, standIn, takeBack, declare };
}

const BO = 'dev_bo';

describe('bots standing in for players', () => {
  it('are put in by the host, for another person, from the draft on', async () => {
    const { ann, bo, id, view, standIn } = await withBo();
    expect((await standIn(4, bo, ANN)).status).toBe(403);
    expect((await standIn(4, ann, ANN)).body).toMatchObject({ error: { code: 'own-empire' } });
    expect((await standIn(9)).status).toBe(400);
    expect((await standIn(4)).status).toBe(200);
    expect((await standIn(4)).body).toMatchObject({ error: { code: 'stood-in' } });
    const v = await view();
    expect(v.members.find((m) => m.userId === BO)?.bot).toEqual({ level: 4, standIn: true });
    // Found by type: the bot may already have acted (titles give it a war worth declaring).
    const began = v.events.find((e) => e.type === 'standin.began');
    expect(began).toMatchObject({ actorId: ANN, payload: { userId: BO, level: 4 } });
    await tick();
    const told = server.notices.find((n) => n.title === 'A bot is playing your empire');
    expect(told).toMatchObject({ userId: BO, url: `/c/${id}` });

    const lobby = await ann.post<{ id: string }>('/api/campaigns', { name: 'Not yet' });
    const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${lobby.body.id}`)).body;
    await bo.post(`/api/invites/${inviteCode}/join`);
    const early = await ann.put(`/api/campaigns/${lobby.body.id}/players/${BO}/stand-in`, { level: 3 });
    expect(early.body).toMatchObject({ error: { code: 'not-started' } });
  });

  it('play the empire as the bot’s own, while the player can only read and talk', async () => {
    const { ann, bo, id, standIn, declare } = await withBo();
    expect((await standIn(4)).status).toBe(200);
    await tick();
    const told = server.notices.length;
    const war = await declare();
    expect(war.status).toBe('playing');
    const game = (await ann.get<GameView>(`/api/games/${war.games.at(-1)!.id}`)).body;
    expect((await ann.post(`/api/games/${game.id}/move`, { uci: 'e2e4', ply: 0 })).status).toBe(200);
    await server.bots();
    expect((await ann.get<GameView>(`/api/games/${game.id}`)).body.moves).toHaveLength(2);
    // The bot deals with what notices would have asked of Bo.
    await tick();
    expect(server.notices.slice(told).filter((n) => n.userId === BO)).toEqual([]);

    const refused = { error: { code: 'stood-in' } };
    expect((await bo.post(`/api/games/${game.id}/move`, { uci: 'e7e5', ply: 2 })).body).toMatchObject(refused);
    expect((await bo.post(`/api/campaigns/${id}/accords`, { partnerId: ANN, rounds: 2 })).body).toMatchObject(refused);
    expect((await bo.post(`/api/campaigns/${id}/fortify`, { territoryId: 'B7' })).body).toMatchObject(refused);
    expect((await bo.post(`/api/campaigns/${id}/messages`, { body: 'Back soon.' })).status).toBe(201);
  });

  it('hand the empire back when the player takes it, or the host returns it', async () => {
    const { ann, bo, view, standIn, takeBack, declare } = await withBo();
    expect((await takeBack()).body).toMatchObject({ error: { code: 'not-stood-in' } });
    expect((await standIn(4)).status).toBe(200);
    expect((await takeBack(bo)).status).toBe(200);
    let v = await view();
    expect(v.members.find((m) => m.userId === BO)?.bot).toBeNull();
    expect(v.events.at(-1)).toMatchObject({ type: 'standin.ended', actorId: BO, payload: { userId: BO } });
    // Bo answers for himself again.
    expect((await declare()).status).toBe('declared');

    expect((await standIn(3)).status).toBe(200);
    expect((await takeBack(ann)).status).toBe(200);
    await tick();
    expect(server.notices.at(-1)).toMatchObject({ userId: BO, title: 'Your empire is yours again' });
    v = await view(bo);
    expect(v.members.find((m) => m.userId === BO)?.bot).toBeNull();
  });

  it('pick for the player in the draft', async () => {
    const ann = await signIn(server.app, 'Ann');
    const bo = await signIn(server.app, 'Bo');
    const { body } = await ann.post<{ id: string }>('/api/campaigns', {
      name: 'Draft stand-in',
      rules: { victory: { mode: 'open' } },
    });
    const id = body.id;
    const view = async () => (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
    await bo.post(`/api/invites/${(await view()).inviteCode}/join`);
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    let v = await view();
    if (v.draft?.currentPicker === ANN) {
      const free = warDataset().territories.find((t) => !v.holdings[t.id])!;
      expect((await ann.post(`/api/campaigns/${id}/draft/pick`, { territoryId: free.id })).status).toBe(200);
      v = await view();
    }
    expect(v.draft?.currentPicker).toBe(BO);
    expect((await ann.put(`/api/campaigns/${id}/players/${BO}/stand-in`, { level: 3 })).status).toBe(200);
    v = await view();
    expect(v.draft?.currentPicker).not.toBe(BO);
    expect(Object.values(v.holdings)).toContain(BO);
  });
});
