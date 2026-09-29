import {
  SECRET_MISSION_KEY,
  heldBy,
  missionRules,
  seasonWinners,
  valueOfSet,
  type MissionWorld,
  type VictoryResultView,
} from '@empire/rules';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import {
  accords,
  campaignResults,
  campaigns,
  games,
  holdings,
  members,
  missionClaims,
  peaceOffers,
  wars,
} from '../db/schema';
import { publishGame } from '../wars/games';
import { settleFinishedGames } from '../wars/service';
import { memberNames, missionsUrl, notifyAfter, revealSecret, settleVictory } from './settle';
import { loadAwards, loadPlayers, loadWorld, pointsOf, type MissionPlayerRow } from './state';
import { toAwardView } from './views';

export interface Finish {
  players: MissionPlayerRow[];
  world: MissionWorld;
  /** Everyone's points after the awards that ended it. */
  points: ReadonlyMap<string, number>;
  winners: string[];
  /** Nobody reached the points to win: the last round is over and the most points won. */
  seasonEnd?: boolean;
}

/**
 * The host moves on from the season's last round: the campaign ends instead of starting another.
 * Missions are brought up to date first, in case something done at the last moment (a game just
 * ended, a claim's time just up) scores, which could still take someone to the points to win. Then
 * the most points win, then the most valuable empire; players level on both share it.
 */
