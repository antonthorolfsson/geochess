/**
 * The balance simulator (`packages/sim`) reimplements this server's campaign orchestration in
 * memory. This replays campaigns it played, move for move, through the real server, and checks
 * both agree on everything the balance report depends on: which missions scored for whom and in
 * which round, reveals, the winners, and the map at the end.
 */
import { valueOfSet, type SecretOption, type WarView } from '@empire/rules';
import { loadDataset, runScenarioCampaign, scenarioConfig, type SimAction, type SimState } from '@empire/sim';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignResults, campaigns, holdings, missionAwards, missionPlayers, wars } from '../src/db/schema';
import { signIn, startTestServer, type Client, type TestServer } from './helpers';

const HOUR = 3_600_000;
const SCHOLARS_MATE = 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'.split(' ');
const FOOLS_MATE = 'f2f3 e7e5 g2g4 d8h4'.split(' ');
/** Knights out and back twice: the starting position a third time, a draw at once. */
const THREEFOLD = 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'.split(' ');

const idx = loadDataset();
let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(idx.dataset);
});
afterAll(async () => {
  await server.close();
});

/** Plays one simulated campaign again through the API, from the end of the draft. */
async function replay(s: SimState, label: string) {
  const names = s.players.map((p) => p.id.toUpperCase());
  const clients = await Promise.all(names.map((n) => signIn(server.app, `${label}${n}`)));
  const idOf = new Map(s.players.map((p) => [p.id, `dev_${label.toLowerCase()}${p.id}`]));
  const clientOf = new Map(s.players.map((p, i) => [idOf.get(p.id)!, clients[i]!]));
  const as = (simId: string) => clientOf.get(idOf.get(simId)!)!;
  const host = as(s.players[0]!.id);
  for (const [simId, id] of idOf) expect(clientOf.get(id), simId).toBeDefined();

  const created = await host.post<{ id: string }>('/api/campaigns', { name: label, rules: s.rules });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const campaignId = created.body.id;
  const { inviteCode } = (await host.get<{ inviteCode: string }>(`/api/campaigns/${campaignId}`)).body;
  for (const c of clients.slice(1)) expect((await c.post(`/api/invites/${inviteCode}/join`)).status).toBe(200);

  // The end of the draft, as the simulator had it: the map, the public missions, one option each.
  const db = server.app.ctx.db;
  await db.update(campaigns).set({ status: 'selection', round: 0, rules: s.rules }).where(eq(campaigns.id, campaignId));
  await db
    .insert(holdings)
    .values(
      s.players.flatMap((p) =>
        [...p.baseline].map((territoryId) => ({ campaignId, territoryId, ownerId: idOf.get(p.id)!, acquiredRound: 0 })),
      ),
    );
  for (const p of s.players) {
    const baseline = [...p.baseline].sort();
    // Nemesis names its rival by player id.
    const spec = p.secret?.kind === 'nemesis' ? { ...p.secret, rival: idOf.get(p.secret.rival)! } : p.secret;
    const option: SecretOption | null = spec
      ? { id: 'o1', rank: 1, spec, estimate: { conquests: 2, inTheWay: 0, targetValue: 0, rivals: 1 } }
      : null;
    await db.insert(missionPlayers).values({
      campaignId,
      userId: idOf.get(p.id)!,
      baseline,
      baselineValue: valueOfSet(idx, baseline),
      seed: 1,
      options: option ? [option] : [],
      noSecret: !option,
    });
  }

  const warIds = new Map<string, string>();
  const accordIds = new Map<string, string>();
  const warView = async (simWar: string) =>
    (await host.get<WarView>(`/api/campaigns/${campaignId}/wars/${warIds.get(simWar)}`)).body;
  const ok = (res: { status: number; body: unknown }, what: string) =>
    expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBeLessThan(300);

  const play = async (action: Extract<SimAction, { t: 'game' }>) => {
    const war = s.wars.find((w) => w.id === action.war)!;
    const view = await warView(action.war);
    const game = view.games.at(-1)!;
    const white = as(action.armageddon ? war.defenderId : war.attackerId);
    const black = as(action.armageddon ? war.attackerId : war.defenderId);
    const moves = async (list: string[]) => {
      for (const [ply, uci] of list.entries()) {
        ok(await (ply % 2 === 0 ? white : black).post(`/api/games/${game.id}/move`, { uci, ply }), `move ${uci}`);
      }
    };
    if (action.winner === null) return moves(THREEFOLD);
    if (action.reason === 'checkmate') return moves(action.winner === 'white' ? SCHOLARS_MATE : FOOLS_MATE);
    // Timeouts are played as resignations: only checkmates count differently, and moving the clock
    // on would flag every other game underway.
    ok(await (action.winner === 'white' ? black : white).post(`/api/games/${game.id}/resign`), 'resign');
  };

  for (const action of s.actions) {
    switch (action.t) {
      case 'open':
        for (const p of s.players)
          if (p.secret) ok(await as(p.id).post(`/api/campaigns/${campaignId}/secret`, { optionId: 'o1' }), 'choose');
        break;
      case 'round':
        server.clock.advance(25 * HOUR);
        ok(await host.post(`/api/campaigns/${campaignId}/round/next`), 'next round');
        break;
      case 'end':
        // After the last round, moving on ends the campaign.
        server.clock.advance(25 * HOUR);
        ok(await host.post(`/api/campaigns/${campaignId}/round/next`), 'end the season');
        break;
      case 'declare': {
        const res = await as(action.by).post<{ id: string }>(`/api/campaigns/${campaignId}/wars`, {
          targetId: action.targetId,
          launchId: action.launchId,
          stake: action.stake,
        });
        ok(res, `declare ${action.targetId}`);
        warIds.set(action.war, res.body.id);
        break;
      }
      case 'respond': {
        const war = s.wars.find((w) => w.id === action.war)!;
        const r = action.response;
        const body =
          r.kind === 'redirect'
            ? { response: 'redirect', targetId: r.targetId }
            : r.kind === 'tribute'
              ? { response: 'tribute', ...('territoryId' in r ? { territoryId: r.territoryId } : { tokens: r.tokens }) }
              : { response: r.kind };
        ok(
          await as(war.defenderId).post(`/api/campaigns/${campaignId}/wars/${warIds.get(action.war)}/respond`, body),
          'respond',
        );
        break;
      }
      case 'reply': {
        const war = s.wars.find((w) => w.id === action.war)!;
        const r = action.reply;
        const body =
          r.kind === 'accept' ? { reply: 'accept', ...(r.stake ? { stake: r.stake } : {}) } : { reply: r.kind };
        ok(
          await as(war.attackerId).post(`/api/campaigns/${campaignId}/wars/${warIds.get(action.war)}/reply`, body),
          'reply',
        );
        break;
      }
      case 'game':
        await play(action);
        break;
      case 'propose': {
        const res = await as(action.by).post<{ id: string }>(`/api/campaigns/${campaignId}/accords`, {
          partnerId: idOf.get(action.to),
          rounds: action.rounds,
        });
        ok(res, 'propose');
        accordIds.set(action.accord, res.body.id);
        break;
      }
      case 'answer': {
        const accord = s.accords.find((a) => a.id === action.accord)!;
        ok(
          await as(accord.recipientId).post(
            `/api/campaigns/${campaignId}/accords/${accordIds.get(action.accord)}/answer`,
            {
              answer: action.accept ? 'accept' : 'decline',
            },
          ),
          'answer',
        );
        break;
      }
      case 'renounce':
        ok(
          await as(action.by).post(`/api/campaigns/${campaignId}/accords/${accordIds.get(action.accord)}/renounce`),
          'renounce',
        );
        break;
    }
  }

  const simOf = new Map([...idOf].map(([sim, dev]) => [dev, sim]));
  const awards = await db.select().from(missionAwards).where(eq(missionAwards.campaignId, campaignId));
  const players = await db.select().from(missionPlayers).where(eq(missionPlayers.campaignId, campaignId));
  const map = await db.select().from(holdings).where(eq(holdings.campaignId, campaignId));
  const [result] = await db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaignId));
  const resolved = await db
    .select({ outcome: wars.outcome })
    .from(wars)
    .where(and(eq(wars.campaignId, campaignId), eq(wars.status, 'resolved')));
  return {
    awards: awards.map((a) => `${simOf.get(a.userId)}:${a.missionKey}:${a.kind}@${a.round}`).sort(),
    reveals: players
      .filter((p) => p.revealReason !== null && p.revealReason !== 'final')
      .map((p) => `${simOf.get(p.userId)}@${p.revealedRound}`)
      .sort(),
    winners: (result?.winnerIds ?? []).map((id) => simOf.get(id)).sort(),
    seasonEnd: result?.snapshot.seasonEnd ?? false,
    owners: Object.fromEntries(map.map((h) => [h.territoryId, simOf.get(h.ownerId)])),
    outcomes: resolved.map((w) => w.outcome).sort(),
  };
}

