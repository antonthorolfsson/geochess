/**
 * Moving from one round to the next. The host starts each round or, where the host chose it for a
 * correspondence campaign, a schedule does once the round's time is up (`rules.rounds`). Either way
 * the next round starts the same: tokens refill, truces, locks and accords count down, and turns to
 * declare start again from the top of a new order. Wars underway carry on into it with their own
 * deadlines and clocks, and their countries stay locked. Players still to declare lose the rest of
 * their turns for the round, and keep their unused tokens. Claims keep their protections (see
 * `victory/claims.ts`): one held through a round's turns waits for a round whose declaring runs to
 * its end, one held for a time for its time. After the season's last round the campaign ends on
 * points instead: wars still underway are called off, and claims not yet scored don't count.
 *
 * `roundReadiness` sums up what a round is waiting for, telling what its end would cut short (the
 * blockers) from the wars that carry into the next round.
 */
import { DEFAULT_ROUND_HOURS, type CampaignRules, type RoundProgression, type RoundRules } from './config';
import type { UserId } from './draft';
import { turnsToCome, type TurnState } from './turns';
import type { ClaimHold } from './victory/catalog';
import { waitingOn, type WarCounter } from './war';

/**
 * The campaign's round settings. Rules parsed by `parseRules` always have them; rules a client
 * gets from a server older than 2026-10-08 don't, and read as rounds the host starts.
 */
export function roundRules(rules: CampaignRules): RoundRules {
  const rounds = rules.rounds as Partial<RoundRules> | undefined;
  return { progression: rounds?.progression ?? 'manual', hours: rounds?.hours ?? DEFAULT_ROUND_HOURS };
}

/** How the campaign's rounds move on: on a schedule only in a correspondence campaign. */
export const roundProgression = (rules: CampaignRules): RoundProgression =>
  roundRules(rules).progression === 'scheduled' && rules.war.pace === 'correspondence' ? 'scheduled' : 'manual';

/** How long a scheduled round lasts, in milliseconds. */
export const roundMs = (rules: CampaignRules): number => roundRules(rules).hours * 3_600_000;

/** Why the campaign's round settings can't be used, if they can't: a schedule is for correspondence. */
export function roundsIssue(rules: CampaignRules): string | null {
  if (roundRules(rules).progression !== 'scheduled' || rules.war.pace === 'correspondence') return null;
  return 'Rounds run on a schedule only in correspondence campaigns: in a live one, the host starts each round.';
}

/** An unresolved war, as the round's readiness reads it: a `WarView` will do. */
export interface ReadinessWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  status: string;
  counter: WarCounter | null;
  /** When whoever must answer it next runs out of time. */
  respondBy: string | null;
}

/** A claim waiting to score: a `ClaimView` will do. */
export interface ReadinessClaim {
  id: number;
  userId: UserId;
  startedRound: number;
  eligibleRound: number;
  /** When its holding time is up (claims held for a time), once the round after the claim's has started. */
  eligibleAt: string | null;
  /** Whether declaring has run to its end in a round after the claim's (claims held through turns). */
  turnsHeld: boolean;
  /** Unresolved wars that could still break it. */
  blockedBy: readonly string[];
}

/**
 * What the round's end, were it now, would mean for a claim waiting to score:
 * - `scores`: the next round is the one it waits for, with its turns (or time) served and no war in
 *   the way: it scores as that round starts, if the position still holds.
 * - `delayed`: it waits for this round's turns to run their course; a round that ends first makes
 *   it wait for the next round's.
 * - `waits`: the next round is a step on its way, and it needs more after (a later round, its
 *   holding time, a war to end).
 * - `last-chance`: the last round, and the claim's round has come: it can still score before the
 *   campaign ends, once what it waits for comes, but not after.
 * - `too-late`: the last round, and the claim can't score before the campaign ends.
 */
export type ClaimAtRoundEnd = 'scores' | 'delayed' | 'waits' | 'last-chance' | 'too-late';

/** Where a round stands, for what its end means to claims. */
export interface RoundMoment {
  round: number;
  /** The campaign's last round: its end ends the campaign. */
  final: boolean;
  /** How claims are held (`VictoryView.hold`). */
  hold: ClaimHold;
  /** Players are still taking turns to declare this round. */
  declaring: boolean;
  now: number;
  /** When the round ends by itself, on a schedule; null where the host ends it, or while paused. */
  endsAt: number | null;
}

