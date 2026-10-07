import {
  claimTurnsHeld,
  holdMs,
  holdsByTurns,
  lastRoundOf,
  missionRules,
  SECRET_MISSION_KEY,
  evaluateMission,
  titleTotals,
  titlesHeldBy,
  type AwardView,
  type ClaimView,
  type Evaluation,
  type MissionSpec,
  type MissionView,
  type MySecretView,
  type VictoryView,
} from '@empire/rules';
import { eq } from 'drizzle-orm';
import type { CampaignRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { campaignResults } from '../db/schema';
import {
  loadAwards,
  loadDeclarations,
  loadOpenWars,
  loadPendingClaims,
  loadPlayers,
  loadWorld,
  pointsOf,
  publicSlots,
  secretSlot,
  type AwardRow,
  type ClaimRow,
} from './state';

export function toAwardView(row: AwardRow): AwardView {
  return {
    userId: row.userId,
    missionKey: row.missionKey,
    kind: row.kind as MissionSpec['kind'],
    points: row.points,
    round: row.round,
    awardedAt: row.awardedAt.toISOString(),
  };
}

export function toClaimView(row: ClaimRow, campaign: Pick<CampaignRow, 'turnsEndedRound'>): ClaimView {
  return {
    id: row.id,
    userId: row.userId,
    missionKey: row.missionKey,
    status: row.status,
    startedRound: row.startedRound,
    startedAt: row.startedAt.toISOString(),
    eligibleRound: row.eligibleRound,
    eligibleAt: row.eligibleAt?.toISOString() ?? null,
    turnsHeld: claimTurnsHeld(row.startedRound, campaign.turnsEndedRound),
    blockedBy: row.blockedBy,
  };
}

/**
 * The victory missions of a campaign as `viewerId` may see them. Public: the public missions and
 * everyone's progress on them, points, readiness, pending claims, revealed secret missions and the
 * final results. Private to the viewer: their own secret mission (or options) and its progress.
 * Another player's unrevealed secret mission contributes nothing: not its kind, targets or progress.
 */
export async function victoryViews(
  ctx: AppContext,
  db: Tx | Db,
  campaign: CampaignRow,
  memberIds: readonly string[],
  viewerId: string,
): Promise<{ victory: VictoryView | null; mySecret: MySecretView | null }> {
  if (campaign.rules.victory.mode !== 'objectives') return { victory: null, mySecret: null };
  const cfg = missionRules(campaign.rules.victory.version);
  const slots = publicSlots(campaign.rules);
  const publicMissions: MissionView[] = slots.map((s) => ({
    key: s.key,
    scope: 'public',
    points: s.points,
    spec: s.spec,
  }));
  const players = await loadPlayers(db, campaign.id);
  const awards = await loadAwards(db, campaign.id);
  const claims = await loadPendingClaims(db, campaign.id);
  const [result] = await db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaign.id));
  const atWar = campaign.status === 'active' || campaign.status === 'finished';
  const world = atWar && players.length > 0 ? await loadWorld(ctx, db, campaign, memberIds, players) : null;
  const points = pointsOf(awards, memberIds, campaign);
  const titleCfg = cfg.titles;
  const totals = world && titleCfg ? titleTotals(world.idx, world.owners, memberIds, titleCfg.kinds) : null;
  const byUser = new Map(players.map((p) => [p.userId, p]));
  // While the war is on, what previews of a war's endings need beyond the map: all of it public.
  const worldView =
    world && campaign.status === 'active'
      ? {
          baselines: Object.fromEntries(players.map((p) => [p.userId, p.baseline])),
          history: world.history,
          declared: await loadDeclarations(
            db,
            campaign.id,
            (await loadOpenWars(db, campaign.id)).map((w) => w.id),
          ),
        }
      : undefined;

  const victory: VictoryView = {
    version: cfg.version,
    pointsToWin: cfg.points.toWin,
    publicPoints: cfg.points.public,
    secretPoints: cfg.points.secret,
    hold: holdsByTurns(campaign.rules) ? 'turns' : 'time',
    holdMs: holdMs(campaign.rules),
    lastRound: lastRoundOf(campaign.rules),
    tiebreak: campaign.rules.victory.tiebreak,
    publicMissions,
    titles: (titleCfg?.kinds ?? []).map((kind) => ({
      kind,
      holderId: campaign.titles[kind] ?? null,
      totals: Object.fromEntries(totals?.get(kind) ?? []),
    })),
    titlePoints: titleCfg?.points ?? 0,
    players: memberIds.map((userId) => {
      const player = byUser.get(userId);
      const progress: Record<string, Evaluation> = {};
      if (world) for (const s of slots) progress[s.key] = evaluateMission(world, userId, s.spec);
      const secret = player?.revealedAt ? secretSlot(campaign.rules, player) : null;
      if (world && secret) progress[secret.key] = evaluateMission(world, userId, secret.spec);
      return {
        userId,
        points: points.get(userId) ?? 0,
        titles: titleCfg ? titlesHeldBy(campaign.titles, userId) : [],
        awards: awards.filter((a) => a.userId === userId).map(toAwardView),
        ready: player ? player.secret !== null || player.noSecret : false,
        secret:
          secret && player?.revealedAt
            ? {
                mission: { key: secret.key, scope: 'secret', points: secret.points, spec: secret.spec },
                revealedRound: player.revealedRound ?? 0,
                revealedAt: player.revealedAt.toISOString(),
                reason: player.revealReason ?? 'near',
              }
            : null,
        progress,
      };
    }),
    // A claim on an unrevealed secret mission can't exist: completing it reveals it first.
    claims: claims.map((c) => toClaimView(c, campaign)),
    selection:
      campaign.status === 'selection'
        ? {
            deadline: campaign.selectionDeadline?.toISOString() ?? null,
            unresolved: players.filter((p) => p.options.length === 0 && !p.secret && !p.noSecret).map((p) => p.userId),
          }
        : null,
    result: result?.snapshot ?? null,
    ...(worldView && { world: worldView }),
  };

  const mine = byUser.get(viewerId);
  const own = mine ? secretSlot(campaign.rules, mine) : null;
  const mySecret: MySecretView | null = mine
    ? {
        // Options are shown only until one is chosen; the rest are never disclosed.
        options:
          !mine.secret && !mine.noSecret && campaign.status === 'selection'
            ? mine.options.map((o) => ({ id: o.id, rank: o.rank, spec: o.spec, estimate: o.estimate }))
            : null,
        mission: own ? { key: SECRET_MISSION_KEY, scope: 'secret', points: own.points, spec: own.spec } : null,
        auto: mine.autoAssigned,
        none: mine.noSecret,
        revealed: mine.revealedAt !== null,
        progress: world && own ? evaluateMission(world, viewerId, own.spec) : null,
      }
    : null;
  return { victory, mySecret };
}