function expected(s: SimState) {
  return {
    awards: s.awards.map((a) => `${a.userId}:${a.missionKey}:${a.kind}@${a.round}`).sort(),
    reveals: s.players
      .filter((p) => p.revealedRound !== null)
      .map((p) => `${p.id}@${p.revealedRound}`)
      .sort(),
    winners: [...s.winners].sort(),
    seasonEnd: s.endedByLimit,
    owners: Object.fromEntries([...s.holdings].map(([id, h]) => [id, h.ownerId])),
    outcomes: s.wars
      .filter((w) => w.status === 'resolved')
      .map((w) => w.outcome)
      .sort(),
  };
}

// Correspondence rules, with every war fought out in the round it's declared (the server doesn't
// hold games back to later rounds), and short campaigns so the replay stays quick.
// `free` draws the public missions at random (and drafts freely), for missions the default set lacks.
// A short season ends some on points; mission rules version 2 still plays as it did.
const CASES: { scenario: string; players: number; seed: number; lastRound?: number; version?: number }[] = [
  { scenario: 'baseline', players: 2, seed: 5 },
  { scenario: 'baseline', players: 3, seed: 1 },
  { scenario: 'baseline', players: 4, seed: 2 },
  { scenario: 'baseline', players: 5, seed: 4 },
  { scenario: 'baseline', players: 6, seed: 6 },
  { scenario: 'free', players: 3, seed: 3 },
  { scenario: 'free', players: 4, seed: 7 },
  { scenario: 'free', players: 5, seed: 8 },
  { scenario: 'baseline', players: 3, seed: 9, lastRound: 4 },
  { scenario: 'free', players: 4, seed: 10, lastRound: 5 },
  { scenario: 'baseline', players: 4, seed: 2, version: 2 },
];

describe('the simulator replayed through the server', () => {
  it.each(CASES)(
    'agrees on scores, reveals, winners and the map ($scenario, $players players, seed $seed)',
    async ({ scenario, players, seed, lastRound, version }) => {
      const cfg = scenarioConfig(scenario, {
        players,
        pace: 'correspondence',
        latency: [1],
        roundCap: 10,
        debug: true,
        lastRound: lastRound ?? null,
        ...(version !== undefined && { missionVersion: version }),
      });
      const s = runScenarioCampaign(cfg, seed, idx);
      if (lastRound !== undefined) expect(s.endedByLimit, 'the season should end on points').toBe(true);
      const got = await replay(s, `${scenario[0]}${seed}${version ? `v${version}` : ''}`);
      expect(got).toEqual(expected(s));
    },
  );
});
