import { DEFAULT_RULES, MISSION_RULES_V4, MISSION_RULES_V6, missionRules, parseRules } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import {
  answerTimeText,
  changedSettings,
  deadlineRows,
  forRounds,
  handicapLine,
  holdTimeText,
  keySettings,
  missionPointsMax,
  missionVersionNote,
  objectivesText,
  handicapText,
  ratingText,
  liveClockText,
  perMoveText,
  raiseText,
  raisedRowLabel,
  roundsText,
  recordMissions,
  seasonEndText,
  selectionTimeText,
  settingsList,
  stakeTable,
  standardRules,
  timeControlText,
  turnTimeText,
  winningMathText,
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
    expect(table.map((row) => row.stake)).toEqual([2, 3, 4, 5, 6, 7, 9, 11, 14, 17, 22]);
    expect(table.map((row) => row.raised)).toEqual([2, 3, 5, 6, 8, 9, 12, 15, 18, 23, 30]);
    // A campaign on a map whose values run 1 to 10 shows each of them.
    const older = stakeTable(DEFAULT_RULES, 10);
    expect(older.map((row) => row.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(older.map((row) => row.stake)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(older.map((row) => row.raised)).toEqual([2, 3, 5, 6, 8, 9, 11, 12, 14, 15]);
  });

  it('lists the settings a campaign plays with', () => {
    const standard = Object.fromEntries(settingsList(DEFAULT_RULES).map((s) => [s.label, s.value]));
    expect(standard).toMatchObject({
      Victory: 'First to 10 points, with titles',
      'Last round': 'Round 25, then the most points win',
      'Level on points': 'The largest population, then the most land, then the largest GDP',
      'Claims are held': 'Until everyone has had their turns in a later round',
      'Time to choose a secret': '24 hours',
      Pace: 'Correspondence',
      Rounds: 'Started by the host',
      Declaring: 'In turns, 24 hours each',
      'Time to answer': '24 hours',
      'War tokens': '1 a round, up to 3',
      'Truce after a war': '1 round',
      'Lock on won countries': '2 rounds',
      'Raising the stakes': 'Matched: a country worth 50–100% of the target, raised back and forth up to 3 times',
      'Least stake': '110% of the target',
      'Raised stake': '150% of the target',
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
    // Claims held by time: campaigns stored before turns held them, and campaigns without turns.
    const timed = { ...DEFAULT_RULES, victory: { ...DEFAULT_RULES.victory, hold: 'time' as const } };
    const noTurns = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, turns: false } };
    for (const rules of [timed, noTurns]) {
      const listed = Object.fromEntries(settingsList(rules).map((s) => [s.label, s.value]));
      expect(listed['Claims are held']).toBe('24 hours after the next round starts');
    }
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
      // Rules stored before schedules leave rounds to the host.
      Rounds: 'Started by the host',
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

  it('says how far the stakes go back and forth', () => {
    expect(raiseText(parseRules({ war: { raise: 'matched' } }))).toBe('Matched: a country worth 50–100% of the target');
    expect(raiseText(parseRules({ war: { raise: 'matched', raises: 5 } }))).toBe(
      'Matched: a country worth 50–100% of the target, raised back and forth up to 5 times',
    );
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

  it('sums a campaign up in its key settings', () => {
    expect(keySettings(DEFAULT_RULES)).toEqual([
      { label: 'Pace', value: 'Correspondence' },
      { label: 'Time control', value: '1 day per move' },
      { label: 'Rounds', value: 'Started by the host' },
      { label: 'Players', value: 'Up to 8' },
      { label: 'Draft', value: 'Contiguous' },
      { label: 'Victory', value: 'First to 10 points, with titles' },
      { label: 'Last round', value: 'Round 25, then the most points win' },
    ]);
    // Open-ended campaigns have no last round to give.
    expect(keySettings(parseRules({})).map((s) => s.label)).toEqual([
      'Pace',
      'Time control',
      'Rounds',
      'Players',
      'Draft',
      'Victory',
    ]);
  });

  it('says where a campaign differs from the standard rules at its pace', () => {
    // A quick start plays the standard rules at either pace.
    expect(changedSettings(DEFAULT_RULES)).toEqual([]);
    expect(changedSettings({ ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, pace: 'live' } })).toEqual([]);
    const custom = {
      ...DEFAULT_RULES,
      maxPlayers: 4,
      war: { ...DEFAULT_RULES.war, pace: 'live' as const, liveClock: '3+2' as const, draws: 'armageddon' as const },
    };
    expect(changedSettings(custom)).toEqual(['Players', 'Time control', 'Draws']);
    // Open-ended: the mission settings it no longer has aren't listed as changes.
    expect(changedSettings({ ...DEFAULT_RULES, victory: { ...DEFAULT_RULES.victory, mode: 'open' } })).toEqual([
      'Victory',
    ]);
    // A campaign on older mission rules is compared with the standard rules on its own version.
    const older = { ...DEFAULT_RULES, victory: { ...DEFAULT_RULES.victory, version: 4 } };
    expect(standardRules(older).victory.version).toBe(4);
    expect(changedSettings(older)).toEqual([]);
    // A schedule is the host's choice, never the standard.
    const scheduled = { ...DEFAULT_RULES, rounds: { progression: 'scheduled' as const, hours: 48 as const } };
    expect(changedSettings(scheduled)).toEqual(['Rounds']);
    expect(keySettings(scheduled).find((s) => s.label === 'Rounds')?.value).toBe('On a schedule, 2 days each');
    // Live rounds are the host's, whatever was stored.
    expect(roundsText({ ...scheduled, war: { ...scheduled.war, pace: 'live' } })).toBe('Started by the host');
    // Stored rules from before the revised war answers differ in each of them.
    expect(changedSettings(parseRules({ victory: DEFAULT_RULES.victory }))).toEqual(
      expect.arrayContaining(['Declaring', 'Least stake', 'Raising the stakes', 'Redirects', 'Fortifying']),
    );
  });
});

/** Rules stored before victory missions were tuned: version 4 (no titles, 7 to win), as stored campaigns read. */
const BEFORE_TITLES = parseRules({ victory: { mode: 'objectives', version: 4, lastRound: 20 } });
const LIVE = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, pace: 'live' as const } };

describe('times by pace', () => {
  it('gives the standard rules both paces, and a campaign its own', () => {
    expect(answerTimeText(DEFAULT_RULES, true)).toBe('24 hours (5 minutes in live campaigns)');
    expect(turnTimeText(DEFAULT_RULES, true)).toBe('24 hours (5 minutes in live campaigns)');
    expect(selectionTimeText(DEFAULT_RULES, true)).toBe('24 hours (5 minutes in live campaigns)');
    expect(holdTimeText(DEFAULT_RULES, true)).toBe('24 hours (10 minutes in live campaigns)');
    expect(answerTimeText(LIVE, false)).toBe('5 minutes');
    expect(selectionTimeText(LIVE, false)).toBe('5 minutes');
    expect(holdTimeText(LIVE, false)).toBe('10 minutes');
    // The host's own times, at the campaign's pace.
    const own = { ...LIVE, victory: { ...LIVE.victory, holdMinutes: 30, selectionMinutes: 10 } };
    expect(holdTimeText(own, false)).toBe('30 minutes');
    expect(selectionTimeText(own, false)).toBe('10 minutes');
  });

  it('tabulates every deadline at each pace asked for', () => {
    const both = Object.fromEntries(
      deadlineRows(DEFAULT_RULES, ['correspondence', 'live']).map((r) => [r.who, r.times]),
    );
    expect(both).toMatchObject({
      'A player takes their turn to declare': ['24 hours', '5 minutes'],
      'The defender answers a declaration': ['24 hours', '5 minutes'],
      'The attacker answers a raise after raising': ['24 hours', '5 minutes'],
      'A player answers peace terms': [
        '24 hours, or before their next move in the game',
        '5 minutes, or before their next move in the game',
      ],
      'A player moves': ['1 day per move', 'On the clock, 5+3'],
      'A player chooses a secret mission': ['24 hours', '5 minutes'],
    });
    const live = Object.fromEntries(deadlineRows(LIVE).map((r) => [r.who, r.times]));
    expect(Object.values(live).flat().join(' ')).not.toMatch(/24 hours|day/);
    // Stored rules: no turns, tribute instead of peace terms, no back and forth, no missions.
    const stored = deadlineRows(parseRules({}), ['correspondence']).map((r) => r.who);
    expect(stored).toContain('The attacker replies to a tribute offer');
    expect(stored).not.toContain('A player takes their turn to declare');
    expect(stored).not.toContain('The attacker answers a raise after raising');
    expect(stored).not.toContain('A player chooses a secret mission');
    // Rounds on a schedule run out like any other deadline.
    expect(deadlineRows(DEFAULT_RULES).map((r) => r.who)).not.toContain('A round runs its time');
    const scheduled = { ...DEFAULT_RULES, rounds: { progression: 'scheduled' as const, hours: 120 as const } };
    expect(deadlineRows(scheduled)[0]).toEqual({
      who: 'A round runs its time',
      times: ['5 days'],
      silence:
        'The next round starts by itself: turns not yet taken are lost, and wars carry on. After the last round, the campaign ends on points.',
    });
  });
});

describe('scoring in words', () => {
  it('never calls a title necessary when missions alone reach the target', () => {
    expect(missionPointsMax(MISSION_RULES_V6)).toBe(11);
    expect(winningMathText(MISSION_RULES_V6)).toBe(
      'Missions alone can make 11 points (all four public missions and the secret), more than the 10 to win, so ' +
        'no title is ever required. With titles, fewer missions will do: three public missions, the secret and one title make 10.',
    );
    // Where missions fall short, it says so: a target of 13 needs two titles on top of every mission.
    const harder = { ...MISSION_RULES_V6, points: { ...MISSION_RULES_V6.points, toWin: 13 } };
    expect(winningMathText(harder)).toBe(
      'Missions make 11 points at most, 2 short of the 13 to win, so a winner holds at least two titles as well.',
    );
  });

  it('shows which missions win without titles', () => {
    expect(winningMathText(MISSION_RULES_V4)).toBe(
      'Two public missions and the secret make 7, and all four public ones make 8, so a player can win without their secret.',
    );
    const needsSecret = { ...MISSION_RULES_V4, points: { ...MISSION_RULES_V4.points, toWin: 9 } };
    expect(winningMathText(needsSecret)).toBe(
      'Three public missions and the secret make 9; all four public ones make only 8, so every winner needs their secret.',
    );
  });

  it('lists the records, which score with no claim, as each version deals them', () => {
    expect(recordMissions(MISSION_RULES_V6)).toEqual({
      public: ['Campaign Veteran', 'Kingslayer', 'Lightning Campaign'],
      secret: ['Backstab', 'Iron Wall', 'Checkmate Artist'],
    });
    // Version 1 had no battle secrets, nor Kingslayer or Lightning Campaign.
    expect(recordMissions(missionRules(1))).toEqual({ public: ['Campaign Veteran'], secret: [] });
  });

  it('ends a season on the campaign’s own tiebreak', () => {
    expect(seasonEndText(DEFAULT_RULES)).toBe(
      'the most victory points win, then the largest population, then the most land, then the largest GDP',
    );
    expect(seasonEndText(BEFORE_TITLES)).toBe('the most victory points win, then the most valuable empire');
  });

  it('offers Objectives in the lobby with the campaign’s own numbers', () => {
    expect(objectivesText(DEFAULT_RULES)).toBe(
      'Four public missions and a secret one for each player, and titles for leading the table. The first to 10 ' +
        'victory points wins, or the most points when round 25 ends.',
    );
    const noEnd = { ...BEFORE_TITLES, victory: { ...BEFORE_TITLES.victory, lastRound: null } };
    expect(objectivesText(noEnd)).toBe(
      'Four public missions and a secret one for each player. The first to 7 victory points wins.',
    );
  });

  it('notes when a campaign plays older mission rules', () => {
    expect(missionVersionNote(DEFAULT_RULES)).toBeNull();
    expect(missionVersionNote(parseRules({}))).toBeNull();
    expect(missionVersionNote(BEFORE_TITLES)).toBe(
      'This campaign plays mission rules version 4, which it was created with (7 points to win, no titles): the ' +
        'missions, numbers and points here are its own. New campaigns play version 6.',
    );
    const v5 = { ...DEFAULT_RULES, victory: { ...DEFAULT_RULES.victory, version: 5 } };
    expect(missionVersionNote(v5)).toBe(
      'This campaign plays mission rules version 5, which it was created with: the missions, numbers and points ' +
        'here are its own. New campaigns play version 6.',
    );
  });
});
