import { describe, expect, it } from 'vitest';
import type { MissionSpec } from './catalog';
import { evaluateMission, missionComplete, type Evaluation } from './evaluate';
import { all, buildMap, makeWorld } from './test-maps';
import type { MissionWar } from './world';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';
const DI = 'di';

let seq = 100;
function war(p: Partial<MissionWar> & Pick<MissionWar, 'attackerId' | 'defenderId' | 'outcome'>): MissionWar {
  seq++;
  return {
    id: `w${seq}`,
    launchId: 'L',
    targetId: 'T',
    transfers: [],
    round: 1,
    seq,
    ...p,
  };
}

const parts = (e: Evaluation) => e.parts.map((p) => [p.label, p.have, p.need]);

describe('expansion', () => {
  const idx = buildMap({
    A1: { v: 5, land: ['A2'] },
    A2: { v: 5, land: ['B1'] },
    B1: { v: 4, land: ['B2'] },
    B2: { v: 6, land: ['B3'] },
    B3: { v: 10 },
  });
  const baseline = { ...all(ANN, 'A1', 'A2'), ...all(BO, 'B1', 'B2', 'B3') };
  const spec: MissionSpec = { kind: 'expansion', gain: 15 };

  it('compares current value with the baseline, including losses elsewhere', () => {
    const gained10 = makeWorld(idx, { ...baseline, ...all(ANN, 'B1', 'B2') }, { baseline });
    expect(evaluateMission(gained10, ANN, spec)).toMatchObject({ complete: false, parts: [{ have: 10, need: 15 }] });
    const gained20 = makeWorld(idx, { ...baseline, ...all(ANN, 'B1', 'B2', 'B3') }, { baseline });
    expect(missionComplete(gained20, ANN, spec)).toBe(true);
    // Losing A1 elsewhere still leaves +15; losing A2 too drops it to +10.
    const lostOne = makeWorld(idx, { ...baseline, ...all(ANN, 'B1', 'B2', 'B3'), A1: BO }, { baseline });
    expect(missionComplete(lostOne, ANN, spec)).toBe(true);
    const lostTwo = makeWorld(idx, { ...all(BO, 'A1', 'A2'), ...all(ANN, 'B1', 'B2', 'B3') }, { baseline });
    expect(evaluateMission(lostTwo, ANN, spec)).toMatchObject({ complete: false, parts: [{ have: 10 }] });
  });

  it('counts drafted holdings from the start: nothing gained yet', () => {
    expect(evaluateMission(makeWorld(idx, baseline), ANN, spec).parts[0]).toMatchObject({ have: 0, done: false });
  });
});

describe('regional power', () => {
  const idx = buildMap({
    N1: { v: 3, land: ['N2'], sub: 'North' },
    N2: { v: 4, land: ['N3'], sub: 'North' },
    N3: { v: 5, land: ['N4'], sub: 'North' },
    N4: { v: 6, land: ['N5'], sub: 'North' },
    N5: { v: 7, land: ['X'], sub: 'North' },
    X: { v: 9 },
  });
  const spec: MissionSpec = {
    kind: 'regional_power',
    region: 'North',
    territories: ['N1', 'N2', 'N3', 'N4', 'N5'],
    totalValue: 25,
    needValue: 15,
    minTerritories: 3,
  };

  it('needs both the value share and the number of countries', () => {
    const two = makeWorld(idx, { ...all(ANN, 'N4', 'N5', 'X'), ...all(BO, 'N1', 'N2', 'N3') });
    const e = evaluateMission(two, ANN, spec);
    expect(e.complete).toBe(false);
    expect(parts(e)).toEqual([
      ['Value held in North', 13, 15],
      ['Countries held in North', 2, 3],
    ]);
    const three = makeWorld(idx, { ...all(ANN, 'N1', 'N4', 'N5'), ...all(BO, 'N2', 'N3', 'X') });
    expect(evaluateMission(three, ANN, spec)).toMatchObject({
      complete: true,
      evidence: { territories: ['N1', 'N4', 'N5'] },
    });
  });
});

