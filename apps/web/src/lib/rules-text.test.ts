import { DEFAULT_RULES, parseRules } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import {
  forRounds,
  handicapLine,
  handicapText,
  ratingText,
  liveClockText,
  perMoveText,
  raisedRowLabel,
  settingsList,
  stakeTable,
  timeControlText,
} from './rules-text';

describe('rules in words', () => {
  it('counts rounds from the round something begins in', () => {
    expect(forRounds(1)).toBe('for the rest of the round');
    expect(forRounds(2)).toBe('for the rest of the round and the next one');
    expect(forRounds(4)).toBe('for the rest of the round and the next three');
  });

  it('describes time controls', () => {
    expect(perMoveText(12)).toBe('12 hours per move');
    expect(perMoveText(24)).toBe('1 day per move');
    expect(perMoveText(72)).toBe('3 days per move');
    expect(liveClockText('5+3')).toBe('5 minutes each, plus 3 seconds a move');
    expect(timeControlText(DEFAULT_RULES)).toBe('1 day per move');
    expect(timeControlText(parseRules({ war: { pace: 'live', liveClock: '10+5' } }))).toBe('10+5');
  });

  it('tabulates stakes the way the war rules check them', () => {
    const table = stakeTable(DEFAULT_RULES);
    expect(table.map((row) => row.value)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20]);
    expect(table.map((row) => row.stake)).toEqual([1, 2, 3, 4, 4, 5, 7, 8, 10, 12, 16]);
    expect(table.map((row) => row.raised)).toEqual([2, 3, 4, 5, 7, 8, 10, 13, 15, 19, 25]);
    // A campaign on a map whose values run 1 to 10 shows each of them.
    const older = stakeTable(DEFAULT_RULES, 10);
    expect(older.map((row) => row.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(older.map((row) => row.stake)).toEqual([1, 2, 3, 4, 4, 5, 6, 7, 8, 8]);
    expect(older.map((row) => row.raised)).toEqual([2, 3, 4, 5, 7, 8, 9, 10, 12, 13]);
  });

  it('lists the settings a campaign plays with', () => {
    const standard = Object.fromEntries(settingsList(DEFAULT_RULES).map((s) => [s.label, s.value]));
    expect(standard).toMatchObject({
      Victory: 'First to 7 points',
      'Last round': 'Round 25, then the most points win',
      'Level on points': 'The largest population, then the most land, then the largest GDP',
      'Claims are held': '24 hours after the next round starts',
      'Time to choose a secret': '24 hours',
      Pace: 'Correspondence',
      Declaring: 'In turns, 24 hours each',
      'Time to answer': '24 hours',
      'War tokens': '1 a round, up to 3',
      'Truce after a war': '1 round',
      'Lock on won countries': '2 rounds',
      'Raising the stakes': 'Matched: a country worth 50–100% of the target',
      'Raised stake': '125% of the target',
      Redirects: 'Near the target, for a token',
      Fortifying: 'A token, until the round after next',
      'Peace terms': 'Until the game ends',
      'Calling off a declaration': 'Until the defender answers',
    });
    const live = parseRules({ war: { pace: 'live', draws: 'armageddon', truceRounds: 0, clockModifiers: false } });
    const liveSettings = Object.fromEntries(settingsList(live).map((s) => [s.label, s.value]));
    // Rules stored without a victory setting are an open-ended campaign.
    expect(liveSettings.Victory).toBe('Open-ended');
    expect(liveSettings['Claims are held']).toBeUndefined();
    expect(liveSettings['Last round']).toBeUndefined();
    expect(liveSettings['Level on points']).toBeUndefined();
    // Campaigns stored before the real-world tiebreak keep the one they started with.
    const stored = parseRules({ victory: { mode: 'objectives', lastRound: 20 } });
    expect(Object.fromEntries(settingsList(stored).map((s) => [s.label, s.value]))['Level on points']).toBe(
      'The most valuable empire',
    );
    expect(liveSettings).toMatchObject({
      Pace: 'Live',
      'Time control': '5+3',
      // Rules stored before turns keep declaring whenever players like.
      Declaring: 'Whenever you like',
      'Time to answer': '5 minutes',
      Draws: 'Armageddon',
      'Clock modifiers': 'Off',
      'Truce after a war': 'None',
      // Rules stored before the revised answers keep the original ones.
      'Raising the stakes': 'Free, to 125% of the target',
      Redirects: 'Anywhere on the border, free',
      Fortifying: 'Off',
      'Peace terms': 'Off: tribute instead',
    });
  });

  it('labels the raised row of the stake table by what it’s for', () => {
    expect(raisedRowLabel(DEFAULT_RULES)).toBe('Fortified');
    expect(raisedRowLabel(parseRules({}))).toBe('After a raise');
    expect(raisedRowLabel(parseRules({ war: { raise: 'token', fortify: true } }))).toBe('After a raise, or fortified');
    expect(raisedRowLabel(parseRules({ war: { raise: 'matched' } }))).toBeNull();
  });

  it('describes rating handicaps', () => {
    expect(handicapText(DEFAULT_RULES)).toBe('Off');
    expect(handicapText(parseRules({ war: { handicap: 'full', selfRatings: true } }))).toBe(
      'Full, from Lichess ratings or players’ own',
    );
    expect(handicapText(parseRules({ war: { handicap: 'light' } }))).toBe('Light, from Lichess ratings');
    expect(ratingText({ rating: 1834, source: 'lichess', perf: 'blitz' })).toBe('1834, Lichess blitz');
    expect(ratingText({ rating: 1400, source: 'self' })).toBe('1400, own rating');
    const h = { favored: 'defender' as const, pct: 40, gap: 250 };
    const names = { attacker: 'Ann', defender: 'Bo' };
    expect(handicapLine(h, 'live', names)).toBe('Bo +40% time, Ann −40% (250 points apart)');
    expect(handicapLine(h, 'correspondence', names)).toBe('Bo +40% time (250 points apart)');
  });
});
