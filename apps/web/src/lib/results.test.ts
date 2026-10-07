import {
  indexDataset,
  type AccordTally,
  type CampaignStats,
  type ChessProfile,
  type EmpireRecordView,
  type GameLine,
  type MemberView,
  type VictoryResultView,
  type WarRecord,
  type WarTally,
} from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import {
  breakdownOf,
  campaignTotals,
  deletionText,
  finaleSeen,
  finaleText,
  honorsOf,
  listNames,
  markFinaleSeen,
  placesOf,
  placeText,
  type ResultStanding,
} from './results';

const names: Record<string, string> = { ann: 'Ann', bo: 'Bo', cy: 'Cy', di: 'Di' };
const nameOf = (id: string) => names[id] ?? id;

const standing = (userId: string, points: number, more: Partial<ResultStanding> = {}): ResultStanding => ({
  userId,
  points,
  value: 10,
  countries: 3,
  awards: [],
  secret: null,
  ...more,
});

const result = (more: Partial<VictoryResultView> & Pick<VictoryResultView, 'standings' | 'winners'>) =>
  ({ round: 12, finishedAt: '2026-10-05T12:00:00.000Z', holdings: {}, ...more }) as VictoryResultView;

describe('places', () => {
  it('put the winners first, and players level on points share a place', () => {
    const r = result({
      winners: ['ann'],
      standings: [standing('ann', 10), standing('bo', 6), standing('cy', 6), standing('di', 2)],
    });
    const places = placesOf(r);
    expect([...places]).toEqual([
      ['ann', 1],
      ['bo', 2],
      ['cy', 2],
      ['di', 4],
    ]);
    expect(placeText(r, places, 'bo')).toBe('joint 2nd');
    expect(placeText(r, places, 'di')).toBe('4th');
  });

  it('share first place between winners who share the victory', () => {
    const r = result({
      winners: ['ann', 'bo'],
      standings: [standing('ann', 10), standing('bo', 10), standing('cy', 4)],
    });
    expect([...placesOf(r).values()]).toEqual([1, 1, 3]);
  });

  it('follow the tiebreak at the end of a season', () => {
    const r = result({
      winners: ['ann'],
      seasonEnd: true,
      standings: [
        standing('ann', 6, { measures: [9, 1, 1] }),
        standing('bo', 6, { measures: [5, 1, 1] }),
        standing('cy', 3, { measures: [2, 2, 2] }),
        standing('di', 3, { measures: [2, 2, 2] }),
      ],
    });
    expect([...placesOf(r).values()]).toEqual([1, 2, 3, 3]);
  });
});

describe('points breakdown', () => {
  it('splits public missions, the secret mission and titles held at the end', () => {
    const award = (missionKey: string, points: number) => ({
      userId: 'ann',
      missionKey,
      kind: 'expansion' as const,
      points,
      round: 3,
      awardedAt: '',
    });
    const s = standing('ann', 9, {
      awards: [award('p0', 2), award('p2', 2), award('secret', 3)],
      titles: ['population', 'land'],
    });
    expect(breakdownOf(s, 1)).toEqual({ public: 4, secret: 3, titles: 2 });
    // Results kept before titles have none.
    expect(breakdownOf(standing('bo', 0), 1)).toEqual({ public: 0, secret: 0, titles: 0 });
  });
});