describe('strategic positions', () => {
  const idx = buildMap({
    P1: { v: 3, land: ['P2'] },
    P2: { v: 3, land: ['P3'] },
    P3: { v: 3, land: ['P4'] },
    P4: { v: 3, land: ['P5'] },
    P5: { v: 3 },
  });
  const spec: MissionSpec = { kind: 'strategic_positions', territories: ['P1', 'P2', 'P3', 'P4', 'P5'], need: 3 };

  it('takes any three of five, whichever three', () => {
    expect(missionComplete(makeWorld(idx, { ...all(ANN, 'P1', 'P3'), ...all(BO, 'P2', 'P4', 'P5') }), ANN, spec)).toBe(
      false,
    );
    expect(missionComplete(makeWorld(idx, { ...all(ANN, 'P1', 'P3', 'P5'), ...all(BO, 'P2', 'P4') }), ANN, spec)).toBe(
      true,
    );
    expect(missionComplete(makeWorld(idx, { ...all(ANN, 'P2', 'P4', 'P5'), ...all(BO, 'P1', 'P3') }), ANN, spec)).toBe(
      true,
    );
  });
});

describe('the great connection', () => {
  // X - Y ~ Z - W: the chain may cross a sea lane.
  const idx = buildMap({
    X: { v: 3, land: ['Y'] },
    Y: { v: 3, sea: ['Z'] },
    Z: { v: 3, land: ['W'] },
    W: { v: 3 },
  });
  const spec: MissionSpec = { kind: 'great_connection', endpoints: ['W', 'X'] };

  it('needs both endpoints and an unbroken chain, by land or sea lane', () => {
    const joined = evaluateMission(makeWorld(idx, all(ANN, 'X', 'Y', 'Z', 'W')), ANN, spec);
    expect(joined).toMatchObject({ complete: true, evidence: { path: ['W', 'Z', 'Y', 'X'] } });
    const broken = evaluateMission(makeWorld(idx, { ...all(ANN, 'X', 'Y', 'W'), Z: BO }), ANN, spec);
    expect(broken.complete).toBe(false);
    expect(parts(broken)).toEqual([
      ['Endpoints held', 2, 2],
      ['Countries held on the best route', 3, 4],
    ]);
  });
});

describe('campaign veteran', () => {
  const idx = buildMap({ L: { v: 1, land: ['T'] }, T: { v: 1 } });
  const spec: MissionSpec = { kind: 'campaign_veteran', wins: 3, opponents: 2, attackWins: 1 };
  const owners = { L: ANN, T: BO };

  it('counts war victories only: not draws, tribute, withdrawals or cancelled wars', () => {
    const wars = [
      war({ attackerId: ANN, defenderId: BO, outcome: 'attacker' }),
      war({ attackerId: CY, defenderId: ANN, outcome: 'defender' }),
      war({ attackerId: ANN, defenderId: BO, outcome: 'tribute' }),
      war({ attackerId: ANN, defenderId: CY, outcome: 'withdrawn' }),
      war({ attackerId: BO, defenderId: ANN, outcome: 'held' }),
      war({ attackerId: ANN, defenderId: BO, outcome: 'cancelled' }),
    ];
    const world = makeWorld(idx, owners, { history: { wars }, players: [ANN, BO, CY] });
    const e = evaluateMission(world, ANN, spec);
    expect(e.complete).toBe(false);
    expect(parts(e)).toEqual([
      ['Wars won', 2, 3],
      ['Different opponents beaten', 2, 2],
      ['Won as the attacker', 1, 1],
    ]);
    const third = [...wars, war({ attackerId: BO, defenderId: ANN, outcome: 'defender' })];
    expect(
      missionComplete(makeWorld(idx, owners, { history: { wars: third }, players: [ANN, BO, CY] }), ANN, spec),
    ).toBe(true);
  });

  it('needs two different opponents, and at least one win as the attacker', () => {
    const allBo = [1, 2, 3].map(() => war({ attackerId: ANN, defenderId: BO, outcome: 'attacker' }));
    expect(
      missionComplete(makeWorld(idx, owners, { history: { wars: allBo }, players: [ANN, BO, CY] }), ANN, spec),
    ).toBe(false);
    const defending = [
      war({ attackerId: BO, defenderId: ANN, outcome: 'defender' }),
      war({ attackerId: CY, defenderId: ANN, outcome: 'defender' }),
      war({ attackerId: CY, defenderId: ANN, outcome: 'defender' }),
    ];
    const e = evaluateMission(
      makeWorld(idx, owners, { history: { wars: defending }, players: [ANN, BO, CY] }),
      ANN,
      spec,
    );
    expect(e.complete).toBe(false);
    expect(e.parts[2]).toMatchObject({ have: 0, need: 1 });
  });

  it('asks for one opponent in a two-player campaign', () => {
    const wars = [
      war({ attackerId: ANN, defenderId: BO, outcome: 'attacker' }),
      war({ attackerId: BO, defenderId: ANN, outcome: 'defender' }),
      war({ attackerId: BO, defenderId: ANN, outcome: 'defender' }),
    ];
    const e = evaluateMission(makeWorld(idx, owners, { history: { wars }, players: [ANN, BO] }), ANN, spec);
    expect(e).toMatchObject({ complete: true, evidence: { wars: wars.map((w) => w.id) } });
    expect(e.parts[1]).toMatchObject({ have: 1, need: 1 });
  });
});

