import {
  durationText,
  missionName,
  missionRequirement,
  secretOptions,
  seededRandom,
  selectionMs,
  valueOfSet,
  type DatasetIndex,
  type TerritoryId,
} from '@empire/rules';
import { and, eq, lte } from 'drizzle-orm';
import { openCampaign } from '../campaigns/lifecycle';
import { mutate, requireHost, requireMember, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns, holdings, members, missionPlayers } from '../db/schema';
import { startRoundForAccords } from '../diplomacy/accords';
import { badRequest, conflict, notFound } from '../lib/errors';
import { memberNames, missionsUrl, notifyAfter } from './settle';
import { loadHistory, loadPlayers, type MissionPlayerRow } from './state';

/**
 * The draft is over in an Objectives campaign. Every player's holdings are recorded as their
 * baseline, and each is dealt up to three secret options, privately, from a seed drawn and kept
 * server-side (so a refresh or restart can never reroll them, and nothing public reconstructs
 * them). Round 1 waits until everyone has chosen or the time runs out.
 */
export async function beginSelection(ctx: AppContext, scope: MutationScope, idx: DatasetIndex): Promise<void> {
  const { tx, campaign } = scope;
  const rows = await tx
    .select({ territoryId: holdings.territoryId, ownerId: holdings.ownerId })
    .from(holdings)
    .where(eq(holdings.campaignId, campaign.id));
  const owners = new Map(rows.map((r) => [r.territoryId, r.ownerId]));
  const players = scope.members.map((m) => m.userId).sort();
  const baseline = new Map<string, Set<TerritoryId>>(players.map((p) => [p, new Set()]));
  for (const [id, owner] of owners) baseline.get(owner)?.add(id);
  // Accords can be signed (and broken) during the draft, so the history counts already.
  const world = { idx, players, owners, baseline, history: await loadHistory(tx, campaign.id) };
  const now = ctx.now();
  const deadline = new Date(now.getTime() + selectionMs(campaign.rules));

  for (const userId of players) {
    const seed = Math.floor(ctx.random() * 2 ** 31);
    const held = [...baseline.get(userId)!].sort();
    await tx.insert(missionPlayers).values({
      campaignId: campaign.id,
      userId,
      baseline: held,
      baselineValue: valueOfSet(idx, held),
      seed,
      options: secretOptions(world, userId, campaign.rules, seededRandom(seed)),
    });
  }
  await tx
    .update(campaigns)
    .set({ status: 'selection', selectionDeadline: deadline })
    .where(eq(campaigns.id, campaign.id));
  await tx.update(members).set({ draftList: [] }).where(eq(members.campaignId, campaign.id));
  scope.campaign = { ...campaign, status: 'selection', selectionDeadline: deadline };
  await scope.log.add({ type: 'missions.dealt', payload: { deadline: deadline.toISOString() } }, null, 0);

  const window = durationText(deadline.getTime() - now.getTime());
  for (const userId of players) {
    notifyAfter(ctx, scope, {
      userId,
      title: 'Choose your secret mission',
      body: `The draft is over. Pick one of your secret missions within ${window}, or the best fit is chosen for you.`,
      url: missionsUrl(campaign.id),
      tag: `secret:${campaign.id}`,
      email: true,
    });
  }
}

const ready = (p: MissionPlayerRow) => p.secret !== null || p.noSecret;

/** Everyone has a secret mission (or the host went on without one for them): round 1 begins. */
async function startWarIfReady(ctx: AppContext, scope: MutationScope): Promise<boolean> {
  const players = await loadPlayers(scope.tx, scope.campaign.id);
  if (!players.every(ready)) return false;
  await openCampaign(ctx, scope);
  await scope.log.add({ type: 'round.started', payload: { round: 1 } }, null, 1);
  await startRoundForAccords(ctx, scope);
  return true;
}

function requireSelecting(scope: MutationScope): void {
  if (scope.campaign.status !== 'selection') {
    throw conflict('Secret missions are chosen between the draft and round 1.', 'not-selecting');
  }
}

