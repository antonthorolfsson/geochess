/**
 * The response window and the finish line. A claim first achieved in round R can't score before
 * round R+2 starts, nor before every rival has had their turns to answer it: declaring has run to
 * its end in a round after R (`rules.victory.hold` of `turns`), or, in campaigns that hold by
 * time, the minimum holding time has passed since round R+1 started. It never scores while a war
 * could still break it. Mission points never go away (titles move with the lead); the first to reach
 * the target wins, and players who cross it together are ranked by their totals (equal totals share
 * it).
 */
import type { CampaignRules } from '../config';
import type { TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import type { DatasetIndex } from '../graph';
import { missionRules, type SeasonTiebreak } from './catalog';
import { durationText } from './text';
import { statOfSet, valueOfSet } from './world';

/** The first round a claim started in round `startedRound` can score in. */
export const claimEligibleRound = (startedRound: number) => startedRound + 2;

/**
 * Whether claims are held through a round's turns rather than for a time: where the host chose it
 * and players declare in turns. Without turns there's no end of declaring to wait for, so the time
 * applies.
 */
export const holdsByTurns = (rules: CampaignRules): boolean => rules.victory.hold === 'turns' && rules.war.turns;

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
 * Whether every rival has had their turns since a claim started in `startedRound`: declaring has
 * run to its end in a later round (`turnsEndedRound`, the last round whose declaring did; null if
 * none has). A host who starts a round before its declaring is over doesn't cut this short: the
 * claim waits for a round whose declaring finishes.
 */
export const claimTurnsHeld = (startedRound: number, turnsEndedRound: number | null): boolean =>
  turnsEndedRound !== null && turnsEndedRound > startedRound;

/**
 * Whether a claim held by turns has waited long enough: the round after next has started and
 * declaring has run to its end in a round after the claim's.
 */
export function claimTurnsServed(startedRound: number, round: number, turnsEndedRound: number | null): boolean {
  return round >= claimEligibleRound(startedRound) && claimTurnsHeld(startedRound, turnsEndedRound);
}

/** An empire's measures for the season's tiebreak, in the order they count (see `seasonMeasures`). */
export type SeasonMeasures = readonly number[];

/**
 * What an empire is measured by when players are level on points at the end of the season, in
 * order: its game value, or (`realWorld`) its population, then its land area, then its nominal
 * GDP. Unknown figures count as zero.
 */
export function seasonMeasures(
  idx: DatasetIndex,
  held: Iterable<TerritoryId>,
  tiebreak: SeasonTiebreak,
): SeasonMeasures {
  // In a fixed order, so the same empire always sums to the same figures.
  const ids = [...held].sort();
  if (tiebreak === 'value') return [valueOfSet(idx, ids)];
  return [statOfSet(idx, ids, 'population'), statOfSet(idx, ids, 'areaKm2'), statOfSet(idx, ids, 'gdpNominalUsd')];
}

export interface SeasonStanding {
  points: number;
  measures: SeasonMeasures;
}

/** Orders standings for the end of the season: most points first, then the tiebreak's measures. */
export function compareSeason(a: SeasonStanding, b: SeasonStanding): number {
  if (a.points !== b.points) return b.points - a.points;
  for (let i = 0; i < Math.max(a.measures.length, b.measures.length); i++) {
    const d = (b.measures[i] ?? 0) - (a.measures[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Which of the tiebreak's measures separated two standings level on points: its index in
 * `seasonMeasures`, or null when the points differ or they're level on every measure too.
 */
export function seasonDecider(a: SeasonStanding, b: SeasonStanding): number | null {
  if (a.points !== b.points) return null;
  for (let i = 0; i < Math.max(a.measures.length, b.measures.length); i++) {
    if ((a.measures[i] ?? 0) !== (b.measures[i] ?? 0)) return i;
  }
  return null;
}

/**
 * Who wins when the season's last round ends and nobody has reached the points to win: the most
 * points, then the campaign's tiebreak (`seasonMeasures`); players level on all of it share the
 * victory. Sorted by id.
 */
export function seasonWinners(standings: ReadonlyMap<UserId, SeasonStanding>): UserId[] {
  let best: SeasonStanding | null = null;
  for (const s of standings.values()) if (!best || compareSeason(s, best) < 0) best = s;
  if (!best) return [];
  const top = best;
  return [...standings]
    .filter(([, s]) => compareSeason(s, top) === 0)
    .map(([userId]) => userId)
    .sort();
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
