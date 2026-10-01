import { describe, expect, it } from 'vitest';
import { parseRules } from './config';
import {
  lichessPerfFor,
  lichessRatingFor,
  parseLichessPerfs,
  playerRating,
  ratingHandicap,
  type LichessRatings,
} from './handicap';
import { warTimeControl } from './war';

const live = (liveClock: '3+2' | '5+3' | '10+5' | '15+10') => parseRules({ war: { pace: 'live', liveClock } }).war;
const correspondence = parseRules({}).war;

describe('Lichess ratings', () => {
  it('read the categories Lichess gives a clock', () => {
    expect(lichessPerfFor(live('3+2'))).toBe('blitz');
    expect(lichessPerfFor(live('5+3'))).toBe('blitz');
    expect(lichessPerfFor(live('10+5'))).toBe('rapid');
    expect(lichessPerfFor(live('15+10'))).toBe('rapid');
    expect(lichessPerfFor(correspondence)).toBe('correspondence');
  });

  it('parse an account, skipping what is not a rating', () => {
    expect(
      parseLichessPerfs({
        blitz: { games: 120, rating: 1834.4, rd: 60, prog: 12 },
        rapid: { games: 3, rating: 1500, rd: 300, prog: 0, prov: true },
        puzzle: { games: 10, rating: 2000 },
        classical: 'nonsense',
      }),
    ).toEqual({ blitz: { rating: 1834, games: 120, prov: false }, rapid: { rating: 1500, games: 3, prov: true } });
    expect(parseLichessPerfs(null)).toEqual({});
  });

  it('use the campaign category when established, else the nearest one that is', () => {
    const ratings: LichessRatings = {
      blitz: { rating: 1800, games: 200, prov: false },
      rapid: { rating: 1500, games: 4, prov: true },
      correspondence: { rating: 1500, games: 0, prov: true },
    };
    expect(lichessRatingFor(live('5+3'), ratings)).toEqual({ rating: 1800, perf: 'blitz' });
    expect(lichessRatingFor(live('10+5'), ratings)).toEqual({ rating: 1800, perf: 'blitz' });
    expect(lichessRatingFor(correspondence, ratings)).toEqual({ rating: 1800, perf: 'blitz' });
    expect(lichessRatingFor(correspondence, { rapid: ratings.rapid })).toBeNull();
    expect(lichessRatingFor(correspondence, null)).toBeNull();
  });
});

describe('player ratings', () => {
  const lichess: LichessRatings = { correspondence: { rating: 1900, games: 40, prov: false } };
  const selfRated = { ...correspondence, selfRatings: true };

  it('come from a bot level first, then Lichess, then the player if the host allows', () => {
    expect(playerRating(selfRated, { botLevel: 4, lichess, claimed: 1200 })).toEqual({ rating: 1650, source: 'bot' });
    expect(playerRating(selfRated, { botLevel: null, lichess, claimed: 1200 })).toEqual({
      rating: 1900,
      source: 'lichess',
      perf: 'correspondence',
    });
    expect(playerRating(selfRated, { botLevel: null, lichess: null, claimed: 1200 })).toEqual({
      rating: 1200,
      source: 'self',
    });
    expect(playerRating(correspondence, { botLevel: null, lichess: null, claimed: 1200 })).toBeNull();
    expect(playerRating(selfRated, { botLevel: null, lichess: null, claimed: null })).toBeNull();
  });
});

describe('rating handicaps', () => {
  const light = { handicap: 'light' as const };
  const full = { handicap: 'full' as const };

  it('scale with the gap, up to a cap', () => {
    expect(ratingHandicap(full, 1500, 1800)).toEqual({ favored: 'attacker', pct: 48, gap: 300 });
    expect(ratingHandicap(light, 1800, 1500)).toEqual({ favored: 'defender', pct: 24, gap: 300 });
    expect(ratingHandicap(full, 1000, 2200)?.pct).toBe(60);
    expect(ratingHandicap(light, 1000, 2200)?.pct).toBe(30);
  });

  it('need two ratings and a real gap', () => {
    expect(ratingHandicap({ handicap: 'off' }, 1000, 2000)).toBeNull();
    expect(ratingHandicap(full, null, 2000)).toBeNull();
    expect(ratingHandicap(full, 1500, undefined)).toBeNull();
    expect(ratingHandicap(full, 1500, 1549)).toBeNull();
    expect(ratingHandicap(full, 1500, 1550)?.pct).toBe(8);
  });

  it('move time from the stronger clock to the weaker in live games', () => {
    const rules = parseRules({ war: { pace: 'live', liveClock: '5+3', handicap: 'full' } });
    const handicap = ratingHandicap(rules.war, 1500, 1750)!;
    expect(warTimeControl(rules, { parts: [], net: 0 }, false, handicap)).toEqual({
      kind: 'live',
      white: { initialMs: 420_000, incrementMs: 4200 },
      black: { initialMs: 180_000, incrementMs: 1800 },
    });
  });

  it('stack with the clock modifiers and Armageddon', () => {
    const rules = parseRules({ war: { pace: 'live', liveClock: '5+3', handicap: 'light' } });
    // The defender is weaker and gets 16%; the modifiers give the defender 10% too.
    const handicap = ratingHandicap(rules.war, 1700, 1500)!;
    expect(warTimeControl(rules, { parts: [], net: 10 }, true, handicap)).toEqual({
      kind: 'live',
      white: { initialMs: 382_800, incrementMs: 3828 },
      black: { initialMs: 201_600, incrementMs: 2016 },
    });
  });

  it('only add time in correspondence games', () => {
    const rules = parseRules({ war: { handicap: 'full' } });
    const handicap = ratingHandicap(rules.war, 2000, 1500)!;
    expect(warTimeControl(rules, { parts: [], net: 0 }, false, handicap)).toEqual({
      kind: 'correspondence',
      white: { perMoveMs: 86_400_000 },
      black: { perMoveMs: 138_240_000 },
    });
  });
});
