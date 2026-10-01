import { z } from 'zod';
import { botLevel } from './bots';
import type { HandicapLevel, WarRules } from './config';

/**
 * Rating handicaps: time odds for the weaker player in a war's game. Each player's rating comes
 * from Lichess (the rating for the campaign's pace), a bot's level, or, where the host allows it,
 * a number the player gives themselves. Ratings are frozen when the draft starts, so nobody can
 * sandbag during a campaign; a game against someone without a rating has no handicap.
 */

/** Lichess's rating categories this game can use. */
export const LICHESS_PERFS = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'] as const;
export type LichessPerf = (typeof LICHESS_PERFS)[number];

export interface LichessPerfRating {
  rating: number;
  games: number;
  /** Lichess still calls the rating provisional (too few games, or too long ago). */
  prov: boolean;
}

/** A player's Lichess ratings, as last read from Lichess. */
export type LichessRatings = Partial<Record<LichessPerf, LichessPerfRating>>;

const lichessPerfSchema = z.object({
  rating: z.number(),
  games: z.number().int().min(0),
  prov: z.boolean().optional(),
});

/** Reads the `perfs` of a Lichess account or user (`/api/account`, `/api/user/:name`); anything odd is skipped. */
export function parseLichessPerfs(perfs: unknown): LichessRatings {
  const out: LichessRatings = {};
  if (typeof perfs !== 'object' || perfs === null) return out;
  for (const perf of LICHESS_PERFS) {
    const parsed = lichessPerfSchema.safeParse((perfs as Record<string, unknown>)[perf]);
    if (parsed.success) {
      const { rating, games, prov } = parsed.data;
      out[perf] = { rating: Math.round(rating), games, prov: prov ?? false };
    }
  }
  return out;
}

/** Lowest and highest rating a player may give themselves. */
export const RATING_MIN = 400;
export const RATING_MAX = 3200;
export const ratingSchema = z.number().int().min(RATING_MIN).max(RATING_MAX);

/**
 * The Lichess category for a campaign's games: correspondence, or for live games the one Lichess
 * gives the clock (its estimated length, the starting time plus forty increments).
 */
export function lichessPerfFor(war: Pick<WarRules, 'pace' | 'liveClock'>): LichessPerf {
  if (war.pace === 'correspondence') return 'correspondence';
  const [minutes, increment] = war.liveClock.split('+').map(Number) as [number, number];
  const seconds = minutes * 60 + increment * 40;
  return seconds < 180 ? 'bullet' : seconds < 480 ? 'blitz' : seconds < 1500 ? 'rapid' : 'classical';
}

/** Where to look when a player has no established rating in the campaign's category, nearest first. */
const PERF_FALLBACKS: Record<LichessPerf, readonly LichessPerf[]> = {
  bullet: ['bullet', 'blitz', 'rapid', 'classical'],
  blitz: ['blitz', 'rapid', 'bullet', 'classical'],
  rapid: ['rapid', 'blitz', 'classical', 'bullet'],
  classical: ['classical', 'rapid', 'blitz', 'correspondence'],
  correspondence: ['correspondence', 'classical', 'rapid', 'blitz'],
};

/**
 * A player's Lichess rating for the campaign: the campaign's category if it's established (rated
 * games played, not provisional), else the nearest one that is. Null if none is.
 */
export function lichessRatingFor(
  war: Pick<WarRules, 'pace' | 'liveClock'>,
  ratings: LichessRatings | null,
): { rating: number; perf: LichessPerf } | null {
  if (!ratings) return null;
  for (const perf of PERF_FALLBACKS[lichessPerfFor(war)]) {
    const r = ratings[perf];
    if (r && r.games > 0 && !r.prov) return { rating: r.rating, perf };
  }
  return null;
}

export const RATING_SOURCES = ['lichess', 'self', 'bot'] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

/** The rating a player's games are handicapped by, and where it came from. */
export interface PlayerRating {
  rating: number;
  source: RatingSource;
  /** For a Lichess rating, its category. */
  perf?: LichessPerf;
}

/**
 * A player's rating for the handicap: a bot's level, else their established Lichess rating, else
 * (if the host lets players give their own) the one they gave. Null: no rating, so no handicap
 * in their games.
 */
export function playerRating(
  war: Pick<WarRules, 'pace' | 'liveClock' | 'selfRatings'>,
  player: { botLevel: number | null; lichess: LichessRatings | null; claimed: number | null },
): PlayerRating | null {
  if (player.botLevel !== null) return { rating: botLevel(player.botLevel).rating, source: 'bot' };
  const lichess = lichessRatingFor(war, player.lichess);
  if (lichess) return { rating: lichess.rating, source: 'lichess', perf: lichess.perf };
  if (war.selfRatings && player.claimed !== null) return { rating: player.claimed, source: 'self' };
  return null;
}

/** Gaps smaller than this are noise: no handicap. */
export const HANDICAP_MIN_GAP = 50;
/** Percent of time moved to the weaker player per 100 rating points between the two, by level. */
export const HANDICAP_PCT_PER_100: Record<Exclude<HandicapLevel, 'off'>, number> = { light: 8, full: 16 };
/** The most time a handicap moves, in percent, by level. */
export const HANDICAP_CAP_PCT: Record<Exclude<HandicapLevel, 'off'>, number> = { light: 30, full: 60 };

/**
 * A war game's time odds. In live games the weaker player's clock gains `pct` percent and the
 * stronger player's loses as much; in correspondence the weaker player gains it and the stronger
 * keeps their time, so nobody's deadline falls in the middle of their night.
 */
export interface Handicap {
  favored: 'attacker' | 'defender';
  pct: number;
  /** The rating gap it was worked out from. */
  gap: number;
}

/** The handicap for a game between two players, or null (handicaps off, a player unrated, a small gap). */
export function ratingHandicap(
  war: Pick<WarRules, 'handicap'>,
  attacker: number | null | undefined,
  defender: number | null | undefined,
): Handicap | null {
  if (war.handicap === 'off' || attacker == null || defender == null) return null;
  const gap = Math.abs(attacker - defender);
  if (gap < HANDICAP_MIN_GAP) return null;
  const pct = Math.min(HANDICAP_CAP_PCT[war.handicap], Math.round((gap * HANDICAP_PCT_PER_100[war.handicap]) / 100));
  return { favored: attacker < defender ? 'attacker' : 'defender', pct, gap };
}

/** A time factor for one side of a handicapped game (1 when there's no handicap). */
export function handicapFactor(
  pace: WarRules['pace'],
  handicap: Handicap | null,
  side: 'attacker' | 'defender',
): number {
  if (!handicap) return 1;
  if (side === handicap.favored) return 1 + handicap.pct / 100;
  return pace === 'live' ? 1 - handicap.pct / 100 : 1;
}
