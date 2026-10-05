import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseRules } from '../config';
import { activeWar, type WarBoard } from '../war';
import { claimBlockers, possibleTransfers, type OpenWar } from './blockers';
import type { MissionSpec } from './catalog';
import {
  claimEligibleRound,
  claimTimeServed,
  claimTurnsServed,
  compareSeason,
  holdMs,
  holdsByTurns,
  seasonDecider,
  seasonMeasures,
  seasonWinners,
  selectionMs,
  victoryWinners,
} from './claims';
import { all, buildMap, makeWorld } from './test-maps';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';

/**
 * Ann's positions P1..P5 run along a chain with Bo's B1..B3 and Cy's C1 alongside:
 *   P1 - P2 - P3 - P4 - P5
 *   |    |    |         |
 *   B1   B2   B3        C1
 * Values: P 3, X 5 (Ann's big country beside B1), B 3, C 3.
 */
const idx = buildMap({
  P1: { v: 3, land: ['P2', 'B1', 'X'] },
  P2: { v: 3, land: ['P3', 'B2'] },
  P3: { v: 3, land: ['P4', 'B3'] },
  P4: { v: 3, land: ['P5'] },
  P5: { v: 3, land: ['C1'] },
  X: { v: 5, land: ['B1'] },
  B1: { v: 3, land: ['B2'] },
  B2: { v: 3, land: ['B3'] },
  B3: { v: 3 },
  C1: { v: 3, land: ['B3'] },
});
const positions: MissionSpec = { kind: 'strategic_positions', territories: ['P1', 'P2', 'P3', 'P4', 'P5'], need: 3 };

/** The original game's answers: a free raise, redirects anywhere, and tribute. */
const ORIGINAL = { ...DEFAULT_RULES, war: parseRules({}).war };