describe('great powers', () => {
  const idx = buildMap({
    G1: { v: 8, land: ['G2'] },
    G2: { v: 9, land: ['G3'] },
    G3: { v: 10, land: ['G4'] },
    G4: { v: 8, land: ['S'] },
    S: { v: 1 },
  });
  const baseline = { ...all(ANN, 'G1', 'G2', 'S'), ...all(BO, 'G3', 'G4') };
  const spec: MissionSpec = { kind: 'great_powers', minValue: 8, count: 3, newCount: 2 };

  it('needs two of the three won since the draft', () => {
    const one = makeWorld(idx, { ...baseline, G3: ANN }, { baseline });
    expect(parts(evaluateMission(one, ANN, spec))).toEqual([
      ['Countries worth 8 or more', 3, 3],
      ['Of them won since the draft', 1, 2],
    ]);
    const two = makeWorld(idx, { ...baseline, G3: ANN, G4: ANN }, { baseline });
    expect(missionComplete(two, ANN, spec)).toBe(true);
  });

  it('never counts a drafted country as new, even after losing and retaking it', () => {
    // Ann lost G1 and took it back: it is still one of her drafted countries.
    const retaken = makeWorld(idx, { ...baseline, G3: ANN }, { baseline });
    expect(evaluateMission(retaken, ANN, spec).parts[1]).toMatchObject({ have: 1 });
  });
});

describe('across the seas', () => {
  // A ~ B, A ~ D, A ~ E by sea; A - C and C - F by land.
  const idx = buildMap({
    A: { v: 2, land: ['C'], sea: ['B', 'D', 'E'] },
    B: { v: 3 },
    C: { v: 2, land: ['F'] },
    D: { v: 4 },
    E: { v: 1 },
    F: { v: 3 },
  });
  const spec: MissionSpec = { kind: 'across_the_seas', count: 3 };
  const baseline = { A: ANN, ...all(BO, 'B', 'C', 'D', 'E', 'F') };
  const won = (targetId: string, launchId = 'A') =>
    war({ attackerId: ANN, defenderId: BO, outcome: 'attacker', launchId, targetId });

  it('counts attacks launched across a sea lane, judged on the country finally fought over', () => {
    const wars = [
      won('B'),
      won('C'), // land
      won('F'), // redirected from D to F: A and F aren't joined by a sea lane
      won('E'),
      won('D'),
    ];
    const owners = { ...baseline, ...all(ANN, 'A', 'B', 'C', 'D', 'E', 'F') };
    const e = evaluateMission(makeWorld(idx, owners, { baseline, history: { wars } }), ANN, spec);
    expect(e).toMatchObject({ complete: true, evidence: { territories: ['B', 'D', 'E'] } });
  });

  it('needs all three still held, and new since the draft', () => {
    const wars = [won('B'), won('D'), won('E')];
    const lostE = { ...baseline, ...all(ANN, 'A', 'B', 'D') };
    expect(evaluateMission(makeWorld(idx, lostE, { baseline, history: { wars } }), ANN, spec).parts[0]).toMatchObject({
      have: 2,
    });
    // B was drafted by Ann, lost, and won back across the sea: it doesn't count.
    const draftedB = { ...baseline, B: ANN };
    const owners = { ...baseline, ...all(ANN, 'A', 'B', 'D', 'E') };
    expect(missionComplete(makeWorld(idx, owners, { baseline: draftedB, history: { wars } }), ANN, spec)).toBe(false);
  });

  it('counts a country taken twice only once', () => {
    const wars = [won('B'), won('B'), won('D')];
    const owners = { ...baseline, ...all(ANN, 'A', 'B', 'D') };
    expect(evaluateMission(makeWorld(idx, owners, { baseline, history: { wars } }), ANN, spec).parts[0]).toMatchObject({
      have: 2,
    });
  });
});

