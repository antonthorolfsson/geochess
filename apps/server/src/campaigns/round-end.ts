/**
 * A scheduled round ends at its scheduled time, whenever the server gets to it (the scheduler
 * polls, and a restart can leave it behind): what fell due before the end is dealt with in that
 * round, and what falls due after it belongs to the next one, or, after the last round, doesn't
 * happen at all.
 */
import { lastRoundOf, roundProgression } from '@empire/rules';
import { conflict } from '../lib/errors';
import type { CampaignRow } from './mutate';

type Row = Pick<CampaignRow, 'status' | 'round' | 'rules' | 'nextRoundAt' | 'roundPausedAt'>;

/**
 * When a scheduled round's time ran out, if it has and the server hasn't moved the campaign on
 * yet; null for rounds the host starts, a paused schedule, and a round whose time isn't up.
 * `rules` must be parsed.
 */
export function roundEndDue(c: Row, now: Date): Date | null {
  if (c.status !== 'active' || c.roundPausedAt || !c.nextRoundAt || c.nextRoundAt > now) return null;
  return roundProgression(c.rules) === 'scheduled' ? c.nextRoundAt : null;
}

/** When a scheduled last round's time ran out, if it has and the campaign hasn't ended yet. */
export function seasonEndDue(c: Row, now: Date): Date | null {
  const last = lastRoundOf(c.rules);
  return last !== null && c.round >= last ? roundEndDue(c, now) : null;
}

/**
 * Refuses a change once a scheduled last round's time is up, until the scheduler has ended the
 * campaign as of that time: whatever comes after the end mustn't count. A change that deals with
 * what fell due by `upTo`, at or before the end, still goes through.
 */
export function requireSeasonOn(c: Row, now: Date, upTo?: Date): void {
  const end = seasonEndDue(c, now);
  if (end && !(upTo && upTo <= end)) {
    throw conflict('The last round is over, and the campaign is ending.', 'season-over');
  }
}