export async function endSeason(ctx: AppContext, scope: MutationScope): Promise<void> {
  const mark = { campaign: scope.campaign, events: scope.log.events.length };
  try {
    // A savepoint, as for every change (see `mutate()`): a fault in scoring still lets the season end.
    await scope.tx.transaction(() => settleVictory(ctx, scope));
  } catch (err) {
    scope.campaign = mark.campaign;
    scope.log.events.length = mark.events;
    ctx.log.error({ err, campaignId: scope.campaign.id }, 'could not bring the victory missions up to date');
  }
  if (scope.campaign.status !== 'active') return;
  const { tx, campaign } = scope;
  const memberIds = scope.members.map((m) => m.userId);
  const players = await loadPlayers(tx, campaign.id);
  const world = await loadWorld(ctx, tx, campaign, memberIds, players);
  const points = pointsOf(await loadAwards(tx, campaign.id), memberIds);
  const standings = new Map(
    memberIds.map((id) => [
      id,
      { points: points.get(id) ?? 0, value: valueOfSet(world.idx, heldBy(world.owners, id)) },
    ]),
  );
  await finishCampaign(ctx, scope, { players, world, points, winners: seasonWinners(standings), seasonEnd: true });
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Someone reached the points to win: the campaign ends, read-only from here on. Every secret
 * mission is revealed; unfinished wars are cancelled (nothing changes hands, and they count as
 * neither won nor lost) and their games stopped, moves kept; tokens held back as tribute, or paid
 * for a counter the attacker hadn't answered, go back; pending claims, accord proposals and peace
 * offers lapse. The results are written once: a second call is a no-op.
 */
export async function finishCampaign(
  ctx: AppContext,
  scope: MutationScope,
  finish: Finish & { names?: ReadonlyMap<string, string> },
): Promise<void> {
  const { tx } = scope;
  const campaign = scope.campaign;
  const now = ctx.now();
  const round = campaign.round;
  const seasonEnd = finish.seasonEnd ?? false;
  const placeholder: VictoryResultView = {
    winners: finish.winners,
    round,
    finishedAt: now.toISOString(),
    seasonEnd,
    standings: [],
    holdings: {},
  };
  const written = await tx
    .insert(campaignResults)
    .values({ campaignId: campaign.id, winnerIds: finish.winners, round, finishedAt: now, snapshot: placeholder })
    .onConflictDoNothing()
    .returning({ campaignId: campaignResults.campaignId });
  if (written.length === 0) return;
  const names = finish.names ?? (await memberNames(scope));

  for (const player of finish.players) await revealSecret(ctx, scope, player, 'final', names, { notify: false });
  await cancelUnfinishedWars(ctx, scope);
  await tx
    .update(missionClaims)
    .set({ status: 'cancelled', endedRound: round, endedAt: now })
    .where(and(eq(missionClaims.campaignId, campaign.id), eq(missionClaims.status, 'pending')));
  await tx
    .update(accords)
    .set({ status: 'lapsed', respondBy: null, endedRound: round, endedAt: now })
    .where(and(eq(accords.campaignId, campaign.id), eq(accords.status, 'proposed')));

  const cfg = missionRules(campaign.rules.victory.version);
  const awards = (await loadAwards(tx, campaign.id)).map(toAwardView);
  const idx = finish.world.idx;
  // The map as the campaign ends, including a war just settled above.
  const owners = new Map(
    (
      await tx
        .select({ territoryId: holdings.territoryId, ownerId: holdings.ownerId })
        .from(holdings)
        .where(eq(holdings.campaignId, campaign.id))
    ).map((h) => [h.territoryId, h.ownerId]),
  );
  const standings = scope.members
    .map(({ userId }) => {
      const held = [...owners].filter(([, owner]) => owner === userId).map(([id]) => id);
      const player = finish.players.find((p) => p.userId === userId);
      const secret = player?.secret
        ? {
            mission: {
              key: SECRET_MISSION_KEY,
              scope: 'secret' as const,
              points: cfg.points.secret,
              spec: player.secret,
            },
            completed: awards.some((a) => a.userId === userId && a.missionKey === SECRET_MISSION_KEY),
          }
        : null;
      return {
        userId,
        points: finish.points.get(userId) ?? 0,
        value: valueOfSet(idx, held),
        countries: held.length,
        awards: awards.filter((a) => a.userId === userId),
        secret,
      };
    })
    .sort((a, b) => b.points - a.points || b.value - a.value || (a.userId < b.userId ? -1 : 1));
  const snapshot: VictoryResultView = {
    winners: finish.winners,
    round,
    finishedAt: now.toISOString(),
    seasonEnd,
    standings,
    holdings: Object.fromEntries(owners),
  };
  await tx.update(campaignResults).set({ snapshot }).where(eq(campaignResults.campaignId, campaign.id));
  await tx.update(campaigns).set({ status: 'finished', finishedAt: now }).where(eq(campaigns.id, campaign.id));
  scope.campaign = { ...campaign, status: 'finished', finishedAt: now };
  await scope.log.add(
    {
      type: 'campaign.won',
      payload: { winners: finish.winners, points: Object.fromEntries(finish.points), ...(seasonEnd && { seasonEnd }) },
    },
    null,
    round,
  );

  const winnerNames = listNames(finish.winners.map((id) => names.get(id) ?? 'A player'));
  const shared = finish.winners.length > 1;
  // The only notices this change sends: whatever else it started or scored, the ending supersedes.
  for (const m of scope.members) {
    const won = finish.winners.includes(m.userId);
    notifyAfter(
      ctx,
      scope,
      {
        userId: m.userId,
        title: won
          ? shared
            ? 'You share the victory'
            : 'Victory'
          : `${winnerNames} ${shared ? 'share the victory' : 'won'}`,
        body: seasonEnd
          ? `${campaign.name} is over: round ${round} was its last, and the most points won. Every secret mission is now revealed.`
          : `${campaign.name} is over after round ${round}. Every secret mission is now revealed.`,
        url: missionsUrl(campaign.id),
        tag: `victory:${campaign.id}`,
      },
      { ending: true },
    );
  }
}

/**
 * Cancels every war still underway: a distinct outcome, with nothing changing hands. Games stop
 * first, which waits for any move still being saved: a war whose game ended in that moment is
 * settled by its result instead, as it would have been a moment later.
 */
async function cancelUnfinishedWars(ctx: AppContext, scope: MutationScope): Promise<void> {
  const { tx, campaign } = scope;
  const now = ctx.now();
  const round = campaign.round;
  const stopGames = () =>
    tx
      .update(games)
      .set({ status: 'cancelled', deadline: null, drawOfferBy: null })
      .where(and(eq(games.campaignId, campaign.id), inArray(games.status, ['waiting', 'playing'])))
      .returning();
  const stopped = await stopGames();
  await settleFinishedGames(ctx, scope);
  // Settling can set up an Armageddon game, which stops too.
  stopped.push(...(await stopGames()));
  scope.afterCommit(async () => {
    for (const game of stopped) {
      ctx.timers.clear(`flag:${game.id}`);
      await publishGame(ctx, game);
    }
  });

  const open = await tx
    .select()
    .from(wars)
    .where(and(eq(wars.campaignId, campaign.id), ne(wars.status, 'resolved')));
  for (const war of open) {
    // Tokens offered as tribute were held back from the defender until the attacker answered, and
    // a raise or redirect paid for goes unanswered: either way they go back.
    const held = war.status === 'countered' ? (war.counter?.tokens ?? 0) : 0;
    if (held > 0) {
      await tx
        .update(members)
        .set({ tokens: sql`${members.tokens} + ${held}` })
        .where(and(eq(members.campaignId, campaign.id), eq(members.userId, war.defenderId)));
    }
    await tx
      .update(wars)
      .set({ status: 'resolved', outcome: 'cancelled', resolvedRound: round, resolvedAt: now, respondBy: null })
      .where(eq(wars.id, war.id));
    await scope.log.add(
      { type: 'war.resolved', payload: { warId: war.id, outcome: 'cancelled', transfers: [] } },
      null,
      round,
    );
  }
  await tx
    .update(peaceOffers)
    .set({ status: 'lapsed', respondBy: null, endedAt: now })
    .where(and(eq(peaceOffers.campaignId, campaign.id), eq(peaceOffers.status, 'proposed')));
}
