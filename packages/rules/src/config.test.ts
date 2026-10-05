import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, REVISED_WAR_RULES, lastRoundOf, parseRules, withStakeFloor } from './config';
import { EMPIRE_COLORS, firstFreeColor } from './colors';

/**
 * The answers and stakes of the original game, and declaring whenever you like: what rules stored
 * before the revised ones read as.
 */
const ORIGINAL_ANSWERS = {
  stakeFloorPct: 80,
  raisePct: 125,
  raise: 'free',
  raises: 1,
  redirect: 'anywhere',
  redirectToken: false,
  fortify: false,
  peaceTerms: false,
  recall: false,
  turns: false,
};

describe('campaign rules', () => {
  it('fills defaults', () => {
    expect(DEFAULT_RULES).toEqual({
      maxPlayers: 8,
      draft: { mode: 'contiguous' },
      war: {
        pace: 'correspondence',
        liveClock: '5+3',
        hoursPerMove: 24,
        draws: 'defender-holds',
        clockModifiers: true,
        tokensPerRound: 1,
        tokenCap: 3,
        stakeFloorPct: 110,
        raisePct: 150,
        lockRounds: 2,
        truceRounds: 1,
        raise: 'matched',
        raises: 3,
        redirect: 'nearby',
        redirectToken: true,
        fortify: true,
        peaceTerms: true,
        recall: true,
        turns: true,
        handicap: 'off',
        selfRatings: false,
      },
      victory: {
        mode: 'objectives',
        version: 5,
        publicMissions: [],
        holdMinutes: null,
        selectionMinutes: null,
        lastRound: 25,
        tiebreak: 'realWorld',
      },
    });
    expect(
      parseRules({
        draft: {},
        war: REVISED_WAR_RULES,
        victory: { mode: 'objectives', version: 5, lastRound: 25, tiebreak: 'realWorld' },
      }),
    ).toEqual(DEFAULT_RULES);
  });

  it('gives campaigns stored before seasons no last round', () => {
    const stored = { victory: { mode: 'objectives', version: 2, publicMissions: [] } };
    expect(parseRules(stored).victory.lastRound).toBeNull();
    expect(lastRoundOf(parseRules(stored))).toBeNull();
    expect(lastRoundOf(DEFAULT_RULES)).toBe(25);
    // An open-ended campaign has no season, whatever it stored.
    expect(lastRoundOf(parseRules({ victory: { mode: 'open', lastRound: 20 } }))).toBeNull();
    expect(() => parseRules({ victory: { mode: 'objectives', lastRound: 1 } })).toThrow();
  });

  it('fills war settings into rules stored before they existed', () => {
    const stored = { maxPlayers: 4, draft: { mode: 'free' } };
    expect(parseRules(stored).war).toEqual({ ...DEFAULT_RULES.war, ...ORIGINAL_ANSWERS });
  });

  it('moves the raised stake with the stake floor', () => {
    // A new campaign's 110% and 150% keep fortifying 40 points over the floor.
    expect([80, 100, 125].map((pct) => withStakeFloor(DEFAULT_RULES.war, pct))).toEqual([
      { stakeFloorPct: 80, raisePct: 120 },
      { stakeFloorPct: 100, raisePct: 140 },
      { stakeFloorPct: 125, raisePct: 165 },
    ]);
    // A gap the host chose is kept, within what the rules allow.
    expect(withStakeFloor({ stakeFloorPct: 80, raisePct: 200 }, 110).raisePct).toBe(230);
    expect(withStakeFloor({ stakeFloorPct: 125, raisePct: 110 }, 80).raisePct).toBe(100);
    expect(withStakeFloor({ stakeFloorPct: 50, raisePct: 280 }, 200).raisePct).toBe(300);
  });

  it('reads war rules stored before the revised answers as the original game', () => {
    // A campaign underway keeps the answers it started with: a free raise, redirects anywhere, tribute.
    const stored = { war: { pace: 'live', stakeFloorPct: 80, raisePct: 125 } };
    expect(parseRules(stored).war).toMatchObject(ORIGINAL_ANSWERS);
    expect(parseRules({ war: { raise: 'token' } }).war.raise).toBe('token');
    expect(() => parseRules({ war: { raise: 'double' } })).toThrow();
  });

  it('keeps campaigns stored before turns declaring whenever they like', () => {
    // A campaign underway doesn't start taking turns: only new campaigns do.
    expect(parseRules({ war: { ...REVISED_WAR_RULES, turns: undefined } }).war.turns).toBe(false);
    expect(parseRules({ war: { pace: 'live' } }).war.turns).toBe(false);
    expect(DEFAULT_RULES.war.turns).toBe(true);
  });

  it('reads rules stored before victory missions as open-ended, never as Objectives', () => {
    const stored = { maxPlayers: 4, draft: { mode: 'free' }, war: { pace: 'live' } };
    // They play no missions, so the version only counts if the host switches a lobby to Objectives:
    // then version 3, written for the 1-10 values of their dataset (2026.1).
    expect(parseRules(stored).victory).toEqual({
      mode: 'open',
      version: 3,
      publicMissions: [],
      holdMinutes: null,
      selectionMinutes: null,
      lastRound: null,
      tiebreak: 'value',
    });
    expect(parseRules(undefined).victory.mode).toBe('open');
  });

  it('keeps the mission rules version a campaign stored', () => {
    expect(parseRules({ victory: { mode: 'objectives', version: 1 } }).victory.version).toBe(1);
  });

  it('validates the public missions stored with the rules', () => {
    const victory = { mode: 'objectives', publicMissions: [{ kind: 'expansion', gain: 15 }] };
    expect(parseRules({ victory }).victory.publicMissions).toEqual([{ kind: 'expansion', gain: 15 }]);
    expect(() => parseRules({ victory: { publicMissions: [{ kind: 'expansion' }] } })).toThrow();
    expect(() => parseRules({ victory: { publicMissions: [{ kind: 'northern_passage' }] } })).toThrow();
  });

  it('rejects out-of-range player counts', () => {
    expect(() => parseRules({ maxPlayers: 1 })).toThrow();
    expect(() => parseRules({ maxPlayers: 9 })).toThrow();
  });

  it('only offers the preset time controls', () => {
    expect(parseRules({ war: { pace: 'live', liveClock: '10+5' } }).war.liveClock).toBe('10+5');
    expect(() => parseRules({ war: { liveClock: '1+0' } })).toThrow();
    expect(() => parseRules({ war: { hoursPerMove: 36 } })).toThrow();
  });
});

describe('empire colors', () => {
  it('pairs every color with a distinct pattern', () => {
    expect(new Set(EMPIRE_COLORS.map((c) => c.pattern)).size).toBe(EMPIRE_COLORS.length);
    expect(EMPIRE_COLORS.every((c, i) => c.index === i)).toBe(true);
  });

  it('hands out the first free color', () => {
    expect(firstFreeColor([])).toBe(0);
    expect(firstFreeColor([0, 1, 3])).toBe(2);
    expect(firstFreeColor(EMPIRE_COLORS.map((c) => c.index))).toBeNull();
  });
});