describe('the finale', () => {
  const won = result({ winners: ['ann'], standings: [standing('ann', 11), standing('bo', 8), standing('cy', 8)] });

  it('tells the winner they won, and how', () => {
    expect(finaleText(won, 'ann', nameOf)).toEqual({
      outcome: 'victory',
      stamp: 'Victory',
      label: 'Campaign over · round 12',
      subjects: ['ann'],
      who: 'You won.',
      line: 'You reached 11 victory points in round 12.',
      place: null,
      summary: 'Victory. You won. You reached 11 victory points in round 12.',
    });
  });

  it('tells everyone else who won, and where they finished', () => {
    const text = finaleText(won, 'cy', nameOf);
    expect(text).toMatchObject({
      outcome: 'defeat',
      stamp: 'Defeat',
      subjects: ['ann'],
      line: 'Ann reached 11 victory points in round 12.',
      place: 'You finished joint 2nd with 8 victory points.',
    });
    expect(text.summary).toBe(
      'Defeat. Ann won. Ann reached 11 victory points in round 12. You finished joint 2nd with 8 victory points.',
    );
  });

  it('names who a shared victory is shared with', () => {
    const shared = result({
      winners: ['ann', 'bo'],
      standings: [standing('ann', 10), standing('bo', 10), standing('cy', 1)],
    });
    expect(finaleText(shared, 'bo', nameOf)).toMatchObject({
      outcome: 'victory',
      label: 'Shared victory · round 12',
      subjects: ['bo', 'ann'],
      who: 'You and Ann share the victory.',
      line: 'You and Ann reached 10 victory points in round 12.',
    });
    expect(finaleText(shared, 'cy', nameOf)).toMatchObject({
      outcome: 'defeat',
      subjects: ['ann', 'bo'],
      who: 'Ann and Bo share the victory.',
      line: 'Ann and Bo reached 10 victory points in round 12.',
      place: 'You finished 3rd with 1 victory point.',
    });
  });

  it('says when the last round ended it, and what decided a tie', () => {
    const season = result({
      winners: ['ann'],
      seasonEnd: true,
      tiebreak: 'realWorld',
      round: 25,
      standings: [standing('ann', 6, { measures: [812e6, 1, 1] }), standing('bo', 6, { measures: [640e6, 1, 1] })],
    });
    expect(finaleText(season, 'ann', nameOf)).toMatchObject({
      label: 'Campaign over · round 25, the last',
      line: 'Round 25 was the last, and the most points won, then the larger population: 812M to 640M.',
      place: null,
    });
    expect(finaleText(season, 'bo', nameOf).place).toBe('You finished 2nd with 6 victory points.');
  });

  it('says when the host ended it before the last round', () => {
    const early = result({
      winners: ['ann'],
      seasonEnd: true,
      endedEarly: true,
      tiebreak: 'realWorld',
      round: 8,
      standings: [standing('ann', 4), standing('bo', 2)],
    });
    expect(finaleText(early, 'bo', nameOf)).toMatchObject({
      label: 'Campaign over · round 8',
      line: 'The host ended the campaign in round 8, and the most points won.',
      place: 'You finished 2nd with 2 victory points.',
    });
  });

  it('says when a finished campaign is deleted', () => {
    expect(deletionText('2026-10-14T12:00:00Z')).toBe(
      'The campaign and its results are deleted for everyone on Wednesday 14 October.',
    );
  });

  it('is remembered once it has played', () => {
    expect(finaleSeen('c1', 'ann')).toBe(false);
    markFinaleSeen('c1', 'ann');
    expect(finaleSeen('c1', 'ann')).toBe(true);
    expect(finaleSeen('c1', 'bo')).toBe(false);
    expect(finaleSeen('c2', 'ann')).toBe(false);
  });

  it('lists names in a sentence', () => {
    expect([listNames([]), listNames(['Ann']), listNames(['Ann', 'Bo']), listNames(['Ann', 'Bo', 'Cy'])]).toEqual([
      '',
      'Ann',
      'Ann and Bo',
      'Ann, Bo and Cy',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Honors and totals, from the records of a short campaign on the line map (A9 B5 C3 D7 E2 F1).

const idx = indexDataset(lineDataset());

const tally = (t: Partial<WarTally> = {}): WarTally => ({
  won: 0,
  lost: 0,
  drawn: 0,
  tribute: 0,
  settled: 0,
  withdrawn: 0,
  opponentBackedDown: 0,
  backedDown: 0,
  cancelled: 0,
  underway: 0,
  ...t,
});
const change = (territoryId: string, otherId: string) => ({
  territoryId,
  warId: 'w',
  round: 1,
  otherId,
  via: 'war' as const,
});
const record = (r: Partial<WarRecord> = {}): WarRecord => ({
  attacking: tally(),
  defending: tally(),
  tokensTaken: 0,
  tokensPaid: 0,
  gained: [],
  lost: [],
  ...r,
});
const line = (gameId: string, g: Partial<GameLine>): GameLine => ({
  gameId,
  warId: 'w',
  opponentId: 'bo',
  color: 'white',
  armageddon: false,
  result: 'won',
  reason: 'checkmate',
  moves: 20,
  opening: null,
  finishedAt: `2026-10-0${gameId.slice(1)}T12:00:00.000Z`,
  ...g,
});
const profile = (games: GameLine[]): ChessProfile => {
  const results = { won: 0, drawn: 0, lost: 0 };
  for (const g of games) results[g.result] += 1;
  return {
    played: games.length,
    underway: 0,
    asWhite: results,
    asBlack: { won: 0, drawn: 0, lost: 0 },
    endings: {},
    averageMoves: null,
    openings: [],
    games,
  };
};
const accords = (a: Partial<AccordTally> = {}): AccordTally => ({
  signed: 0,
  kept: 0,
  broken: 0,
  betrayed: 0,
  inForce: 0,
  ...a,
});
const empire = (userId: string, e: Partial<EmpireRecordView>): EmpireRecordView => ({
  userId,
  wars: record(),
  accords: accords(),
  chess: profile([]),
  ...e,
});
const member = (userId: string, reputation = 100) => ({ userId, name: nameOf(userId), reputation }) as MemberView;

/**
 * Records shaped for the honors rather than one consistent campaign. Ann took A, then D, E and F
 * from Bo, lost C to Cy, mated Bo in 9, won in 30 and in 1 by resignation, and lost a 61-move
 * game to Cy; Bo repelled two attacks (one a draw) and broke an accord. A game over the board has
 * no moves to count.
 */
const stats: CampaignStats = {
  history: {
    points: [],
    wars: [
      {
        warId: 'w1',
        round: 1,
        attackerId: 'ann',
        defenderId: 'bo',
        outcome: 'attacker',
        transfers: [{ territoryId: 'A', from: 'bo', to: 'ann' }],
      },
      {
        warId: 'w2',
        round: 2,
        attackerId: 'ann',
        defenderId: 'bo',
        outcome: 'attacker',
        transfers: [
          { territoryId: 'D', from: 'bo', to: 'ann' },
          { territoryId: 'E', from: 'bo', to: 'ann' },
          { territoryId: 'F', from: 'bo', to: 'ann' },
        ],
      },
      {
        warId: 'w3',
        round: 2,
        attackerId: 'ann',
        defenderId: 'cy',
        outcome: 'defender',
        transfers: [{ territoryId: 'C', from: 'ann', to: 'cy' }],
      },
    ],
  },
  empires: [
    empire('ann', {
      wars: record({
        attacking: tally({ won: 2, lost: 1 }),
        gained: [change('A', 'bo'), change('D', 'bo'), change('E', 'bo'), change('F', 'bo')],
      }),
      accords: accords({ signed: 1 }),
      chess: profile([
        line('g1', { moves: 9 }),
        line('g2', { moves: 30, reason: 'resignation' }),
        // Bo gave up a war at once: no swift strike.
        line('g5', { moves: 1, reason: 'resignation' }),
        line('g3', { opponentId: 'cy', result: 'lost', moves: 61 }),
        line('g4', { opponentId: 'cy', result: 'won', reason: 'over-the-board', moves: 0 }),
      ]),
    }),
    empire('bo', {
      wars: record({ defending: tally({ lost: 2, drawn: 1, won: 1 }) }),
      accords: accords({ signed: 1, broken: 1 }),
      chess: profile([
        line('g1', { opponentId: 'ann', color: 'black', result: 'lost', moves: 9 }),
        line('g2', { opponentId: 'ann', color: 'black', result: 'lost', moves: 30, reason: 'resignation' }),
        line('g5', { opponentId: 'ann', color: 'black', result: 'lost', moves: 1, reason: 'resignation' }),
      ]),
    }),
    empire('cy', {
      wars: record({ defending: tally({ won: 1 }), gained: [change('C', 'ann')] }),
      chess: profile([
        line('g3', { opponentId: 'ann', color: 'black', result: 'won', moves: 61 }),
        line('g4', { opponentId: 'ann', color: 'black', result: 'lost', reason: 'over-the-board', moves: 0 }),
      ]),
    }),
  ],
  acquisitions: {},
};

describe('honors', () => {
  const honors = honorsOf({
    stats,
    idx,
    members: [member('ann', 100), member('bo', 80), member('cy', 104)],
    nameOf,
    countryName: (id) => `Land ${id}`,
  });
  const honor = (key: string) => honors.find((h) => h.key === key);

  it('go to whoever leads each record, in a fixed order', () => {
    expect(honors.map((h) => [h.key, h.holders, h.figure])).toEqual([
      ['conqueror', ['ann'], '4 countries taken'],
      ['warlord', ['ann'], '2 wars won'],
      // A draw holds the country, so it counts as an attack repelled.
      ['bulwark', ['bo'], '2 attacks repelled'],
      // D, E and F in one war, worth more than A in another.
      ['spoils', ['ann'], 'Land D and 2 more, worth 10'],
      // Four wins in five games, the one over the board included.
      ['grandmaster', ['ann'], '80% score'],
      ['swift', ['ann'], 'Mate in 9 against Bo'],
      ['marathon', ['ann', 'cy'], '61 moves'],
      ['warmonger', ['ann'], '3 wars declared'],
      ['diplomat', ['cy'], 'Reputation 104'],
      ['oathbreaker', ['bo'], '1 accord broken'],
    ]);
    expect(honor('conqueror')).toMatchObject({ name: 'Conqueror', what: 'Most countries taken' });
  });

  it('are shared by players level on a record', () => {
    const level = {
      ...stats,
      empires: stats.empires.map((e) =>
        e.userId === 'cy' ? { ...e, wars: record({ defending: tally({ won: 2 }) }) } : e,
      ),
    };
    const bulwark = honorsOf({
      stats: level,
      idx,
      members: [member('ann'), member('bo'), member('cy')],
      nameOf,
      countryName: (id) => id,
    }).find((h) => h.key === 'bulwark');
    expect(bulwark?.holders).toEqual(['bo', 'cy']);
  });

  it('leave out what nobody earned', () => {
    const quiet = honorsOf({
      stats: {
        ...stats,
        history: { points: [], wars: [stats.history.wars[0]!] },
        empires: stats.empires.map((e) => ({ ...e, accords: accords(), chess: profile([]) })),
      },
      idx,
      members: [member('ann'), member('bo'), member('cy')],
      nameOf,
      countryName: (id) => `Land ${id}`,
    });
    expect(quiet.find((h) => h.key === 'spoils')?.figure).toBe('Land A, worth 9');
    // No games, equal reputations and no broken accords: no chess honors, no Diplomat, no Oathbreaker.
    expect(quiet.map((h) => h.key)).toEqual(['conqueror', 'warlord', 'bulwark', 'spoils', 'warmonger']);
  });

  it('need two games for a chess score', () => {
    const one = honorsOf({
      stats: {
        ...stats,
        empires: stats.empires.map((e) => ({ ...e, chess: profile(e.chess.games.slice(0, 1)) })),
      },
      idx,
      members: [member('ann'), member('bo'), member('cy')],
      nameOf,
      countryName: (id) => id,
    });
    expect(one.some((h) => h.key === 'grandmaster')).toBe(false);
  });
});

describe('campaign totals', () => {
  it('count every war, game and accord once', () => {
    expect(campaignTotals(stats, 12)).toEqual({
      rounds: 12,
      wars: 3,
      countries: 5,
      battles: 5,
      checkmates: 2,
      moves: 101,
      accordsSigned: 1,
      accordsBroken: 1,
    });
  });
});