describe('continental bridge', () => {
  const idx = buildMap({
    E1: { v: 1, land: ['E2'], c: 'europe' },
    E2: { v: 1, land: ['A1'], c: 'europe' },
    A1: { v: 1, land: ['A2'], c: 'asia' },
    A2: { v: 1, land: ['F1'], c: 'asia' },
    F1: { v: 1, land: ['F2'], c: 'africa' },
    F2: { v: 1, c: 'africa' },
  });
  const spec: MissionSpec = { kind: 'continental_bridge', continents: 3, perContinent: 2 };

  it('needs one connected block reaching into three continents', () => {
    expect(missionComplete(makeWorld(idx, all(ANN, 'E1', 'E2', 'A1', 'A2', 'F1', 'F2')), ANN, spec)).toBe(true);
    const cut = evaluateMission(makeWorld(idx, { ...all(ANN, 'E1', 'E2', 'A2', 'F1', 'F2'), A1: BO }), ANN, spec);
    expect(cut).toMatchObject({ complete: false, parts: [{ have: 1, need: 3 }] });
  });
});

describe('consolidation', () => {
  // P1 - P2 - P3 - P4 - P5 - Z
  const idx = buildMap({
    P1: { v: 2, land: ['P2'] },
    P2: { v: 2, land: ['P3'] },
    P3: { v: 2, land: ['P4'] },
    P4: { v: 2, land: ['P5'] },
    P5: { v: 2, land: ['Z'] },
    Z: { v: 10 },
  });
  const spec: MissionSpec = { kind: 'consolidation', sharePct: 80, newCount: 2 };

  it('with a drafted empire in one piece, grows that piece by two new countries', () => {
    const baseline = { ...all(ANN, 'P1', 'P2'), ...all(BO, 'P3', 'P4', 'P5', 'Z') };
    const grown = makeWorld(idx, { ...baseline, P3: ANN, P4: ANN }, { baseline });
    expect(missionComplete(grown, ANN, spec)).toBe(true);
    // Most of the value elsewhere fails the share.
    const split = makeWorld(idx, { ...baseline, P3: ANN, P4: ANN, P5: BO, Z: ANN }, { baseline });
    expect(evaluateMission(split, ANN, spec).parts[0]).toMatchObject({ need: 80, done: false });
  });

  it('with a scattered draft, joins two pieces with two new countries on the links', () => {
    const baseline = { ...all(ANN, 'P1', 'P5'), ...all(BO, 'P2', 'P3', 'P4', 'Z') };
    const joined = makeWorld(idx, { ...baseline, ...all(ANN, 'P2', 'P3', 'P4') }, { baseline });
    const e = evaluateMission(joined, ANN, spec);
    expect(e.complete).toBe(true);
    // Counted up to what's needed.
    expect(parts(e)).toEqual([
      ['Share of empire value in one connected block', 100, 80],
      ['Drafted pieces it joins', 2, 2],
      ['Countries won since the draft that the join needs', 2, 2],
    ]);
  });

  it('does not count a single new country bridging a one-country gap as two', () => {
    const baseline = { ...all(ANN, 'P1', 'P3'), ...all(BO, 'P2', 'P4', 'P5', 'Z') };
    const bridged = makeWorld(idx, { ...baseline, P2: ANN, P4: ANN }, { baseline });
    const e = evaluateMission(bridged, ANN, spec);
    expect(e.complete).toBe(false);
    expect(e.parts[2]).toMatchObject({ have: 1, need: 2 });
    // Joining a third piece through a second link makes two.
    const three = { ...all(ANN, 'P1', 'P3', 'P5'), ...all(BO, 'P2', 'P4', 'Z') };
    const both = makeWorld(idx, { ...three, P2: ANN, P4: ANN }, { baseline: three });
    expect(missionComplete(both, ANN, spec)).toBe(true);
  });

  it('counts parallel links, and a country touching several pieces, once', () => {
    //      X
    //    /   \
    //  A1     B1        C1 - H - A2, with H also bordering B2
    //    \   /
    //      Y
    const map = buildMap({
      A1: { v: 3, land: ['X', 'Y'] },
      B1: { v: 3, land: ['X', 'Y'] },
      X: { v: 1 },
      Y: { v: 1 },
      H: { v: 1, land: ['A2', 'B2', 'C1'] },
      A2: { v: 3 },
      B2: { v: 3 },
      C1: { v: 3 },
    });
    const twoGaps = { ...all(ANN, 'A1', 'B1'), ...all(BO, 'X', 'Y', 'H', 'A2', 'B2', 'C1') };
    const parallel = evaluateMission(makeWorld(map, { ...twoGaps, X: ANN, Y: ANN }, { baseline: twoGaps }), ANN, spec);
    expect(parallel.complete).toBe(false);
    expect(parallel.parts[2]).toMatchObject({ have: 1, need: 2 });

    const hub = { ...all(ANN, 'A2', 'B2', 'C1'), ...all(BO, 'A1', 'B1', 'X', 'Y', 'H') };
    const star = evaluateMission(makeWorld(map, { ...hub, H: ANN }, { baseline: hub }), ANN, spec);
    expect(star.parts[1]).toMatchObject({ have: 3, done: true });
    expect(star.parts[2]).toMatchObject({ have: 1, need: 2 });
    expect(star.complete).toBe(false);
  });
});

