import { describe, expect, it } from 'vitest';
import { indexDataset } from './graph';
import {
  accordTally,
  acquisitions,
  chessProfile,
  empireHistory,
  resultFor,
  warRecord,
  type GameFacts,
  type Resolution,
  type WarFacts,
} from './stats';
import { lineDataset } from './test-fixtures';

/** A9 - B5 - C3 ~ D7 - E2 - F1 */
const idx = indexDataset(lineDataset());
const ANN = 'ann';
const BO = 'bo';
const members = [ANN, BO];

/**
 * The draft gives Ann A and B (14) and Bo C to F (13). Round 1: Bo attacks from C and loses it.
 * Round 2: a drawn war, then Bo buys peace with F. Round 3 is underway.
 */
const resolutions: Resolution[] = [
  {
    warId: 'w1',
    round: 1,
    attackerId: BO,
    defenderId: ANN,
    outcome: 'defender',
    transfers: [{ territoryId: 'C', from: BO, to: ANN }],
    tokens: 0,
  },
  { warId: 'w2', round: 2, attackerId: ANN, defenderId: BO, outcome: 'held', transfers: [], tokens: 0 },
  {
    warId: 'w3',
    round: 2,
    attackerId: ANN,
    defenderId: BO,
    outcome: 'tribute',
    transfers: [{ territoryId: 'F', from: BO, to: ANN }],
    tokens: 1,
  },
];
const holdings = new Map([
  ['A', ANN],
  ['B', ANN],
  ['C', ANN],
  ['F', ANN],
  ['D', BO],
  ['E', BO],
]);

describe('empire history', () => {
  it('gives value and country count at the end of each round, back to the draft', () => {
    const history = empireHistory(idx, members, holdings, 3, resolutions);
    expect(history.points.map((p) => [p.round, p.value[ANN], p.value[BO]])).toEqual([
      [0, 14, 13],
      [1, 17, 10],
      [2, 18, 9],
      [3, 18, 9],
    ]);
    expect(history.points.map((p) => [p.countries[ANN], p.countries[BO]])).toEqual([
      [2, 4],
      [3, 3],
      [4, 2],
      [4, 2],
    ]);
  });

  it('marks only the wars that moved territory', () => {
    const { wars } = empireHistory(idx, members, holdings, 3, resolutions);
    expect(wars.map((w) => [w.warId, w.round, w.outcome])).toEqual([
      ['w1', 1, 'defender'],
      ['w3', 2, 'tribute'],
    ]);
  });

  it('undoes a round’s wars newest first', () => {
    // C changes hands twice in round 1: Bo loses it defending, then wins it back attacking.
    const back: Resolution[] = [
      resolutions[0]!,
      {
        warId: 'w4',
        round: 1,
        attackerId: BO,
        defenderId: ANN,
        outcome: 'attacker',
        transfers: [{ territoryId: 'C', from: ANN, to: BO }],
        tokens: 0,
      },
    ];
    const now = new Map([...holdings, ['C', BO], ['F', BO]]);
    const history = empireHistory(idx, members, now, 1, back);
    expect(history.points.map((p) => p.value[BO])).toEqual([13, 13]);
  });

  it('follows a country through several rounds', () => {
    // C goes to Ann in round 1 and back to Bo in round 3.
    const later: Resolution[] = [
      ...resolutions,
      {
        warId: 'w5',
        round: 3,
        attackerId: BO,
        defenderId: ANN,
        outcome: 'attacker',
        transfers: [{ territoryId: 'C', from: ANN, to: BO }],
        tokens: 0,
      },
    ];
    const now = new Map([...holdings, ['C', BO]]);
    const history = empireHistory(idx, members, now, 3, later);
    expect(history.points.map((p) => [p.value[ANN], p.value[BO]])).toEqual([
      [14, 13],
      [17, 10],
      [18, 9],
      [15, 12],
    ]);
    expect(acquisitions(now, new Map(), later).C).toEqual({ via: 'war', warId: 'w5', round: 3, from: ANN });
  });

  it('is a single point while the draft runs', () => {
    const drafting = new Map([['A', ANN]]);
    expect(empireHistory(idx, members, drafting, 0, []).points).toEqual([
      { round: 0, value: { ann: 9, bo: 0 }, countries: { ann: 1, bo: 0 } },
    ]);
  });
});

