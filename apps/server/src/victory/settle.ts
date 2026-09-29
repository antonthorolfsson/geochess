import {
  claimBlockers,
  claimEligibleRound,
  claimTimeServed,
  durationText,
  evaluateMission,
  holdMs,
  missionInfo,
  missionName,
  missionRequirement,
  missionRules,
  victoryWinners,
} from '@empire/rules';
import { and, eq, inArray } from 'drizzle-orm';
import type { MutationScope } from '../campaigns/mutate';
import { loadBoard } from '../wars/board';
import { settleFinishedGames } from '../wars/service';
import type { AppContext } from '../context';
import { missionAwards, missionClaims, missionPlayers, users } from '../db/schema';
import type { Notice } from '../notifications/notifier';
import { finishCampaign } from './finish';
import {
  loadAwards,
  loadOpenWars,
  loadPendingClaims,
  loadPlayers,
  loadWorld,
  missionsFor,
  pointsOf,
  type ClaimRow,
  type MissionPlayerRow,
  type MissionSlot,
} from './state';

export const missionsUrl = (campaignId: string) => `/c/${campaignId}?missions=1`;

export async function memberNames(scope: MutationScope): Promise<Map<string, string>> {
  const ids = scope.members.map((m) => m.userId);
  if (ids.length === 0) return new Map();
  const rows = await scope.tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Sends a notice once the change has committed; retried or rolled-back changes send nothing. Only
 * `ending` notices go out from a change that ends the campaign.
 */
export function notifyAfter(_ctx: AppContext, scope: MutationScope, notice: Notice, opts?: { ending?: boolean }): void {
  scope.notify(notice, opts);
}

/** Marks a secret mission public, for good, with a dispatch carrying its exact requirements. */
export async function revealSecret(
  ctx: AppContext,
  scope: MutationScope,
  player: MissionPlayerRow,
  reason: 'near' | 'claim' | 'final',
  names: ReadonlyMap<string, string>,
  { notify = true }: { notify?: boolean } = {},
): Promise<void> {
  if (!player.secret || player.revealedAt) return;
  const { tx, campaign } = scope;
  const now = ctx.now();
  await tx
    .update(missionPlayers)
    .set({ revealedAt: now, revealedRound: campaign.round, revealReason: reason })
    .where(and(eq(missionPlayers.campaignId, campaign.id), eq(missionPlayers.userId, player.userId)));
  player.revealedAt = now;
  player.revealedRound = campaign.round;
  player.revealReason = reason;
  await scope.log.add(
    { type: 'mission.revealed', payload: { userId: player.userId, mission: player.secret, reason } },
    null,
    campaign.round,
  );
  if (!notify) return;
  const idx = ctx.datasets.get(campaign.datasetVersion);
  const name = names.get(player.userId) ?? 'A rival';
  const mission = missionName(player.secret);
  for (const m of scope.members) {
    const own = m.userId === player.userId;
    notifyAfter(ctx, scope, {
      userId: m.userId,
      title: own ? 'Your secret mission is revealed' : `${name}’s secret mission: ${mission}`,
      body: own
        ? `Everyone can now see ${mission}. Hold on: it still has to be completed and held.`
        : missionRequirement(player.secret, idx, {
            players: scope.members.length,
            playerName: (userId) => names.get(userId) ?? 'a rival',
          }),
      url: missionsUrl(campaign.id),
      tag: `mission:${campaign.id}:${player.userId}`,
    });
  }
}

interface Award {
  userId: string;
  mission: MissionSlot;
  claim: ClaimRow | null;
}

/**
 * Brings every player's missions up to date after a change to the campaign: reveals secret missions
 * that came within one step, starts, carries or interrupts claims, and awards points for claims
 * that have served the response window with no war left that could break them, and for historic
 * missions the moment they're complete. All the awards of one change go in together; then, if
 * anyone has reached the points to win, the campaign ends.
 *
 * Runs inside every campaign mutation (see `mutate()`), and the scheduler triggers one when a
 * claim's holding time runs out.
 */
export async function settleVictory(ctx: AppContext, scope: MutationScope): Promise<void> {
  const { tx } = scope;
  if (scope.campaign.status !== 'active' || scope.campaign.rules.victory.mode !== 'objectives') return;
  // A game that ended just before this change counts first, as if its own change had come first.
  await settleFinishedGames(ctx, scope);
  const campaign = scope.campaign;
  const players = await loadPlayers(tx, campaign.id);
  // Missions start with the baselines taken when the draft finished.
  if (players.length === 0) return;
  const memberIds = scope.members.map((m) => m.userId);
  const world = await loadWorld(ctx, tx, campaign, memberIds, players);
  const awards = await loadAwards(tx, campaign.id);
  const pending = new Map((await loadPendingClaims(tx, campaign.id)).map((c) => [`${c.userId}\n${c.missionKey}`, c]));
  const openWars = await loadOpenWars(tx, campaign.id);
  const board = openWars.length > 0 ? await loadBoard(ctx, tx, campaign) : null;
  const scored = new Set(awards.map((a) => `${a.userId}\n${a.missionKey}`));
  const names = await memberNames(scope);
  const idx = world.idx;
  const now = ctx.now();
  const round = campaign.round;
  const hold = holdMs(campaign.rules);
  const due: Award[] = [];

  for (const player of players) {
    const { userId } = player;
    const name = names.get(userId) ?? 'A rival';
    for (const mission of missionsFor(campaign.rules, player)) {
      const key = `${userId}\n${mission.key}`;
      if (scored.has(key)) continue;
      const ev = evaluateMission(world, userId, mission.spec);
      // A secret mission is revealed one step from completion, or when it's completed in one go
      // (a defensive win can take several countries at once): before any claim or points.
      if (mission.scope === 'secret' && !player.revealedAt && ev.near) {
        await revealSecret(ctx, scope, player, ev.complete ? 'claim' : 'near', names);
      }
      if (missionInfo(mission.spec.kind).timing === 'historic') {
        if (ev.complete) due.push({ userId, mission, claim: null });
        continue;
      }

      let claim = pending.get(key) ?? null;
      if (!ev.complete) {
        if (claim) {
          await tx
            .update(missionClaims)
            .set({ status: 'interrupted', endedRound: round, endedAt: now })
            .where(eq(missionClaims.id, claim.id));
          const payload = { claimId: claim.id, userId, missionKey: mission.key, kind: mission.spec.kind };
          await scope.log.add({ type: 'claim.interrupted', payload }, null, round);
          notifyAfter(ctx, scope, {
            userId,
            title: `Claim lost: ${missionName(mission.spec)}`,
            body: 'The position was broken before it scored. Complete it again to start a new claim.',
            url: missionsUrl(campaign.id),
            tag: `claim:${claim.id}`,
          });
        }
        continue;
      }

      if (!claim) {
        const [row] = await tx
          .insert(missionClaims)
          .values({
            campaignId: campaign.id,
            userId,
            missionKey: mission.key,
            status: 'pending',
            startedRound: round,
            startedAt: now,
            eligibleRound: claimEligibleRound(round),
          })
          .returning();
        claim = row!;
        const payload = {
          claimId: claim.id,
          userId,
          missionKey: mission.key,
          kind: mission.spec.kind,
          eligibleRound: claim.eligibleRound,
        };
        await scope.log.add({ type: 'claim.started', payload }, null, round);
        for (const m of scope.members) {
          const own = m.userId === userId;
          notifyAfter(ctx, scope, {
            userId: m.userId,
            title: own ? `Claim started: ${missionName(mission.spec)}` : `${name} claims ${missionName(mission.spec)}`,
            body: own
              ? `Hold it until round ${claim.eligibleRound} starts, and for ${durationText(hold)} after round ${round + 1} starts.`
              : `It can score ${mission.points} points in round ${claim.eligibleRound} at the earliest, if the position still holds then. ${missionRequirement(mission.spec, idx, { players: memberIds.length, playerName: (id) => names.get(id) ?? 'a rival' })}`,
            url: missionsUrl(campaign.id),
            tag: `claim:${claim.id}`,
          });
        }
      }

      const set: Partial<ClaimRow> = {};
      // The holding time runs from the start of the round after the claim's.
      if (!claim.eligibleAt && round > claim.startedRound) {
        set.eligibleAt = new Date((campaign.roundStartedAt ?? now).getTime() + hold);
      }
      const eligibleAt = set.eligibleAt ?? claim.eligibleAt;
      const served = claimTimeServed(
        { startedRound: claim.startedRound, eligibleAt: eligibleAt?.getTime() ?? null },
        round,
        now.getTime(),
      );
      if (eligibleAt && now >= eligibleAt && !claim.timeReached) set.timeReached = true;
      const blockers = board ? claimBlockers(world, board, userId, mission.spec, openWars) : [];
      if (blockers.join(',') !== claim.blockedBy.join(',')) set.blockedBy = blockers;
      if (Object.keys(set).length > 0) {
        await tx.update(missionClaims).set(set).where(eq(missionClaims.id, claim.id));
        claim = { ...claim, ...set };
      }
      if (served && blockers.length === 0) due.push({ userId, mission, claim });
    }
  }
  if (due.length === 0) return;

  // Every award of this change first, then the finish line.
  const cfg = missionRules(campaign.rules.victory.version);
  const points = pointsOf(awards, memberIds);
  const awarded: Award[] = [];
  for (const a of due) {
    const inserted = await tx
      .insert(missionAwards)
      .values({
        campaignId: campaign.id,
        userId: a.userId,
        missionKey: a.mission.key,
        kind: a.mission.spec.kind,
        points: a.mission.points,
        round,
        awardedAt: now,
        claimId: a.claim?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: missionAwards.id });
    if (inserted.length === 0) continue;
    awarded.push(a);
    points.set(a.userId, (points.get(a.userId) ?? 0) + a.mission.points);
    if (a.claim) {
      await tx
        .update(missionClaims)
        .set({ status: 'awarded', endedRound: round, endedAt: now, blockedBy: [] })
        .where(eq(missionClaims.id, a.claim.id));
    }
    const total = points.get(a.userId)!;
    await scope.log.add(
      {
        type: 'mission.awarded',
        payload: {
          userId: a.userId,
          missionKey: a.mission.key,
          kind: a.mission.spec.kind,
          points: a.mission.points,
          total,
        },
      },
      null,
      round,
    );
    notifyAfter(ctx, scope, {
      userId: a.userId,
      title: `+${a.mission.points} victory points`,
      body: `${missionName(a.mission.spec)} scored. You have ${total} of ${cfg.points.toWin}.`,
      url: missionsUrl(campaign.id),
      tag: `award:${campaign.id}:${a.mission.key}`,
    });
  }
  if (awarded.length === 0) return;
  const winners = victoryWinners(points, cfg.points.toWin);
  if (winners.length > 0) await finishCampaign(ctx, scope, { players, world, points, winners, names });
}