describe('two fronts', () => {
  const idx = buildMap({
    E1: { v: 1, land: ['E2'], c: 'europe' },
    E2: { v: 1, land: ['E3'], c: 'europe' },
    E3: { v: 1, land: ['A1'], c: 'europe' },
    A1: { v: 1, land: ['A2'], c: 'asia' },
    A2: { v: 1, land: ['A3'], c: 'asia' },
    A3: { v: 1, c: 'asia' },
  });
  const spec: MissionSpec = { kind: 'two_fronts', continents: 2, perContinent: 2 };
  const baseline = { ...all(ANN, 'E1', 'A1'), ...all(BO, 'E2', 'E3', 'A2', 'A3') };

  it('needs two new countries on each of two continents', () => {
    const one = makeWorld(idx, { ...baseline, ...all(ANN, 'E2', 'E3', 'A2') }, { baseline });
    expect(evaluateMission(one, ANN, spec).parts[0]).toMatchObject({ have: 1, need: 2 });
    const two = makeWorld(idx, { ...baseline, ...all(ANN, 'E2', 'E3', 'A2', 'A3') }, { baseline });
    expect(missionComplete(two, ANN, spec)).toBe(true);
  });
});

describe('named sets', () => {
  const idx = buildMap({
    CAN: { v: 8, sea: ['GRL'], land: ['USA'] },
    GRL: { v: 1, sea: ['ISL'] },
    ISL: { v: 2, sea: ['GBR'] },
    GBR: { v: 8 },
    USA: { v: 10 },
  });
  const spec: MissionSpec = { kind: 'northern_passage', territories: ['CAN', 'GRL', 'ISL', 'GBR'], need: 4, reveal: 3 };

  it('is revealed at three of four and complete at four', () => {
    const two = makeWorld(idx, { ...all(ANN, 'USA', 'CAN', 'GRL'), ...all(BO, 'ISL', 'GBR') });
    expect(evaluateMission(two, ANN, spec)).toMatchObject({ complete: false, near: false });
    const three = makeWorld(idx, { ...all(ANN, 'USA', 'CAN', 'GRL', 'ISL'), GBR: BO });
    expect(evaluateMission(three, ANN, spec)).toMatchObject({ complete: false, near: true });
    const four = makeWorld(idx, all(ANN, 'USA', 'CAN', 'GRL', 'ISL', 'GBR'));
    expect(evaluateMission(four, ANN, spec)).toMatchObject({ complete: true, near: true });
  });

  it('counts four of five for the Central Asian Union, revealed at three', () => {
    const cau: MissionSpec = {
      kind: 'central_asian_union',
      territories: ['CAN', 'GRL', 'ISL', 'GBR', 'USA'],
      need: 4,
      reveal: 3,
    };
    const three = makeWorld(idx, { ...all(ANN, 'CAN', 'GRL', 'USA'), ...all(BO, 'ISL', 'GBR') });
    expect(evaluateMission(three, ANN, cau)).toMatchObject({ complete: false, near: true });
    const four = makeWorld(idx, { ...all(ANN, 'CAN', 'GRL', 'USA', 'ISL'), GBR: BO });
    expect(missionComplete(four, ANN, cau)).toBe(true);
  });
});

