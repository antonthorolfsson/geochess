import type { CampaignView, GameView, LichessRatings } from '@empire/rules';
import { warDataset } from '@empire/rules/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, holdings, members, users } from '../src/db/schema';
import { ORIGINAL_ANSWERS, listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

/**
 * Rating handicaps: ratings from Lichess, a bot's level or the player's own word, frozen when the
 * draft starts, and the time odds they give a war's game.
 */
let server: TestServer;
/** What the fake Lichess answers, by username; missing: Lichess can't be reached. */
const lichess = new Map<string, LichessRatings>();
const lookups: string[] = [];
beforeAll(async () => {
  server = await startTestServer(
    warDataset(),
    {},
    {
      lichess: {
        ratings: async (username) => {
          lookups.push(username);
          return lichess.get(username) ?? null;
        },
      },
    },
  );
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  lichess.clear();
  lookups.length = 0;
});

const HOUR = 3_600_000;
const blitz = (rating: number): LichessRatings => ({ blitz: { rating, games: 100, prov: false } });

/** Gives a dev player a Lichess account with these ratings, read `ageMs` ago. */
async function linkLichess(userId: string, username: string, ratings: LichessRatings, ageMs = 0) {
  await server.app.ctx.db
    .update(users)
    .set({
      lichessUsername: username,
      lichessRatings: ratings,
      lichessRatingsAt: new Date(server.clock.now().getTime() - ageMs),
    })
    .where(eq(users.id, userId));
}

async function lobby(war: Record<string, unknown> = {}) {
  const ann = await signIn(server.app, 'Ann');
  const bo = await signIn(server.app, 'Bo');
  const { body } = await ann.post<{ id: string }>('/api/campaigns', {
    name: 'Handicaps',
    rules: { victory: { mode: 'open' }, war: { pace: 'live', liveClock: '5+3', handicap: 'full', ...war } },
  });
  const id = body.id;
  const { inviteCode } = (await ann.get<CampaignView>(`/api/campaigns/${id}`)).body;
  await bo.post(`/api/invites/${inviteCode}/join`);
  const view = async (c: Client = ann) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
  const rating = async (userId: string) => (await view()).members.find((m) => m.userId === userId)!.rating;
  return { id, ann, bo, view, rating };
}

describe('ratings in the lobby', () => {
  it('come from Lichess, and from the player where the host allows it', async () => {
    const { id, bo, rating } = await lobby();
    await linkLichess('dev_ann', 'annl', { ...blitz(1850), rapid: { rating: 1500, games: 2, prov: true } });
    expect(await rating('dev_ann')).toEqual({ rating: 1850, source: 'lichess', perf: 'blitz' });
    expect((await bo.patch(`/api/campaigns/${id}/me`, { rating: 1400 })).status).toBe(200);
    // Without the host's say-so, Bo's own rating doesn't count.
    expect(await rating('dev_bo')).toBeNull();
    const ann = await signIn(server.app, 'Ann');
    await ann.patch(`/api/campaigns/${id}`, { rules: { war: { selfRatings: true } } });
    expect(await rating('dev_bo')).toEqual({ rating: 1400, source: 'self' });
    expect((await bo.patch(`/api/campaigns/${id}/me`, { rating: 99 })).status).toBe(400);
  });

  it("are a bot level's rating for a bot", async () => {
    const { id, ann, view } = await lobby();
    const { body } = await ann.post<{ userId: string }>(`/api/campaigns/${id}/bots`, { level: 4 });
    expect((await view()).members.find((m) => m.userId === body.userId)?.rating).toEqual({
      rating: 1650,
      source: 'bot',
    });
  });

  it('are hidden while handicaps are off', async () => {
    const { rating } = await lobby({ handicap: 'off' });
    await linkLichess('dev_ann', 'annl', blitz(1850));
    expect(await rating('dev_ann')).toBeNull();
  });

  it('are read again from Lichess on the player asking, at most every ten minutes', async () => {
    const { id, ann, bo, rating } = await lobby();
    await linkLichess('dev_ann', 'annl', blitz(1850), 2 * HOUR);
    lichess.set('annl', blitz(1900));
    const socket = await listen(server.app, bo);
    expect((await ann.post(`/api/campaigns/${id}/rating/refresh`)).body).toEqual({ refreshed: true });
    expect(await rating('dev_ann')).toEqual({ rating: 1900, source: 'lichess', perf: 'blitz' });
    await tick();
    expect(socket.messages).toContainEqual({ type: 'campaign.changed', campaignId: id });
    socket.close();
    lichess.set('annl', blitz(2000));
    expect((await ann.post(`/api/campaigns/${id}/rating/refresh`)).body).toEqual({ refreshed: false });
    expect(lookups).toEqual(['annl']);
    // Players without Lichess have nothing to read.
    expect((await bo.post(`/api/campaigns/${id}/rating/refresh`)).body).toEqual({ refreshed: false });
  });
});

describe('the draft', () => {
  it('freezes the ratings, reading stale Lichess ones first', async () => {
    const { id, ann, bo, rating } = await lobby({ selfRatings: true });
    await linkLichess('dev_ann', 'annl', blitz(1850), 2 * HOUR);
    lichess.set('annl', blitz(1910));
    await bo.patch(`/api/campaigns/${id}/me`, { rating: 1400 });
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect(lookups).toEqual(['annl']);
    expect(await rating('dev_ann')).toEqual({ rating: 1910, source: 'lichess', perf: 'blitz' });
    expect(await rating('dev_bo')).toEqual({ rating: 1400, source: 'self' });

    // Frozen: later Lichess ratings and claims change nothing.
    await linkLichess('dev_ann', 'annl', blitz(2400));
    expect(await rating('dev_ann')).toMatchObject({ rating: 1910 });
    expect((await bo.patch(`/api/campaigns/${id}/me`, { rating: 1200 })).body).toMatchObject({
      error: { code: 'not-in-lobby' },
    });
  });

  it('keeps old Lichess ratings when Lichess cannot be reached', async () => {
    const { id, ann, rating } = await lobby();
    await linkLichess('dev_ann', 'annl', blitz(1850), 2 * HOUR);
    await ann.post(`/api/campaigns/${id}/draft/start`);
    expect(await rating('dev_ann')).toMatchObject({ rating: 1850 });
  });
});

describe('a handicapped war', () => {
  /** An active campaign on the war map, Ann against Bo, with frozen ratings. */
  async function war(handicap: 'off' | 'light' | 'full', ratings: Record<string, number | null>, pace = 'live') {
    const { id, ann, bo, view } = await lobby({ ...ORIGINAL_ANSWERS, pace, handicap, clockModifiers: false });
    const db = server.app.ctx.db;
    await db.update(campaigns).set({ status: 'active', round: 1 }).where(eq(campaigns.id, id));
    await db.insert(holdings).values([
      { campaignId: id, territoryId: 'A4', ownerId: 'dev_ann', acquiredRound: 0 },
      { campaignId: id, territoryId: 'B5', ownerId: 'dev_bo', acquiredRound: 0 },
    ]);
    await db.update(members).set({ tokens: 1 }).where(eq(members.campaignId, id));
    for (const [userId, r] of Object.entries(ratings)) {
      await db
        .update(members)
        .set({ rating: r === null ? null : { rating: r, source: 'self' } })
        .where(and(eq(members.campaignId, id), eq(members.userId, userId)));
    }
    const declared = await ann.post<{ id: string }>(`/api/campaigns/${id}/wars`, {
      targetId: 'B5',
      launchId: 'A4',
      stake: ['A4'],
    });
    await bo.post(`/api/campaigns/${id}/wars/${declared.body.id}/respond`, { response: 'accept' });
    const w = (await view()).wars.find((x) => x.id === declared.body.id)!;
    return (await ann.get<GameView>(`/api/games/${w.games[0]!.id}`)).body;
  }

  it('gives the weaker player time from the stronger one in live games', async () => {
    // Ann attacks as White and is 250 points weaker: 40% of the time moves to her.
    const g = await war('full', { dev_ann: 1500, dev_bo: 1750 });
    expect(g.timeControl).toEqual({
      kind: 'live',
      white: { initialMs: 420_000, incrementMs: 4200 },
      black: { initialMs: 180_000, incrementMs: 1800 },
    });
  });

  it('only adds time in correspondence games', async () => {
    // A 400-point gap is past light's 30% cap; Ann, the stronger, keeps her day a move.
    const g = await war('light', { dev_ann: 1900, dev_bo: 1500 }, 'correspondence');
    expect(g.timeControl).toEqual({
      kind: 'correspondence',
      white: { perMoveMs: 24 * HOUR },
      black: { perMoveMs: Math.round(24 * HOUR * 1.3) },
    });
  });

  it('needs both players rated', async () => {
    const g = await war('full', { dev_ann: 1500, dev_bo: null });
    expect(g.timeControl).toMatchObject({ white: { initialMs: 300_000 }, black: { initialMs: 300_000 } });
  });
});
