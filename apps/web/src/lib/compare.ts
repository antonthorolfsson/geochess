import type { ChessProfile, DatasetIndex, StatKey, TerritoryId, WarRecord } from '@empire/rules';
import { totalOf } from './empire';

/** What the comparison page measures empires by: game value, countries, or a real-world figure. */
export type Measure = 'value' | 'countries' | StatKey;

/** An empire's amount of a measure: null when none of its countries has the figure. */
export function amountOf(idx: DatasetIndex, ids: readonly TerritoryId[], measure: Measure): number | null {
  if (measure === 'countries') return ids.length;
  if (measure === 'value') return ids.reduce((sum, id) => sum + (idx.byId.get(id)?.value ?? 0), 0);
  return totalOf(idx, ids, measure);
}

/** The whole map's amount of a measure: every country's, claimed or not. */
export function worldAmount(idx: DatasetIndex, measure: Measure): number {
  return amountOf(idx, idx.ids, measure) ?? 0;
}

/** One empire's part of a measure. */
export interface SharePart {
  userId: string;
  amount: number | null;
  /** Of the world's total, from 0 to 1. */
  share: number;
}

/** A measure split between the empires, with the rest of the world unclaimed. */
export interface ShareRow {
  measure: Measure;
  /** In the order the empires were given. */
  parts: SharePart[];
  world: number;
  /** The share no empire holds. */
  unclaimed: number;
}

export function shareRow(
  idx: DatasetIndex,
  holdingsByUser: ReadonlyMap<string, readonly TerritoryId[]>,
  userIds: readonly string[],
  measure: Measure,
): ShareRow {
  const world = worldAmount(idx, measure);
  const parts = userIds.map((userId) => {
    const amount = amountOf(idx, holdingsByUser.get(userId) ?? [], measure);
    return { userId, amount, share: world > 0 && amount !== null ? amount / world : 0 };
  });
  const claimed = parts.reduce((sum, p) => sum + p.share, 0);
  return { measure, parts, world, unclaimed: Math.max(0, 1 - claimed) };
}

/** Won, drawn and lost, and anything else that ended (or will end) neither way. */
export interface Results {
  won: number;
  drawn: number;
  lost: number;
}

export const resultsPlayed = (r: Results) => r.won + r.drawn + r.lost;

/** A score from 0 to 1, a draw counting half, or null with nothing played. */
export function score(r: Results): number | null {
  const played = resultsPlayed(r);
  return played === 0 ? null : (r.won + r.drawn / 2) / played;
}

/** Wars won, drawn and lost, attacking and defending together. */
export function warResults(record: WarRecord): Results & {
  /** Settled by tribute or peace terms, withdrawn, one side backing down, or cut short by the campaign's end. */
  other: number;
  underway: number;
} {
  const { attacking: a, defending: d } = record;
  return {
    won: a.won + d.won,
    drawn: a.drawn + d.drawn,
    lost: a.lost + d.lost,
    other:
      a.tribute +
      d.tribute +
      a.settled +
      d.settled +
      a.withdrawn +
      d.withdrawn +
      a.opponentBackedDown +
      d.opponentBackedDown +
      a.backedDown +
      d.backedDown +
      a.cancelled +
      d.cancelled,
    underway: a.underway + d.underway,
  };
}

/** Finished games won, drawn and lost, with either colour. */
export function chessResults(profile: ChessProfile): Results {
  return {
    won: profile.asWhite.won + profile.asBlack.won,
    drawn: profile.asWhite.drawn + profile.asBlack.drawn,
    lost: profile.asWhite.lost + profile.asBlack.lost,
  };
}

/** Whoever has the most of something, every one of them when they're level. */
export interface Leader {
  userIds: string[];
  amount: number;
}

/**
 * The empires with the largest amount, or null when nobody has any (every amount null, or none
 * above zero unless `zero` counts). `then` breaks ties, larger first.
 */
export function leaderOf(
  entries: readonly { userId: string; amount: number | null; then?: number }[],
  { zero = false }: { zero?: boolean } = {},
): Leader | null {
  let best: { amount: number; then: number } | null = null;
  let userIds: string[] = [];
  for (const { userId, amount, then = 0 } of entries) {
    if (amount === null || (!zero && amount <= 0)) continue;
    if (!best || amount > best.amount || (amount === best.amount && then > best.then)) {
      best = { amount, then };
      userIds = [userId];
    } else if (amount === best.amount && then === best.then) {
      userIds.push(userId);
    }
  }
  return best ? { userIds, amount: best.amount } : null;
}