describe('island empire', () => {
  // M ~ I1 ~ I2 ~ I3 ~ I4 ~ I5 ~ I6, and M ~ I4.
  const idx = buildMap({
    M: { v: 3, sea: ['I1', 'I4'] },
    I1: { v: 1, sea: ['I2'], terrain: ['island'] },
    I2: { v: 1, sea: ['I3'], terrain: ['island'] },
    I3: { v: 1, sea: ['I4'], terrain: ['island'] },
    I4: { v: 1, sea: ['I5'], terrain: ['island'] },
    I5: { v: 1, sea: ['I6'], terrain: ['island'] },
    I6: { v: 1, terrain: ['island'] },
  });
  const spec: MissionSpec = {
    kind: 'island_empire',
    territories: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'],
    need: 4,
    newCount: 2,
  };

  it('is revealed at three islands only when one more conquest finishes it', () => {
    const baseline = { ...all(ANN, 'M', 'I1', 'I2'), ...all(BO, 'I3', 'I4', 'I5', 'I6') };
    const start = makeWorld(idx, baseline);
    expect(evaluateMission(start, ANN, spec)).toMatchObject({ complete: false, near: false });
    const threeWithOneNew = makeWorld(idx, { ...baseline, I3: ANN }, { baseline });
    expect(evaluateMission(threeWithOneNew, ANN, spec)).toMatchObject({ complete: false, near: true });
    const done = makeWorld(idx, { ...baseline, I3: ANN, I4: ANN }, { baseline });
    expect(evaluateMission(done, ANN, spec)).toMatchObject({ complete: true });
  });

  it('is not revealed when the islands held were all drafted: one conquest makes only one new', () => {
    const baseline = { ...all(ANN, 'M', 'I1', 'I2', 'I3'), ...all(BO, 'I4', 'I5', 'I6') };
    expect(evaluateMission(makeWorld(idx, baseline), ANN, spec)).toMatchObject({ complete: false, near: false });
  });
});

describe('mountain kingdom and hidden triangle', () => {
  const idx = buildMap({ K1: { v: 3, land: ['K2'] }, K2: { v: 3, land: ['K3'] }, K3: { v: 3 } });
  it.each(['mountain_kingdom', 'hidden_triangle'] as const)('%s is revealed at two of three', (kind) => {
    const spec: MissionSpec = { kind, territories: ['K1', 'K2', 'K3'], need: 3, reveal: 2 };
    expect(evaluateMission(makeWorld(idx, { K1: ANN, ...all(BO, 'K2', 'K3') }), ANN, spec).near).toBe(false);
    expect(evaluateMission(makeWorld(idx, { ...all(ANN, 'K1', 'K2'), K3: BO }), ANN, spec)).toMatchObject({
      near: true,
      complete: false,
    });
    expect(missionComplete(makeWorld(idx, all(ANN, 'K1', 'K2', 'K3')), ANN, spec)).toBe(true);
  });
});

describe('unification', () => {
  // U1 - G1 - G2 - U2
  const idx = buildMap({
    U1: { v: 4, land: ['G1'] },
    G1: { v: 2, land: ['G2'] },
    G2: { v: 2, land: ['U2'] },
    U2: { v: 4 },
  });
  const baseline = { ...all(ANN, 'U1', 'U2'), ...all(BO, 'G1', 'G2') };
  const spec: MissionSpec = { kind: 'unification', marks: ['U1', 'U2'], newCount: 2 };

  it('is revealed when one more conquest joins the pieces, and complete when joined', () => {
    expect(evaluateMission(makeWorld(idx, baseline), ANN, spec)).toMatchObject({ near: false, complete: false });
    const halfway = makeWorld(idx, { ...baseline, G1: ANN }, { baseline });
    expect(evaluateMission(halfway, ANN, spec)).toMatchObject({ near: true, complete: false });
    const joined = evaluateMission(makeWorld(idx, { ...baseline, ...all(ANN, 'G1', 'G2') }, { baseline }), ANN, spec);
    expect(joined).toMatchObject({ complete: true, evidence: { path: ['U1', 'G1', 'G2', 'U2'] } });
    expect(parts(joined)).toEqual([
      ['Marked countries held', 2, 2],
      ['Countries won since the draft on the link', 2, 2],
    ]);
  });

  it('needs both marked countries: losing one breaks it, and retaking it can complete it', () => {
    const lost = makeWorld(idx, { ...all(ANN, 'U1', 'G1', 'G2'), U2: BO }, { baseline });
    expect(evaluateMission(lost, ANN, spec)).toMatchObject({ complete: false, near: true });
  });
});

