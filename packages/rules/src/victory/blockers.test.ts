import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../config';
import type { WarBoard } from '../war';
import { claimBlockers, possibleTransfers, type OpenWar } from './blockers';
import type { MissionSpec } from './catalog';
import { claimEligibleRound, claimTimeServed, holdMs, selectionMs, victoryWinners } from './claims';
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

function board(owners: Record<string, string>, wars: OpenWar[]): WarBoard {
  return {
    idx,
    rules: DEFAULT_RULES,
    round: 3,
    holdings: new Map(Object.entries(owners).map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
    wars: wars.map((w) => ({
      id: w.id,
      attackerId: w.attackerId,
      defenderId: w.defenderId,
      targetId: w.targetId,
      stake: w.stake,
      offered: null,
    })),
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
    const outcomes = possibleTransfers(board(owners, [w]), w).map((t) => t.map((x) => x.territoryId).join(','));
    // Tribute: any of Ann's countries worth less than X (5). A raise could stake all of Bo's connected countries.
    expect(outcomes).toEqual(expect.arrayContaining(['', 'X', 'B1', 'P1', 'P5', 'B1,B2,B3']));
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