export function claimAtRoundEnd(claim: ReadinessClaim, at: RoundMoment): ClaimAtRoundEnd {
  const eligibleAt = claim.eligibleAt === null ? null : Date.parse(claim.eligibleAt);
  if (at.final) {
    if (at.round < claim.eligibleRound) return 'too-late';
    // A holding time that runs out after the scheduled end can't be served in time.
    return at.hold === 'time' && at.endsAt !== null && eligibleAt !== null && eligibleAt > at.endsAt
      ? 'too-late'
      : 'last-chance';
  }
  const comes = at.round + 1 >= claim.eligibleRound;
  const clear = claim.blockedBy.length === 0;
  if (at.hold === 'turns') {
    if (!claim.turnsHeld && at.round > claim.startedRound && at.declaring) return 'delayed';
    return comes && claim.turnsHeld && clear ? 'scores' : 'waits';
  }
  return comes && eligibleAt !== null && at.now >= eligibleAt && clear ? 'scores' : 'waits';
}

export interface RoundReadinessInput {
  round: number;
  lastRound: number | null;
  /** Declaring in turns this round; null where players declare whenever they like. */
  turns: TurnState | null;
  /** Whether a player has anything to do with a turn, as things stand (`canTakeTurn`). */
  canAct: (userId: UserId) => boolean;
  /** The campaign's wars; resolved ones are passed over. */
  wars: readonly ReadinessWar[];
  /** Claims waiting to score (none outside an Objectives campaign). */
  claims: readonly ReadinessClaim[];
  hold: ClaimHold;
  now: number;
  /** When the round ends by itself, on a schedule; null where the host ends it, or while paused. */
  endsAt: number | null;
}

/** What a round is waiting for, and what its end would do, were it now. */
export interface RoundReadiness {
  /** The campaign's last round: its end ends the campaign, on points. */
  final: boolean;
  /**
   * Players still to take their turns to declare this round, whose turn it is first: the round's
   * end cuts them short (they lose the rest of their turns, and keep their unused tokens). Empty
   * once declaring is over, and where players declare whenever they like.
   */
  turnsLeft: UserId[];
  /** Declarations and counter-offers waiting for an answer, the soonest first. */
  answers: { warId: string; userId: UserId; respondBy: string | null }[];
  /** Wars being fought: their game underway, or (`queued`, live) waiting until its players are free. */
  battles: { warId: string; queued: boolean }[];
  /** Claims waiting to score, and what the round's end would mean for each. */
  claims: { claimId: number; userId: UserId; atRoundEnd: ClaimAtRoundEnd }[];
  /**
   * Whether the round could end now with nothing cut short: nobody is still to declare and, in the
   * last round, no war is unfinished (the campaign's end calls it off) and no claim could still
   * score. Outside the last round, wars never hold a round up: they carry into the next.
   */
  ready: boolean;
}

export function roundReadiness(input: RoundReadinessInput): RoundReadiness {
  const final = input.lastRound !== null && input.round >= input.lastRound;
  const turnsLeft = input.turns ? turnsToCome(input.turns, input.canAct) : [];
  const open = input.wars.filter((w) => w.status !== 'resolved');
  const answers = open
    .flatMap((w) => {
      const userId = waitingOn(w);
      return userId ? [{ warId: w.id, userId, respondBy: w.respondBy }] : [];
    })
    .sort((a, b) => due(a.respondBy) - due(b.respondBy));
  const battles = open
    .filter((w) => w.status === 'playing' || w.status === 'ready')
    .map((w) => ({ warId: w.id, queued: w.status === 'ready' }));
  const moment: RoundMoment = {
    round: input.round,
    final,
    hold: input.hold,
    declaring: turnsLeft.length > 0,
    now: input.now,
    endsAt: input.endsAt,
  };
  const claims = input.claims.map((c) => ({ claimId: c.id, userId: c.userId, atRoundEnd: claimAtRoundEnd(c, moment) }));
  const ready =
    turnsLeft.length === 0 &&
    (!final || (answers.length === 0 && battles.length === 0 && !claims.some((c) => c.atRoundEnd === 'last-chance')));
  return { final, turnsLeft, answers, battles, claims, ready };
}

const due = (respondBy: string | null) => (respondBy ? Date.parse(respondBy) : Infinity);
