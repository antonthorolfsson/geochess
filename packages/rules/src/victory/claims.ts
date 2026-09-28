/**
 * The response window and the finish line. A claim first achieved in round R can't score before
 * round R+2 starts, nor before the minimum holding time has passed since round R+1 started, and
 * never while a war could still break it. Points never go away; the first to reach the target
 * wins, and players who cross it together are ranked by their totals (equal totals share it).
 */
import type { CampaignRules } from '../config';
import type { UserId } from '../draft';
import { missionRules } from './catalog';
import { durationText } from './text';

/** The first round a claim started in round `startedRound` can score in. */
export const claimEligibleRound = (startedRound: number) => startedRound + 2;

/** The least time a claim is held after the round after it starts, in milliseconds. */
export function holdMs(rules: CampaignRules): number {
  const v = rules.victory;
  return (v.holdMinutes ?? missionRules(v.version).holdMinutes[rules.war.pace]) * 60_000;
}

/**
 * Why a campaign's holding time can't be used, if it can't: the pace's default is also the least
 * (10 minutes live, 24 hours by correspondence), since the host could otherwise start rounds fast
 * enough to cut the response window short.
 */
export function holdTimeIssue(rules: CampaignRules): string | null {
  const v = rules.victory;
  const least = missionRules(v.version).holdMinutes[rules.war.pace];
  if (v.holdMinutes === null || v.holdMinutes >= least) return null;
  const pace = rules.war.pace === 'live' ? 'live campaigns' : 'correspondence campaigns';
  return `Claims have to be held at least ${durationText(least * 60_000)} in ${pace}.`;
}

/** How long players have to choose their secret missions once the draft ends, in milliseconds. */
export function selectionMs(rules: CampaignRules): number {
  const v = rules.victory;
  return (v.selectionMinutes ?? missionRules(v.version).selectionMinutes[rules.war.pace]) * 60_000;
}

export interface ClaimTiming {
  startedRound: number;
  /** When the minimum holding time is up; unknown (null) until the next round starts. */
  eligibleAt: number | null;
}

/** Whether a claim has waited long enough: the round after next has started and the time is up. */
export function claimTimeServed(claim: ClaimTiming, round: number, now: number): boolean {
  return round >= claimEligibleRound(claim.startedRound) && claim.eligibleAt !== null && now >= claim.eligibleAt;
}

/**
 * Who wins, given everyone's points after a batch of awards: the highest total among those who
 * reached `toWin`, every player with that total sharing the win. Empty if nobody reached it.
 * Sorted by id only so the result is stable; order never decides a tie.
 */
export function victoryWinners(points: ReadonlyMap<UserId, number>, toWin: number): UserId[] {
  let best = -Infinity;
  for (const p of points.values()) if (p >= toWin && p > best) best = p;
  if (best === -Infinity) return [];
  return [...points]
    .filter(([, p]) => p === best)
    .map(([userId]) => userId)
    .sort();
}