function board(owners: Record<string, string>, wars: OpenWar[], rules = DEFAULT_RULES): WarBoard {
  return {
    idx,
    rules,
    round: 3,
    holdings: new Map(Object.entries(owners).map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
    wars: wars.map((w) => activeWar(w)),
    truces: [],
    accords: [],
    renunciations: [],
  };
}

const fought = (id: string, attackerId: string, defenderId: string, targetId: string, stake: string[]): OpenWar => ({
  id,
  attackerId,
  defenderId,
  targetId,
  launchId: stake[0]!,
  stake,
  status: 'playing',
  counter: null,
});

describe('possible outcomes of a war', () => {
  const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'P4', 'P5', 'X'), ...all(BO, 'B1', 'B2', 'B3'), C1: CY };

  it('a game underway: the target, the stake, or nothing', () => {
    const w = fought('w1', BO, ANN, 'P2', ['B2']);
    expect(possibleTransfers(board(owners, [w]), w)).toEqual([
      [],
      [{ territoryId: 'P2', from: ANN, to: BO }],
      [{ territoryId: 'B2', from: BO, to: ANN }],
    ]);
  });

  it('a declaration not yet answered: also every redirect and tribute the defender may offer', () => {
    const w: OpenWar = { ...fought('w1', BO, ANN, 'X', ['B1']), status: 'declared' };
    const outcomes = possibleTransfers(board(owners, [w], ORIGINAL), w).map((t) =>
      t.map((x) => x.territoryId).join(','),
    );
    // Tribute: any of Ann's countries worth less than X (5). A raise could stake all of Bo's connected countries.
    expect(outcomes).toEqual(expect.arrayContaining(['', 'X', 'B1', 'P1', 'P5', 'B1,B2,B3']));
  });

  it('a declaration not yet answered, with the revised answers: any country a matched raise could put in', () => {
    const w: OpenWar = { ...fought('w1', BO, ANN, 'X', ['B1']), status: 'declared' };
    const outcomes = possibleTransfers(board(owners, [w]), w).map((t) => t.map((x) => x.territoryId).join(','));
    // A matched raise puts in one of Ann's countries worth no more than X (5) or than Bo could still
    // add (B2 and B3, 6), taken with X if Bo wins. With raises back and forth, Ann may put in more
    // after Bo raises again: every one at once stands for those. No tribute: peace terms need Ann's
    // agreement.
    expect(outcomes).toEqual(['', 'X', 'B1', 'B1,B2,B3', 'X,P1', 'X,P2', 'X,P3', 'X,P4', 'X,P5', 'X,P1,P2,P3,P4,P5']);
    // With a single raise, as campaigns stored before play, only the first.
    const single = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, raises: 1 } };
    expect(possibleTransfers(board(owners, [w], single), w).map((t) => t.map((x) => x.territoryId).join(','))).toEqual([
      '',
      'X',
      'B1',
      'B1,B2,B3',
      'X,P1',
      'X,P2',
      'X,P3',
      'X,P4',
      'X,P5',
    ]);
  });

  it('a raise waiting on the attacker, with raises left: backing down, and another country from Ann', () => {
    const w: OpenWar = {
      ...fought('w1', BO, ANN, 'X', ['B1']),
      status: 'countered',
      counter: { kind: 'raise', minValue: 4, added: 'P3' },
    };
    const outcomes = possibleTransfers(board(owners, [w]), w).map((t) => t.map((x) => x.territoryId).join(','));
    // Bo meets it and fights for X and P3, or raises again and Ann puts in one more country worth 3
    // or more, or yields X; Bo may forfeit B1 after raising, or stake everything.
    expect(outcomes).toEqual(['', 'X,P3', 'B1,B2,B3', 'X', 'B1', 'X,P3,P1', 'X,P3,P2', 'X,P3,P4', 'X,P3,P5']);
  });

  it('a raise waiting on the defender: the country they put in, or the target alone', () => {
    const w: OpenWar = {
      ...fought('w1', BO, ANN, 'X', ['B1', 'B2']),
      status: 'countered',
      counter: {
        kind: 'raise',
        minValue: 4,
        added: 'P3',
        declared: ['B1'],
        steps: [{ by: 'attacker', stake: ['B1', 'B2'], more: 3 }],
      },
    };
    const outcomes = possibleTransfers(board(owners, [w]), w).map((t) => t.map((x) => x.territoryId).join(','));
    expect(outcomes).toEqual(['', 'X,P3', 'B1,B2,B3', 'X', 'B1', 'X,P3,P1', 'X,P3,P2', 'X,P3,P4', 'X,P3,P5']);
    // Once the last raise is made the attacker can only meet it or back down.
    const last: OpenWar = {
      ...w,
      counter: {
        kind: 'raise',
        minValue: 8,
        added: 'P3',
        declared: ['B1'],
        steps: [
          { by: 'attacker', stake: ['B1', 'B2'], more: 3 },
          { by: 'defender', territoryId: 'P5', more: 2 },
        ],
      },
    };
    expect(possibleTransfers(board(owners, [last]), last).map((t) => t.map((x) => x.territoryId).join(','))).toEqual([
      '',
      'X,P3,P5',
      'B1,B2,B3',
      'X',
      'B1',
    ]);
  });

  it('a met matched raise: the added country is at stake with the target', () => {
    const w: OpenWar = {
      ...fought('w1', BO, ANN, 'X', ['B1', 'B2']),
      counter: { kind: 'raise', minValue: 9, added: 'P1' },
    };
    const outcomes = possibleTransfers(board(owners, [w]), w).map((t) => t.map((x) => x.territoryId).join(','));
    expect(outcomes).toEqual(['', 'X,P1', 'B1,B2']);
  });
});