describe('encirclement', () => {
  // The center C borders R1, R2 and R3, which border each other in a chain.
  const idx = buildMap({
    C: { v: 5, land: ['R1', 'R2', 'R3'] },
    R1: { v: 2, land: ['R2'] },
    R2: { v: 2, land: ['R3'] },
    R3: { v: 2 },
  });
  const spec: MissionSpec = { kind: 'encirclement', center: 'C', ring: ['R1', 'R2', 'R3'] };

  it('is revealed at all but one neighbor, and needs the center in other hands', () => {
    expect(evaluateMission(makeWorld(idx, { R1: ANN, ...all(BO, 'C', 'R2', 'R3') }), ANN, spec).near).toBe(false);
    const allButOne = makeWorld(idx, { ...all(ANN, 'R1', 'R2'), ...all(BO, 'C', 'R3') });
    expect(evaluateMission(allButOne, ANN, spec)).toMatchObject({ near: true, complete: false });
    const surrounded = makeWorld(idx, { ...all(ANN, 'R1', 'R2', 'R3'), C: CY });
    expect(missionComplete(surrounded, ANN, spec)).toBe(true);
    const tookCenter = evaluateMission(makeWorld(idx, all(ANN, 'C', 'R1', 'R2', 'R3')), ANN, spec);
    expect(tookCenter).toMatchObject({ complete: false, near: false });
    expect(tookCenter.parts[1]).toMatchObject({ have: 0, need: 1 });
  });
});

describe('two-theater power', () => {
  const idx = buildMap({
    E1: { v: 3, land: ['E2'], c: 'europe' },
    E2: { v: 4, land: ['E3'], c: 'europe' },
    E3: { v: 5, land: ['A1'], c: 'europe' },
    A1: { v: 4, land: ['A2'], c: 'asia' },
    A2: { v: 5, land: ['A3'], c: 'asia' },
    A3: { v: 6, c: 'asia' },
  });
  const baseline = { ...all(ANN, 'E1', 'A1'), ...all(BO, 'E2', 'E3', 'A2', 'A3') };
  const spec: MissionSpec = { kind: 'two_theater_power', continents: ['europe', 'asia'], netValue: 8, newCount: 2 };

  it('is revealed when one theater is done and one more conquest finishes the other', () => {
    const europe = makeWorld(idx, { ...baseline, ...all(ANN, 'E2', 'E3') }, { baseline });
    expect(evaluateMission(europe, ANN, spec)).toMatchObject({ complete: false, near: false });
    const both = makeWorld(idx, { ...baseline, ...all(ANN, 'E2', 'E3', 'A2') }, { baseline });
    expect(evaluateMission(both, ANN, spec)).toMatchObject({ complete: false, near: true });
    const done = makeWorld(idx, { ...baseline, ...all(ANN, 'E2', 'E3', 'A2', 'A3') }, { baseline });
    expect(evaluateMission(done, ANN, spec).complete).toBe(true);
    expect(parts(evaluateMission(done, ANN, spec))).toEqual([
      ['Europe: value gained', 9, 8],
      ['Europe: countries won', 2, 2],
      ['Asia: value gained', 11, 8],
      ['Asia: countries won', 2, 2],
    ]);
  });

  it('must be retained on both continents', () => {
    const lost = makeWorld(idx, { ...baseline, ...all(ANN, 'E3', 'A2', 'A3'), E2: BO }, { baseline });
    expect(missionComplete(lost, ANN, spec)).toBe(false);
  });
});