describe('acquisitions', () => {
  it('name the war, the tribute or the draft pick behind each country', () => {
    const picks = new Map([
      ['A', 0],
      ['D', 3],
    ]);
    const got = acquisitions(holdings, picks, resolutions);
    expect(got.A).toEqual({ via: 'draft', pick: 0 });
    expect(got.B).toEqual({ via: 'draft', pick: null });
    expect(got.C).toEqual({ via: 'war', warId: 'w1', round: 1, from: BO });
    expect(got.F).toEqual({ via: 'tribute', warId: 'w3', round: 2, from: BO });
    expect(got.D).toEqual({ via: 'draft', pick: 3 });
  });

  it('fall back to the draft when the log disagrees with the map', () => {
    const moved = new Map([['C', BO]]);
    expect(acquisitions(moved, new Map(), resolutions).C).toEqual({ via: 'draft', pick: null });
  });
});

describe('war record', () => {
  const wars: WarFacts[] = [
    { attackerId: BO, defenderId: ANN, status: 'resolved', outcome: 'defender' },
    { attackerId: ANN, defenderId: BO, status: 'resolved', outcome: 'held' },
    { attackerId: ANN, defenderId: BO, status: 'resolved', outcome: 'tribute' },
    { attackerId: ANN, defenderId: BO, status: 'resolved', outcome: 'attacker' },
    { attackerId: ANN, defenderId: BO, status: 'resolved', outcome: 'withdrawn' },
    { attackerId: BO, defenderId: ANN, status: 'playing', outcome: null },
  ];

  it('counts wars by side and outcome', () => {
    const ann = warRecord(ANN, wars, resolutions);
    expect(ann.attacking).toEqual({
      won: 1,
      lost: 0,
      drawn: 1,
      tribute: 1,
      settled: 0,
      withdrawn: 1,
      cancelled: 0,
      underway: 0,
    });
    expect(ann.defending).toEqual({
      won: 1,
      lost: 0,
      drawn: 0,
      tribute: 0,
      settled: 0,
      withdrawn: 0,
      cancelled: 0,
      underway: 1,
    });
    const bo = warRecord(BO, wars, resolutions);
    expect(bo.attacking).toEqual({
      won: 0,
      lost: 1,
      drawn: 0,
      tribute: 0,
      settled: 0,
      withdrawn: 0,
      cancelled: 0,
      underway: 1,
    });
    expect(bo.defending).toEqual({
      won: 0,
      lost: 1,
      drawn: 1,
      tribute: 1,
      settled: 0,
      withdrawn: 1,
      cancelled: 0,
      underway: 0,
    });
  });

  it('lists countries won and lost, and tribute tokens', () => {
    const ann = warRecord(ANN, wars, resolutions);
    expect(ann.gained).toEqual([
      { territoryId: 'C', warId: 'w1', round: 1, via: 'war', otherId: BO },
      { territoryId: 'F', warId: 'w3', round: 2, via: 'tribute', otherId: BO },
    ]);
    expect(ann.lost).toEqual([]);
    expect([ann.tokensTaken, ann.tokensPaid]).toEqual([1, 0]);
    const bo = warRecord(BO, wars, resolutions);
    expect(bo.lost.map((c) => c.territoryId)).toEqual(['C', 'F']);
    expect([bo.tokensTaken, bo.tokensPaid]).toEqual([0, 1]);
  });

  it('counts peace terms: settled wars, countries handed over and tokens either way', () => {
    const terms = { toAttacker: [], toDefender: ['E'], tokensToAttacker: 0, tokensToDefender: 2, accordRounds: 3 };
    const settled: Resolution = {
      warId: 'w9',
      round: 4,
      attackerId: ANN,
      defenderId: BO,
      outcome: 'settled',
      transfers: [{ territoryId: 'E', from: ANN, to: BO }],
      tokens: 0,
      terms,
    };
    const facts: WarFacts[] = [{ attackerId: ANN, defenderId: BO, status: 'resolved', outcome: 'settled' }];
    const ann = warRecord(ANN, facts, [settled]);
    expect(ann.attacking.settled).toBe(1);
    expect(ann.lost).toEqual([{ territoryId: 'E', warId: 'w9', round: 4, via: 'peace', otherId: BO }]);
    expect([ann.tokensTaken, ann.tokensPaid]).toEqual([0, 2]);
    const bo = warRecord(BO, facts, [settled]);
    expect(bo.defending.settled).toBe(1);
    expect([bo.tokensTaken, bo.tokensPaid]).toEqual([2, 0]);
    expect(acquisitions(new Map([['E', BO]]), new Map(), [settled]).E).toEqual({
      via: 'peace',
      warId: 'w9',
      round: 4,
      from: ANN,
    });
  });
});