describe('claim blockers', () => {
  it('ignores wars the player is not in, and wars that cannot touch the positions', () => {
    const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'X'), ...all(BO, 'P4', 'B1', 'B2', 'B3'), ...all(CY, 'P5', 'C1') };
    const world = makeWorld(idx, owners);
    const elsewhere = fought('w-bo-cy', CY, BO, 'B3', ['C1']);
    const onX = fought('w-x', BO, ANN, 'X', ['B1']);
    const wars = [elsewhere, onX];
    expect(claimBlockers(world, board(owners, wars), ANN, positions, wars)).toEqual([]);
  });

  it('blocks on a war that could take a position the claim needs', () => {
    const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'X'), ...all(BO, 'P4', 'B1', 'B2', 'B3'), ...all(CY, 'P5', 'C1') };
    const onP2 = fought('w-p2', BO, ANN, 'P2', ['B2']);
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [onP2]), ANN, positions, [onP2])).toEqual(['w-p2']);
    // Attacking with a position at stake risks it too.
    const staking = fought('w-stake', ANN, BO, 'B3', ['P3']);
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [staking]), ANN, positions, [staking])).toEqual([
      'w-stake',
    ]);
  });

  it('names only the wars whose outcome matters, not ones fought alongside', () => {
    const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'X'), ...all(BO, 'P4', 'B1', 'B2', 'B3'), ...all(CY, 'P5', 'C1') };
    const onP2 = fought('w-p2', BO, ANN, 'P2', ['B2']);
    const fromX = fought('w-x', ANN, BO, 'B1', ['X']);
    const wars = [onP2, fromX];
    expect(claimBlockers(makeWorld(idx, owners), board(owners, wars), ANN, positions, wars)).toEqual(['w-p2']);
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [fromX]), ANN, positions, [fromX])).toEqual([]);
  });

  it('lets a spare position cover a single threat, but not two at once', () => {
    const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'P4', 'X'), ...all(BO, 'B1', 'B2', 'B3'), ...all(CY, 'P5', 'C1') };
    const onP2 = fought('w-p2', BO, ANN, 'P2', ['B2']);
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [onP2]), ANN, positions, [onP2])).toEqual([]);
    const onP3 = fought('w-p3', BO, ANN, 'P3', ['B3']);
    const both = [onP2, onP3];
    expect(claimBlockers(makeWorld(idx, owners), board(owners, both), ANN, positions, both)).toEqual(['w-p2', 'w-p3']);
  });

  it('treats an unanswered declaration conservatively: a position could be offered as tribute', () => {
    const owners = { ...all(ANN, 'P1', 'P2', 'P3', 'X'), ...all(BO, 'P4', 'B1', 'B2', 'B3'), ...all(CY, 'P5', 'C1') };
    const onX: OpenWar = { ...fought('w-x', BO, ANN, 'X', ['B1']), status: 'declared' };
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [onX]), ANN, positions, [onX])).toEqual(['w-x']);
    // Once accepted, only X is at risk, which the positions don't need.
    const accepted = { ...onX, status: 'playing' as const };
    expect(claimBlockers(makeWorld(idx, owners), board(owners, [accepted]), ANN, positions, [accepted])).toEqual([]);
  });

  it('counts gains too: winning the center would break an encirclement', () => {
    const ring = buildMap({ C: { v: 5, land: ['R1', 'R2'] }, R1: { v: 2, land: ['R2'] }, R2: { v: 2 } });
    const owners = { ...all(ANN, 'R1', 'R2'), C: BO };
    const spec: MissionSpec = { kind: 'encirclement', center: 'C', ring: ['R1', 'R2'] };
    const attack: OpenWar = {
      id: 'w-c',
      attackerId: ANN,
      defenderId: BO,
      targetId: 'C',
      launchId: 'R1',
      stake: ['R1'],
      status: 'playing',
      counter: null,
    };
    const b: WarBoard = { ...board(owners, [attack]), idx: ring };
    expect(claimBlockers(makeWorld(ring, owners), b, ANN, spec, [attack])).toEqual(['w-c']);
  });
});

describe('claim timing', () => {
  it('scores from the start of the round after next, once the time is up', () => {
    expect(claimEligibleRound(3)).toBe(5);
    const claim = { startedRound: 3, eligibleAt: null };
    expect(claimTimeServed(claim, 5, 1_000)).toBe(false);
    const timed = { startedRound: 3, eligibleAt: 10_000 };
    expect(claimTimeServed(timed, 4, 20_000)).toBe(false);
    expect(claimTimeServed(timed, 5, 9_999)).toBe(false);
    expect(claimTimeServed(timed, 5, 10_000)).toBe(true);
  });

  it('held by turns, scores from the round after next once declaring has ended in a later round', () => {
    // Declaring hasn't ended since the claim started in round 3.
    expect(claimTurnsServed(3, 5, null)).toBe(false);
    expect(claimTurnsServed(3, 5, 3)).toBe(false);
    // Round 4's declaring ran to its end: round 5 scores it, round 4 doesn't.
    expect(claimTurnsServed(3, 4, 4)).toBe(false);
    expect(claimTurnsServed(3, 5, 4)).toBe(true);
    // The host started round 5 before round 4's declaring was over: it waits for round 5's.
    expect(claimTurnsServed(3, 5, 3)).toBe(false);
    expect(claimTurnsServed(3, 5, 5)).toBe(true);
  });

  it('holds by turns only where players declare in turns', () => {
    expect(holdsByTurns(DEFAULT_RULES)).toBe(true);
    expect(holdsByTurns({ ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, turns: false } })).toBe(false);
    expect(holdsByTurns({ ...DEFAULT_RULES, victory: { ...DEFAULT_RULES.victory, hold: 'time' } })).toBe(false);
  });

  it('holds for 10 minutes live and 24 hours by correspondence unless the host set otherwise', () => {
    const live = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, pace: 'live' as const } };
    expect(holdMs(live)).toBe(10 * 60_000);
    expect(holdMs(DEFAULT_RULES)).toBe(24 * 3_600_000);
    expect(holdMs({ ...live, victory: { ...live.victory, holdMinutes: 30 } })).toBe(30 * 60_000);
    expect(selectionMs(live)).toBe(5 * 60_000);
    expect(selectionMs(DEFAULT_RULES)).toBe(24 * 3_600_000);
  });
});

