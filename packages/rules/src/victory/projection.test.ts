import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../config';
import { activeWar, warTransfers, type WarBoard, type WarCounter, type WarOutcome } from '../war';
import type { OpenWar } from './blockers';
import type { MissionSpec } from './catalog';
import { evaluateMission } from './evaluate';
import {
  DECLARED_NOW_SEQ,
  claimServed,
  claimsHeldUp,
  missionWorldFrom,
  projectWar,
  type PendingClaim,
  type PlayedSlot,
  type ProjectedWar,
  type ScoreState,
  type WarEnding,
} from './projection';
import { all, buildMap, makeWorld } from './test-maps';
import type { TitleHolders } from './titles';
import type { MissionHistory } from './world';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';

/**
 *   A1 - B1 - C1
 *   |    |    |
 *   A2 - B2   |
 *   |_________|
 * Ann holds A1 and A2 (60 people), Bo B1 and B2 (55), Cy C1 (5).
 */
const idx = buildMap({
  A1: { v: 4, land: ['A2', 'B1'], people: 50 },
  A2: { v: 3, land: ['B2', 'C1'], people: 10 },
  B1: { v: 4, land: ['B2', 'C1'], people: 40 },
  B2: { v: 3, people: 15 },
  C1: { v: 3, people: 5 },
});
const OWNERS = { ...all(ANN, 'A1', 'A2'), ...all(BO, 'B1', 'B2'), C1: CY };
const ROUND = 4;

const positions = (territories: string[], need: number): MissionSpec => ({
  kind: 'strategic_positions',
  territories,
  need,
});