/**
 * A player chooses one of their secret options, for good. Everyone sees that they're ready, never
 * what they chose; the last choice starts round 1.
 */
export async function chooseSecret(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  optionId: string,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    requireSelecting(scope);
    const [row] = await scope.tx
      .select()
      .from(missionPlayers)
      .where(and(eq(missionPlayers.campaignId, campaignId), eq(missionPlayers.userId, userId)));
    if (!row) throw notFound('You have no secret missions to choose from.');
    if (row.secret) throw conflict('You have already chosen your secret mission.', 'already-chosen');
    const option = row.options.find((o) => o.id === optionId);
    if (!option) throw badRequest('That is not one of your options.', 'unknown-option');
    await scope.tx
      .update(missionPlayers)
      .set({ secretId: option.id, secret: option.spec, selectedAt: ctx.now() })
      .where(and(eq(missionPlayers.campaignId, campaignId), eq(missionPlayers.userId, userId)));
    await startWarIfReady(ctx, scope);
  });
}

/**
 * Nothing fitted some players' empires. Rather than play on silently without their secret
 * missions, the host decides to go on without them (they can still win with public missions).
 */
export async function proceedWithoutSecrets(ctx: AppContext, campaignId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'go on without secret missions');
    requireSelecting(scope);
    const players = await loadPlayers(scope.tx, campaignId);
    const stuck = players.filter((p) => !ready(p) && p.options.length === 0);
    if (stuck.length === 0) throw conflict('Every player has secret missions to choose from.', 'nothing-to-skip');
    for (const p of stuck) {
      await scope.tx
        .update(missionPlayers)
        .set({ noSecret: true })
        .where(and(eq(missionPlayers.campaignId, campaignId), eq(missionPlayers.userId, p.userId)));
    }
    await startWarIfReady(ctx, scope);
  });
}

/**
 * Time's up for choosing: players who haven't chosen get their best-fit option, and are told
 * privately which. If some players had nothing to choose from, the campaign waits for the host.
 */
export async function expireSelections(ctx: AppContext): Promise<void> {
  const due = await ctx.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'selection'), lte(campaigns.selectionDeadline, ctx.now())));
  for (const { id } of due) {
    try {
      await mutate(ctx, id, async (scope) => {
        const deadline = scope.campaign.selectionDeadline;
        if (scope.campaign.status !== 'selection' || !deadline || deadline > ctx.now()) {
          scope.notifyOnly([]);
          return;
        }
        const idx = ctx.datasets.get(scope.campaign.datasetVersion);
        const names = await memberNames(scope);
        const playerName = (userId: string) => names.get(userId) ?? 'a rival';
        for (const p of await loadPlayers(scope.tx, id)) {
          const best = [...p.options].sort((a, b) => a.rank - b.rank)[0];
          if (ready(p) || !best) continue;
          await scope.tx
            .update(missionPlayers)
            .set({ secretId: best.id, secret: best.spec, selectedAt: ctx.now(), autoAssigned: true })
            .where(and(eq(missionPlayers.campaignId, id), eq(missionPlayers.userId, p.userId)));
          notifyAfter(ctx, scope, {
            userId: p.userId,
            title: `Your secret mission: ${missionName(best.spec)}`,
            body: `Time ran out, so your best fit was chosen. ${missionRequirement(best.spec, idx, { players: scope.members.length, playerName })}`,
            url: missionsUrl(id),
            tag: `secret:${id}`,
          });
        }
        await scope.tx.update(campaigns).set({ selectionDeadline: null }).where(eq(campaigns.id, id));
        scope.campaign = { ...scope.campaign, selectionDeadline: null };
        if (!(await startWarIfReady(ctx, scope))) {
          notifyAfter(ctx, scope, {
            userId: scope.campaign.hostId,
            title: 'A player has no secret mission',
            body: 'No secret mission fits every empire. Decide whether to go on without one.',
            url: missionsUrl(id),
            tag: `secret:${id}`,
          });
        }
      });
    } catch (err) {
      ctx.log.error({ err, campaignId: id }, 'could not assign secret missions');
    }
  }
}
