import { DEFAULT_RULES, parseRules } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import { forRounds, liveClockText, perMoveText, settingsList, stakeTable, timeControlText } from './rules-text';

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
    expect(table.map((row) => row.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(table.map((row) => row.stake)).toEqual([1, 2, 3, 4, 4, 5, 6, 7, 8, 8]);
    expect(table.map((row) => row.raised)).toEqual([2, 3, 4, 5, 7, 8, 9, 10, 12, 13]);
  });

  it('lists the settings a campaign plays with', () => {
    const standard = Object.fromEntries(settingsList(DEFAULT_RULES).map((s) => [s.label, s.value]));
    expect(standard).toMatchObject({
      Victory: 'First to 7 points',
      'Last round': 'Round 25, then the most points win',
      'Claims are held': '24 hours after the next round starts',
      'Time to choose a secret': '24 hours',
      Pace: 'Correspondence',
      'Time to answer': '24 hours',
      'War tokens': '1 a round, up to 3',
      'Truce after a war': '1 round',
      'Lock on won countries': '2 rounds',
    });
    const live = parseRules({ war: { pace: 'live', draws: 'armageddon', truceRounds: 0, clockModifiers: false } });
    const liveSettings = Object.fromEntries(settingsList(live).map((s) => [s.label, s.value]));
    // Rules stored without a victory setting are an open-ended campaign.
    expect(liveSettings.Victory).toBe('Open-ended');
    expect(liveSettings['Claims are held']).toBeUndefined();
    expect(liveSettings['Last round']).toBeUndefined();
    expect(liveSettings).toMatchObject({
      Pace: 'Live',
      'Time control': '5+3',
      'Time to answer': '5 minutes',
      Draws: 'Armageddon',
      'Clock modifiers': 'Off',
      'Truce after a war': 'None',
    });
  });
});