function scoreState(
  opts: {
    owners?: Record<string, string>;
    points?: Record<string, number>;
    titles?: TitleHolders;
    missions?: PlayedSlot[];
    claims?: PendingClaim[];
    openWars?: OpenWar[];
    history?: Partial<MissionHistory>;
    toWin?: number;
  } = {},
): ScoreState {
  const owners = opts.owners ?? OWNERS;
  const openWars = opts.openWars ?? [];
  const board: WarBoard = {
    idx,
    rules: DEFAULT_RULES,
    round: ROUND,
    holdings: new Map(Object.entries(owners).map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
    wars: openWars.map((w) => activeWar(w)),
    truces: [],
    accords: [],
    renunciations: [],
  };
  return {
    world: makeWorld(idx, owners, { baseline: OWNERS, history: opts.history, players: [ANN, BO, CY] }),
    board,
    openWars,
    points: new Map(Object.entries(opts.points ?? { [ANN]: 5, [BO]: 4, [CY]: 2 })),
    pointsToWin: opts.toWin ?? 10,
    titles: opts.titles ?? { population: ANN },
    titleKinds: ['population'],
    titlePoints: 1,
    missions: opts.missions ?? [],
    claims: opts.claims ?? [],
  };
}

/** Bo attacks A1 from B1, staking B1: an open war, and the same war as the preview reads it. */
const BO_ON_A1: OpenWar = {
  id: 'w1',
  attackerId: BO,
  defenderId: ANN,
  targetId: 'A1',
  launchId: 'B1',
  stake: ['B1'],
  status: 'playing',
  counter: null,
};
const projected = (war: OpenWar, declaredSeq = 10): ProjectedWar => ({
  id: war.id,
  attackerId: war.attackerId,
  defenderId: war.defenderId,
  launchId: war.launchId,
  targetId: war.targetId,
  declaredRound: ROUND,
  declaredSeq,
});
/** The war's game ending this way, with what changes hands by the war rules. */
const ending = (war: OpenWar, outcome: WarOutcome, endReason: WarEnding['endReason'] = null): WarEnding => ({
  outcome,
  transfers: warTransfers(war, outcome),
  endReason:
    outcome === 'attacker' || outcome === 'defender' || outcome === 'held' ? (endReason ?? 'resignation') : null,
});
const [WIN, LOSS, DRAW] = ['attacker', 'defender', 'held'] as const;

describe('what a war would change', () => {
  it("an attacker's win: the target changes hands, a title moves with it, and a position is claimed", () => {
    const missions: PlayedSlot[] = [ANN, BO].map((userId) => ({
      userId,
      key: 'p0',
      points: 2,
      spec: positions(['A1', 'B1', 'C1'], 2),
    }));
    const state = scoreState({ missions, openWars: [BO_ON_A1] });
    const [win, loss, draw] = projectWar(
      state,
      projected(BO_ON_A1),
      [WIN, LOSS, DRAW].map((o) => ending(BO_ON_A1, o)),
    );

    expect(win!.ending.transfers).toEqual([{ territoryId: 'A1', from: ANN, to: BO }]);
    // Bo has 95 people to Ann's 10: Largest Population and its point go to Bo.
    expect(win!.titles).toEqual([{ kind: 'population', from: ANN, to: BO }]);
    expect(Object.fromEntries(win!.points)).toEqual({ [ANN]: 4, [BO]: 5, [CY]: 2 });
    expect(win!.missions.map((m) => [m.userId, m.change, m.eligibleRound])).toEqual([
      [ANN, 'setback', undefined],
      [BO, 'claims', ROUND + 2],
    ]);
    expect(win!.winners).toEqual([]);

    // The defender's win takes the stake: Ann completes the same position, and keeps her title.
    expect(loss!.ending.transfers).toEqual([{ territoryId: 'B1', from: BO, to: ANN }]);
    expect(loss!.titles).toEqual([]);
    expect(loss!.missions.map((m) => [m.userId, m.change])).toEqual([
      [ANN, 'claims'],
      [BO, 'setback'],
    ]);

    // A draw where the defender holds changes nothing.
    expect(draw!.ending.transfers).toEqual([]);
    expect(draw!.titles).toEqual([]);
    expect(draw!.missions).toEqual([]);
    expect(Object.fromEntries(draw!.points)).toEqual({ [ANN]: 5, [BO]: 4, [CY]: 2 });
  });

  it('a title that takes a player to the points to win wins the campaign there and then', () => {
    const state = scoreState({ points: { [ANN]: 5, [BO]: 9, [CY]: 2 }, openWars: [BO_ON_A1] });
    const [win, loss] = projectWar(state, projected(BO_ON_A1), [ending(BO_ON_A1, WIN), ending(BO_ON_A1, LOSS)]);
    expect(win!.winners).toEqual([BO]);
    expect(loss!.winners).toEqual([]);
  });

  /** Ann has already beaten off one attack, Cy's. */
  const history: Partial<MissionHistory> = {
    wars: [
      {
        id: 'old',
        attackerId: CY,
        defenderId: ANN,
        launchId: 'C1',
        targetId: 'A2',
        outcome: 'defender',
        transfers: [],
        declaredRound: 2,
        round: 2,
        declaredSeq: 3,
        seq: 5,
        endReason: 'resignation',
      },
    ],
  };
  const ironWall = (wins: number, hidden: boolean): PlayedSlot => ({
    userId: ANN,
    key: 'secret',
    points: 4,
    spec: { kind: 'iron_wall', wins },
    hidden,
  });

  it("a defender's win scores a record at once", () => {
    const state = scoreState({
      points: { [ANN]: 6, [BO]: 4, [CY]: 2 },
      missions: [ironWall(2, false)],
      openWars: [BO_ON_A1],
      history,
    });
    const [win, loss] = projectWar(state, projected(BO_ON_A1), [ending(BO_ON_A1, WIN), ending(BO_ON_A1, LOSS)]);
    expect(win!.missions).toEqual([]);
    expect(loss!.missions.map((m) => [m.change, m.reveals])).toEqual([['scores', false]]);
    expect(loss!.points.get(ANN)).toBe(10);
    expect(loss!.winners).toEqual([ANN]);
  });

  it("an ending that brings the viewer's hidden secret within a step would reveal it", () => {
    const state = scoreState({ missions: [ironWall(3, true)], openWars: [BO_ON_A1], history });
    const [win, loss] = projectWar(state, projected(BO_ON_A1), [ending(BO_ON_A1, WIN), ending(BO_ON_A1, LOSS)]);
    expect(win!.missions).toEqual([]);
    expect(loss!.missions.map((m) => [m.change, m.reveals])).toEqual([['progress', true]]);
    expect(loss!.winners).toEqual([]);
  });

  it('a checkmate counts for Checkmate Artist; a resignation does not', () => {
    const artist: PlayedSlot = { userId: BO, key: 'secret', points: 4, spec: { kind: 'checkmate_artist', wins: 1 } };
    const state = scoreState({ missions: [artist], openWars: [BO_ON_A1] });
    const [resigned, mated] = projectWar(state, projected(BO_ON_A1), [
      ending(BO_ON_A1, WIN, 'resignation'),
      ending(BO_ON_A1, WIN, 'checkmate'),
    ]);
    expect(resigned!.missions).toEqual([]);
    expect(mated!.missions.map((m) => m.change)).toEqual(['scores']);
  });

  it('raised stakes: winning takes the countries the raises put in, and backing down only the target', () => {
    const counter: WarCounter = { kind: 'raise', minValue: 7, added: 'A2' };
    const raised: OpenWar = { ...BO_ON_A1, stake: ['B1', 'B2'], status: 'ready', counter };
    const state = scoreState({ openWars: [raised] });
    const [win, yielded, forfeited] = projectWar(state, projected(raised), [
      ending(raised, WIN),
      ending(raised, 'yielded'),
      ending(raised, 'forfeited'),
    ]);
    expect(win!.ending.transfers.map((t) => t.territoryId)).toEqual(['A1', 'A2']);
    expect(win!.titles).toEqual([{ kind: 'population', from: ANN, to: BO }]);
    expect(yielded!.ending.transfers.map((t) => t.territoryId)).toEqual(['A1']);
    expect(forfeited!.ending.transfers.map((t) => t.territoryId)).toEqual(['B1', 'B2']);
  });
});

describe('claims and the wars that hold them up', () => {
  // Ann's claim on two of A1, A2 and C1 is complete and has waited long enough; only wars stand in its way.
  const claimed: PlayedSlot = { userId: ANN, key: 'p1', points: 2, spec: positions(['A1', 'A2', 'C1'], 2) };
  const claim = (blockedBy: string[], served = true): PendingClaim => ({
    userId: ANN,
    missionKey: 'p1',
    startedRound: ROUND - 2,
    eligibleRound: ROUND,
    served,
    blockedBy,
  });

  it('a draw ends the war that held a claim up, so it scores; losing the position breaks it', () => {
    const state = scoreState({
      points: { [ANN]: 8, [BO]: 4, [CY]: 2 },
      missions: [claimed],
      claims: [claim(['w1'])],
      openWars: [BO_ON_A1],
    });
    const [win, loss, draw] = projectWar(
      state,
      projected(BO_ON_A1),
      [WIN, LOSS, DRAW].map((o) => ending(BO_ON_A1, o)),
    );
    expect(win!.missions.map((m) => m.change)).toEqual(['breaks']);
    expect(loss!.missions.map((m) => m.change)).toEqual(['scores']);
    expect(draw!.missions.map((m) => m.change)).toEqual(['scores']);
    expect(draw!.winners).toEqual([ANN]);
  });

  it('another war that could still break it keeps the claim waiting', () => {
    // Cy attacks A2 from C1 at the same time.
    const cyOnA2: OpenWar = { ...BO_ON_A1, id: 'w2', attackerId: CY, targetId: 'A2', launchId: 'C1', stake: ['C1'] };
    const state = scoreState({
      missions: [claimed],
      claims: [claim(['w1', 'w2'])],
      openWars: [BO_ON_A1, cyOnA2],
    });
    const [draw] = projectWar(state, projected(BO_ON_A1), [ending(BO_ON_A1, DRAW)]);
    expect(draw!.missions.map((m) => [m.change, m.blockedBy])).toEqual([['keeps', ['w2']]]);
    expect(draw!.winners).toEqual([]);
  });

  it('a claim that would take its player to the points to win is called out, without counting it as points', () => {
    const state = scoreState({
      points: { [ANN]: 8, [BO]: 4, [CY]: 2 },
      missions: [claimed],
      claims: [claim(['w1'], false)],
      openWars: [BO_ON_A1],
    });
    const [draw] = projectWar(state, projected(BO_ON_A1), [ending(BO_ON_A1, DRAW)]);
    expect(draw!.missions.map((m) => [m.change, m.eligibleRound])).toEqual([['keeps', ROUND]]);
    expect(draw!.points.get(ANN)).toBe(8);
    expect(draw!.winners).toEqual([]);
    expect(draw!.claimWins.map((m) => m.key)).toEqual(['p1']);
  });

  it('players crossing the line together share the victory on equal points, and the higher total takes it', () => {
    const bosClaim: PlayedSlot = { userId: BO, key: 'p2', points: 2, spec: positions(['B1', 'B2'], 2) };
    const claims: PendingClaim[] = [claim(['w1']), { ...claim(['w1']), userId: BO, missionKey: 'p2' }];
    const level = scoreState({
      points: { [ANN]: 8, [BO]: 8, [CY]: 2 },
      missions: [claimed, bosClaim],
      claims,
      openWars: [BO_ON_A1],
    });
    expect(projectWar(level, projected(BO_ON_A1), [ending(BO_ON_A1, DRAW)])[0]!.winners).toEqual([ANN, BO]);
    const ahead = scoreState({
      points: { [ANN]: 9, [BO]: 8, [CY]: 2 },
      missions: [claimed, bosClaim],
      claims,
      openWars: [BO_ON_A1],
    });
    expect(projectWar(ahead, projected(BO_ON_A1), [ending(BO_ON_A1, DRAW)])[0]!.winners).toEqual([ANN]);
  });

  it('a declaration holds up the claims it could break', () => {
    const state = scoreState({ missions: [claimed], claims: [claim([])] });
    const onA1: OpenWar = { ...BO_ON_A1, id: 'new', status: 'declared' };
    expect(claimsHeldUp(state, onA1).map((c) => c.missionKey)).toEqual(['p1']);
    // Bo's war on Cy can't touch Ann's position.
    const onC1: OpenWar = { ...onA1, defenderId: CY, targetId: 'C1', stake: ['B1'] };
    expect(claimsHeldUp(state, onC1)).toEqual([]);
  });
});

describe('ties for a title', () => {
  // Ann holds Largest Population with 70; Bo has 45 and Cy 65.
  const tied = buildMap({
    A1: { v: 4, land: ['A2', 'B1'], people: 50 },
    A2: { v: 3, land: ['B2', 'C1'], people: 20 },
    B1: { v: 4, land: ['B2', 'C1'], people: 40 },
    B2: { v: 3, people: 5 },
    C1: { v: 3, people: 65 },
  });

  it('a lead shared by players who did not hold the title goes to nobody', () => {
    const base = scoreState();
    const state: ScoreState = {
      ...base,
      world: makeWorld(tied, OWNERS, { players: [ANN, BO, CY] }),
      board: { ...base.board, idx: tied },
    };
    const onA2: OpenWar = { ...BO_ON_A1, targetId: 'A2', launchId: 'B2', stake: ['B2'] };
    const [win] = projectWar(state, projected(onA2), [ending(onA2, WIN)]);
    // Bo 65, Cy 65, Ann 50: Ann loses the title, and nobody takes it.
    expect(win!.titles).toEqual([{ kind: 'population', from: ANN, to: null }]);
    expect(Object.fromEntries(win!.points)).toEqual({ [ANN]: 4, [BO]: 4, [CY]: 2 });
  });
});

describe('reading the campaign view', () => {
  it('builds the mission world the server scores with', () => {
    const world = missionWorldFrom(idx, [CY, ANN, BO], new Map(Object.entries(OWNERS)), {
      baselines: { [ANN]: ['A1', 'A2'], [BO]: ['B1', 'B2'], [CY]: ['C1'] },
      history: { wars: [], accords: [], roundStarts: [], awards: [] },
    });
    expect(world.players).toEqual([ANN, BO, CY]);
    const spec = positions(['A1', 'B1'], 2);
    expect(evaluateMission(world, ANN, spec)).toEqual(evaluateMission(makeWorld(idx, OWNERS), ANN, spec));
  });

  it('a claim has waited long enough by turns, or by time', () => {
    const claim = { startedRound: 3, eligibleAt: 5_000, turnsHeld: true };
    expect(claimServed(claim, 'turns', 5, 0)).toBe(true);
    expect(claimServed(claim, 'turns', 4, 0)).toBe(false);
    expect(claimServed({ ...claim, turnsHeld: false }, 'turns', 5, 0)).toBe(false);
    expect(claimServed(claim, 'time', 5, 4_999)).toBe(false);
    expect(claimServed(claim, 'time', 5, 5_000)).toBe(true);
    expect(DECLARED_NOW_SEQ).toBeGreaterThan(1e12);
  });
});