describe('winners', () => {
  it('is nobody below the target', () => {
    expect(victoryWinners(new Map([[ANN, 6]]), 7)).toEqual([]);
  });

  it('goes to the highest total among players crossing together', () => {
    expect(
      victoryWinners(
        new Map([
          [BO, 7],
          [ANN, 9],
          [CY, 4],
        ]),
        7,
      ),
    ).toEqual([ANN]);
  });

  it('is shared on equal totals, whatever the order', () => {
    const points = new Map([
      [CY, 8],
      [ANN, 8],
      [BO, 7],
    ]);
    expect(victoryWinners(points, 7)).toEqual([ANN, CY]);
    expect(victoryWinners(new Map([...points].reverse()), 7)).toEqual([ANN, CY]);
  });
});

describe('the end of the season', () => {
  const world = buildMap({
    // Same value everywhere, so only the real-world figures tell the empires apart.
    BIG: { v: 3, people: 50_000_000, area: 100_000, gdp: 1e11 },
    WIDE: { v: 3, people: 50_000_000, area: 900_000, gdp: 1e10 },
    RICH: { v: 3, people: 50_000_000, area: 100_000, gdp: 9e11 },
    SMALL: { v: 5, people: 2_000_000, area: 10_000 },
  });
  const standing = (points: number, held: string[], tiebreak: 'value' | 'realWorld' = 'realWorld') => ({
    points,
    measures: seasonMeasures(world, held, tiebreak),
  });

  it('measures population, then land area, then GDP, or the game value', () => {
    expect(seasonMeasures(world, ['BIG', 'SMALL'], 'realWorld')).toEqual([52_000_000, 110_000, 1e11]);
    expect(seasonMeasures(world, ['BIG', 'SMALL'], 'value')).toEqual([8]);
  });

  it('goes to the most points, whatever the tiebreak says', () => {
    const standings = new Map([
      [ANN, standing(5, ['SMALL'])],
      [BO, standing(4, ['BIG', 'WIDE', 'RICH'])],
    ]);
    expect(seasonWinners(standings)).toEqual([ANN]);
    expect(seasonDecider(standings.get(ANN)!, standings.get(BO)!)).toBeNull();
  });

  it('breaks a tie on points by population first', () => {
    const standings = new Map([
      [ANN, standing(4, ['WIDE'])],
      [BO, standing(4, ['BIG', 'SMALL'])],
      [CY, standing(2, ['RICH'])],
    ]);
    expect(seasonWinners(standings)).toEqual([BO]);
    expect(seasonDecider(standings.get(BO)!, standings.get(ANN)!)).toBe(0);
  });

  it('then by land area, then by GDP', () => {
    const wide = new Map([
      [ANN, standing(4, ['BIG'])],
      [BO, standing(4, ['WIDE'])],
    ]);
    expect(seasonWinners(wide)).toEqual([BO]);
    expect(seasonDecider(wide.get(ANN)!, wide.get(BO)!)).toBe(1);

    const rich = new Map([
      [ANN, standing(4, ['BIG'])],
      [BO, standing(4, ['RICH'])],
    ]);
    expect(seasonWinners(rich)).toEqual([BO]);
    expect(seasonDecider(rich.get(ANN)!, rich.get(BO)!)).toBe(2);
  });

  it('is shared by players level on points and every measure', () => {
    const standings = new Map([
      [CY, standing(4, ['BIG'])],
      [ANN, standing(4, ['BIG'])],
      [BO, standing(3, ['WIDE'])],
    ]);
    expect(seasonWinners(standings)).toEqual([ANN, CY]);
    expect(seasonDecider(standings.get(ANN)!, standings.get(CY)!)).toBeNull();
  });

  it('keeps the most valuable empire for campaigns stored with that tiebreak', () => {
    const standings = new Map([
      [ANN, standing(4, ['SMALL'], 'value')],
      [BO, standing(4, ['BIG'], 'value')],
    ]);
    expect(seasonWinners(standings)).toEqual([ANN]);
    expect(parseRules({ victory: { mode: 'objectives' } }).victory.tiebreak).toBe('value');
    expect(DEFAULT_RULES.victory.tiebreak).toBe('realWorld');
  });

  it('sorts standings most points first, then by the tiebreak', () => {
    const sorted = [standing(4, ['BIG']), standing(5, ['SMALL']), standing(4, ['WIDE'])].sort(compareSeason);
    expect(sorted.map((s) => s.measures[1])).toEqual([10_000, 900_000, 100_000]);
  });
});
