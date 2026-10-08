/**
 * Rounds on a schedule, where the host chose it for a correspondence campaign (`roundProgression`):
 * each round lasts `rules.rounds.hours` from when it started, then the next starts by itself exactly
 * as when the host starts it (`moveOn`, run by `advanceScheduledRounds`); after the last round the
 * campaign ends on points. The time is a column on the campaign row (`next_round_at`), polled by the
 * scheduler like every other deadline, so a restart loses nothing. Each round's time runs from when
 * it actually started, so a server that was down past the ends of several rounds starts one round
 * when it's back, not one for each. The host can pause the schedule: the round then keeps the time
 * it had left until the host resumes it.
 */
import { durationText, lastRoundOf, roundMs, roundProgression, type NextRoundInput } from '@empire/rules';
import { eq } from 'drizzle-orm';
import { mutate, requireActive, requireHost, type CampaignRow, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns } from '../db/schema';
import { conflict } from '../lib/errors';

type ScheduleColumns = Pick<CampaignRow, 'nextRoundAt' | 'roundPausedAt'>;

async function saveSchedule(scope: MutationScope, set: ScheduleColumns): Promise<void> {
  await scope.tx.update(campaigns).set(set).where(eq(campaigns.id, scope.campaign.id));
  scope.campaign = { ...scope.campaign, ...set };
}

/** The time a paused round had left when the host paused it, which it keeps until they resume. */
export function pausedRemainingMs(campaign: CampaignRow): number {
  const { nextRoundAt, roundPausedAt } = campaign;
  if (!roundPausedAt) return 0;
  return nextRoundAt ? Math.max(0, nextRoundAt.getTime() - roundPausedAt.getTime()) : roundMs(campaign.rules);
}

/**
 * A round has started (round 1 too): where rounds run on a schedule, it ends `rules.rounds.hours`
 * from its start. A paused schedule stays paused, keeping the whole of the new round for when the
 * host resumes it. The last round's players are told when the campaign ends, since nobody will
 * press anything to end it.
 */
export async function scheduleRound(ctx: AppContext, scope: MutationScope): Promise<void> {
  const { campaign } = scope;
  if (roundProgression(campaign.rules) !== 'scheduled') {
    if (campaign.nextRoundAt !== null || campaign.roundPausedAt !== null) {
      await saveSchedule(scope, { nextRoundAt: null, roundPausedAt: null });
    }
    return;
  }
  const now = ctx.now();
  const length = roundMs(campaign.rules);
  const started = campaign.roundStartedAt ?? now;
  const paused = campaign.roundPausedAt !== null;
  await saveSchedule(scope, {
    nextRoundAt: new Date(started.getTime() + length),
    roundPausedAt: paused ? now : null,
  });
  if (campaign.round !== lastRoundOf(campaign.rules)) return;
  for (const m of scope.members) {
    scope.notify({
      userId: m.userId,
      title: `Round ${campaign.round}, the last`,
      body:
        `${campaign.name} ends on points when this round's ${durationText(length)} are up` +
        `${paused ? ', counted from when the host resumes the schedule' : ''}. ` +
        "Wars still underway then are called off, and claims that haven't scored don't count.",
      url: `/c/${campaign.id}`,
      tag: `round:${campaign.id}`,
    });
  }
}

/** Refuses where there's no schedule, or the round the host meant has given way to another. */
function requireSchedule(scope: MutationScope, input: NextRoundInput): void {
  if (roundProgression(scope.campaign.rules) !== 'scheduled') {
    throw conflict('The host starts each round in this campaign: there is no schedule.', 'no-schedule');
  }
  if (input.round !== undefined && input.round !== scope.campaign.round) {
    throw conflict(`Round ${scope.campaign.round} has already begun.`, 'round-moved-on');
  }
}

/**
 * The host pauses the round schedule: the round no longer ends by itself, and keeps the time it had
 * left. Everything else carries on: turns, answers and games keep their own deadlines and clocks.
 */
export async function pauseSchedule(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  input: NextRoundInput = {},
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'pause the round schedule');
    requireActive(scope);
    requireSchedule(scope, input);
    const c = scope.campaign;
    if (c.roundPausedAt) throw conflict('The schedule is already paused.', 'paused');
    const now = ctx.now();
    const ends = c.nextRoundAt ?? new Date((c.roundStartedAt ?? now).getTime() + roundMs(c.rules));
    const remainingMs = Math.max(0, ends.getTime() - now.getTime());
    await saveSchedule(scope, { nextRoundAt: new Date(now.getTime() + remainingMs), roundPausedAt: now });
    await scope.log.add({ type: 'schedule.paused', payload: { remainingMs } }, userId, c.round);
  });
}

/** The host resumes the round schedule: the round ends by itself once the time it had left has run. */
export async function resumeSchedule(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  input: NextRoundInput = {},
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'resume the round schedule');
    requireActive(scope);
    requireSchedule(scope, input);
    const c = scope.campaign;
    if (!c.roundPausedAt) throw conflict('The schedule is not paused.', 'not-paused');
    const nextRoundAt = new Date(ctx.now().getTime() + pausedRemainingMs(c));
    await saveSchedule(scope, { nextRoundAt, roundPausedAt: null });
    await scope.log.add(
      { type: 'schedule.resumed', payload: { nextRoundAt: nextRoundAt.toISOString() } },
      userId,
      c.round,
    );
  });
}