describe('protected expansion', () => {
  const idx = buildMap({
    H: { v: 3, land: ['X1', 'X2', 'X3', 'X4', 'X5'] },
    X1: { v: 1 },
    X2: { v: 1 },
    X3: { v: 1 },
    X4: { v: 1 },
    X5: { v: 1 },
  });
  const spec: MissionSpec = { kind: 'protected_expansion', partners: 2, rounds: 2, acquisitions: 3 };
  const players = [ANN, BO, CY, DI];
  const baseline = { H: ANN, ...all(DI, 'X1', 'X3', 'X4', 'X5'), X2: BO };
  // Rounds 1 to 4 began at these points in the history.
  const roundStarts = [
    { round: 1, seq: 5 },
    { round: 2, seq: 20 },
    { round: 3, seq: 30 },
    { round: 4, seq: 45 },
  ];
  const taken = (territoryId: string, from: string, at: number): MissionWar => ({
    id: `w${at}`,
    attackerId: ANN,
    defenderId: from,
    launchId: 'H',
    targetId: territoryId,
    outcome: 'attacker',
    transfers: [{ territoryId, from, to: ANN }],
    round: 1,
    seq: at,
  });
  const wars = [
    taken('X1', DI, 15),
    taken('X2', BO, 25), // from a partner: doesn't count
    taken('X3', DI, 35),
    taken('X4', DI, 38),
    taken('X5', DI, 55), // after the Cy accord ended
  ];
  const owners = { ...baseline, ...all(ANN, 'X1', 'X2', 'X3', 'X4', 'X5') };

  it('needs two whole rounds together and three countries won from others under them', () => {
    const accords = [
      { id: 'a1', players: [ANN, BO] as const, from: 10, to: null },
      { id: 'a2', players: [CY, ANN] as const, from: 12, to: 50 },
    ];
    const world = makeWorld(idx, owners, { baseline, players, history: { wars, accords, roundStarts } });
    const e = evaluateMission(world, ANN, spec);
    expect(e).toMatchObject({ complete: true, evidence: { territories: ['X1', 'X3', 'X4'] } });
    expect(parts(e)).toEqual([
      ['Whole rounds with both accords in force', 2, 2],
      ['Countries won under them and still held', 3, 3],
    ]);
  });

  it('does not count a round an accord ended in', () => {
    const accords = [
      { id: 'a1', players: [ANN, BO] as const, from: 10, to: null },
      { id: 'a2', players: [ANN, CY] as const, from: 12, to: 40 },
    ];
    const world = makeWorld(idx, owners, { baseline, players, history: { wars, accords, roundStarts } });
    expect(evaluateMission(world, ANN, spec).parts[0]).toMatchObject({ have: 1, need: 2 });
  });

  it('keeps the proof after the accords end, but the countries must still be held', () => {
    const accords = [
      { id: 'a1', players: [ANN, BO] as const, from: 10, to: 52 },
      { id: 'a2', players: [ANN, CY] as const, from: 12, to: 50 },
    ];
    const lostOne = { ...owners, X4: DI };
    const world = makeWorld(idx, lostOne, { baseline, players, history: { wars, accords, roundStarts } });
    // Two held: close enough to reveal, not enough to complete.
    expect(evaluateMission(world, ANN, spec)).toMatchObject({ complete: false, near: true });
  });

  it('joins a renewed accord to the one it replaced', () => {
    const accords = [
      { id: 'a1', players: [ANN, BO] as const, from: 10, to: 22 },
      { id: 'a1b', players: [ANN, BO] as const, from: 22, to: null },
      { id: 'a2', players: [ANN, CY] as const, from: 12, to: null },
    ];
    const world = makeWorld(idx, owners, { baseline, players, history: { wars, accords, roundStarts } });
    expect(missionComplete(world, ANN, spec)).toBe(true);
  });
});

describe('measured expansion', () => {
  const idx = buildMap({
    H: { v: 1, land: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'] },
    Y1: { v: 6 },
    Y2: { v: 6 },
    Y3: { v: 6 },
    Y4: { v: 4 },
    Y5: { v: 2 },
  });
  const baseline = { H: ANN, ...all(BO, 'Y1', 'Y2', 'Y3', 'Y4', 'Y5') };
  const spec: MissionSpec = { kind: 'measured_expansion', gain: 20, newCount: 3, revealGain: 16, revealNew: 2 };

  it('is revealed at +16 with two new countries, or when one conquest can finish it', () => {
    const twelve = makeWorld(idx, { ...baseline, ...all(ANN, 'Y1', 'Y2') }, { baseline });
    // +12 with two new: Y3 would make +18, short of 20.
    expect(evaluateMission(twelve, ANN, spec)).toMatchObject({ near: false });
    const sixteen = makeWorld(idx, { ...baseline, ...all(ANN, 'Y1', 'Y2', 'Y4') }, { baseline });
    expect(evaluateMission(sixteen, ANN, spec)).toMatchObject({ near: true, complete: false });
    const done = makeWorld(idx, { ...baseline, ...all(ANN, 'Y1', 'Y2', 'Y3', 'Y5') }, { baseline });
    expect(missionComplete(done, ANN, spec)).toBe(true);
  });
});