describe('accord tally', () => {
  it('counts signed accords only, and who broke them', () => {
    const accord = (status: string, brokenBy: string | null = null, recipientId = BO) =>
      ({ proposerId: ANN, recipientId, status, brokenBy }) as const;
    const accords = [
      accord('kept'),
      accord('kept', null, 'cy'),
      accord('broken', ANN),
      accord('broken', BO),
      accord('renewed'),
      accord('active'),
      accord('proposed'),
      accord('declined'),
      accord('lapsed'),
      accord('withdrawn'),
    ].map((a) => ({ ...a, status: a.status as never }));
    expect(accordTally(ANN, accords)).toEqual({ signed: 6, kept: 2, broken: 1, betrayed: 1, inForce: 1 });
    expect(accordTally(BO, accords)).toEqual({ signed: 5, kept: 1, broken: 1, betrayed: 1, inForce: 1 });
  });
});

describe('chess profile', () => {
  const italian = { eco: 'C50', name: 'Italian Game: Giuoco Piano' };
  const sicilian = { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' };
  const game = (id: string, over: Partial<GameFacts>): GameFacts => ({
    id,
    warId: `war-${id}`,
    whiteId: ANN,
    blackId: BO,
    armageddon: false,
    status: 'finished',
    result: '1-0',
    reason: 'checkmate',
    plies: 20,
    finishedAt: `2026-09-0${id}T12:00:00.000Z`,
    opening: italian,
    ...over,
  });
  const games = [
    game('1', {}),
    game('2', { result: '1/2-1/2', reason: 'agreement', plies: 41, opening: { ...italian, name: 'Italian Game' } }),
    game('3', { whiteId: BO, blackId: ANN, result: '1-0', reason: 'timeout', opening: sicilian, plies: 61 }),
    game('4', { whiteId: BO, blackId: ANN, result: '0-1', reason: 'resignation', opening: sicilian, plies: 30 }),
    game('5', { status: 'playing', result: null, reason: null, finishedAt: null }),
    game('6', { whiteId: 'cy', blackId: BO }),
  ];

  it('tallies results by colour and how games ended', () => {
    const ann = chessProfile(ANN, games);
    expect(ann.played).toBe(4);
    expect(ann.underway).toBe(1);
    expect(ann.asWhite).toEqual({ won: 1, drawn: 1, lost: 0 });
    expect(ann.asBlack).toEqual({ won: 1, drawn: 0, lost: 1 });
    expect(ann.endings).toEqual({
      checkmate: { won: 1, drawn: 0, lost: 0 },
      agreement: { won: 0, drawn: 1, lost: 0 },
      timeout: { won: 0, drawn: 0, lost: 1 },
      resignation: { won: 1, drawn: 0, lost: 0 },
    });
    // 10, 21, 31 and 15 moves.
    expect(ann.averageMoves).toBe(19.25);
  });

  it('counts games played over the board, but not their length or opening', () => {
    const otb = game('7', { reason: 'over-the-board', plies: 4, finishedAt: '2026-09-10T12:00:00.000Z' });
    const ann = chessProfile(ANN, [...games, otb]);
    expect(ann.played).toBe(5);
    expect(ann.endings['over-the-board']).toEqual({ won: 1, drawn: 0, lost: 0 });
    expect(ann.averageMoves).toBe(19.25);
    expect(ann.openings.find((o) => o.family === 'Italian Game')?.games).toBe(2);
  });

  it('groups openings into families for each colour, most played first', () => {
    expect(chessProfile(ANN, games).openings).toEqual([
      { family: 'Italian Game', color: 'white', games: 2, won: 1, drawn: 1, lost: 0 },
      { family: 'Sicilian Defense', color: 'black', games: 2, won: 1, drawn: 0, lost: 1 },
    ]);
  });

  it('lists finished games, most recent first, from the player’s side', () => {
    const lines = chessProfile(ANN, games).games;
    expect(lines.map((g) => [g.gameId, g.color, g.result, g.opponentId, g.moves])).toEqual([
      ['4', 'black', 'won', BO, 15],
      ['3', 'black', 'lost', BO, 31],
      ['2', 'white', 'drawn', BO, 21],
      ['1', 'white', 'won', BO, 10],
    ]);
    expect(chessProfile('nobody', games)).toMatchObject({ played: 0, averageMoves: null, openings: [], games: [] });
  });

  it('reads results from either side', () => {
    expect([resultFor('1-0', 'white'), resultFor('1-0', 'black'), resultFor('1/2-1/2', 'black')]).toEqual([
      'won',
      'lost',
      'drawn',
    ]);
  });
});
