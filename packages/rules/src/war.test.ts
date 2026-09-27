import { describe, expect, it } from 'vitest';
import { parseRules } from './config';
import { indexDataset } from './graph';
import { makeTerritory, warDataset } from './test-fixtures';
import {
  activeTruces,
  afterGame,
  attackableTargets,
  canRaise,
  checkStake,
  checkTarget,
  clockModifiers,
  launchersFor,
  offeredCountry,
  raiseFloor,
  redirectOptions,
  refillTokens,
  stakeFloor,
  stakeableFromRound,
  suggestStake,
  tributeOptions,
  truceBetween,
  warLocks,
  warTimeControl,
  warTransfers,
  type ActiveWar,
  type Truce,
  type WarBoard,
} from './war';

const ANN = 'ann';
const BO = 'bo';
const idx = indexDataset(warDataset());
const rules = parseRules({});

/** Ann holds the A countries; Bo the B countries plus Q2 and R2; U3 is unclaimed. */
const OWNERS: Record<string, string> = {
  A1: ANN,
  A2: ANN,
  A3: ANN,
  A4: ANN,
  A6: ANN,
  B1: BO,
  B2: BO,
  B5: BO,
  B7: BO,
  B10: BO,
  Q2: BO,
  R2: BO,
};

function board(
  opts: {
    owners?: Record<string, string>;
    acquired?: Record<string, number>;
    wars?: ActiveWar[];
    truces?: Truce[];
    round?: number;
    rules?: WarBoard['rules'];
  } = {},
): WarBoard {
  const owners = opts.owners ?? OWNERS;
  return {
    idx,
    rules: opts.rules ?? rules,
    round: opts.round ?? 1,
    holdings: new Map(
      Object.entries(owners).map(([id, ownerId]) => [id, { ownerId, acquiredRound: opts.acquired?.[id] ?? 0 }]),
    ),
    wars: opts.wars ?? [],
    truces: opts.truces ?? [],
  };
}

const war = (over: Partial<ActiveWar> = {}): ActiveWar => ({
  id: 'w1',
  attackerId: ANN,
  defenderId: BO,
  targetId: 'B5',
  stake: ['A4'],
  offered: null,
  ...over,
});

describe('stake sizes', () => {
  it('needs 80% of the target, rounded up', () => {
    expect([1, 2, 3, 5, 7, 10].map((v) => stakeFloor(rules, v))).toEqual([1, 2, 3, 4, 6, 8]);
  });

  it('raises to 125%, rounded up', () => {
    expect([1, 3, 4, 5, 7, 10].map((v) => raiseFloor(rules, v))).toEqual([2, 4, 5, 7, 9, 13]);
  });
});

describe('war targets', () => {
  it('are enemy countries bordering the empire by land or sea lane', () => {
    expect([...attackableTargets(board(), ANN)].sort()).toEqual(['B1', 'B2', 'B5', 'B7', 'Q2']);
  });

  it('explain why other countries are off limits', () => {
    const b = board();
    expect(checkTarget(b, ANN, 'A1')).toBe('own-country');
    expect(checkTarget(b, ANN, 'U3')).toBe('unclaimed');
    expect(checkTarget(b, ANN, 'B10')).toBe('not-bordering');
    expect(checkTarget(b, ANN, 'XX')).toBe('unknown-territory');
  });

  it('exclude countries caught up in a war, as target or stake', () => {
    expect(checkTarget(board({ wars: [war()] }), ANN, 'B5')).toBe('in-war');
    const counterattack = war({ id: 'w2', attackerId: BO, defenderId: ANN, targetId: 'A3', stake: ['B2'] });
    expect(checkTarget(board({ wars: [counterattack] }), ANN, 'B2')).toBe('in-war');
  });

  it('respect truces until the round they end', () => {
    const truces: Truce[] = [{ players: [ANN, BO], endsRound: 3 }];
    expect(checkTarget(board({ truces, round: 2 }), ANN, 'B5')).toBe('truce');
    expect(checkTarget(board({ truces, round: 2 }), BO, 'A4')).toBe('truce');
    expect(checkTarget(board({ truces, round: 3 }), ANN, 'B5')).toBeNull();
  });

  it('need a bordering country that can launch the attack', () => {
    expect(checkTarget(board({ acquired: { A1: 2 }, round: 3 }), ANN, 'B1')).toBe('no-launcher');
    const busy = war({ id: 'w2', targetId: 'B2', stake: ['A3', 'A1'] });
    expect(checkTarget(board({ wars: [busy] }), ANN, 'B1')).toBe('no-launcher');
  });

  it('need enough connected countries to reach the stake floor', () => {
    const owners = { A1: ANN, A2: BO, B1: BO };
    expect(checkTarget(board({ owners }), ANN, 'A2')).toBe('stake-too-small');
    expect(checkTarget(board({ owners }), ANN, 'B1')).toBeNull();
  });

  it('list launchers that can reach the floor', () => {
    expect(launchersFor(board(), ANN, 'B5')).toEqual(['A4']);
    expect(launchersFor(board({ owners: { ...OWNERS, B2: ANN } }), ANN, 'B5')).toEqual(['A4', 'B2']);
  });
});

describe('stakes', () => {
  const check = (target: string, launch: string, stake: string[], b = board(), opts = {}) =>
    checkStake(b, ANN, target, launch, stake, opts);

  it('accept the launching country plus connected countries worth at least the floor', () => {
    expect(check('B5', 'A4', ['A4'])).toBeNull();
    expect(check('B5', 'A4', ['A4', 'A3', 'A2'])).toBeNull();
  });

  it('may be worth far more than the target', () => {
    expect(check('B1', 'A1', ['A1', 'A2', 'A6'])).toBeNull();
    expect(check('B2', 'A3', ['A3'])).toBeNull();
  });

  it('reject stakes that break the rules', () => {
    expect(check('B5', 'A4', [])).toBe('empty');
    expect(check('B5', 'A4', ['A4', 'A4'])).toBe('duplicate');
    expect(check('B5', 'A4', ['A4', 'XX'])).toBe('unknown-territory');
    expect(check('B5', 'A4', ['A4', 'B2'])).toBe('not-yours');
    expect(check('B5', 'A4', ['A3'])).toBe('launcher-missing');
    expect(check('B5', 'A3', ['A3', 'A4'])).toBe('launcher-not-bordering');
    expect(check('B7', 'A6', ['A6', 'A4'])).toBe('not-connected');
    expect(check('B5', 'A4', ['A4'], board(), { minValue: 7 })).toBe('too-small');
  });

  it('exclude countries in other wars and newly won ones', () => {
    const other = war({ id: 'w2', targetId: 'B2', stake: ['A3'] });
    expect(check('B5', 'A4', ['A4', 'A3'], board({ wars: [other] }))).toBe('in-war');
    expect(check('B5', 'A4', ['A4', 'A3'], board({ wars: [other] }), { exceptWarId: 'w2' })).toBeNull();
    expect(check('B5', 'A4', ['A4', 'A3'], board({ acquired: { A3: 1 }, round: 2 }))).toBe('newly-won');
  });

  it('unlock newly won countries after the lock rounds', () => {
    const b = (round: number) => board({ acquired: { A3: 2 }, round });
    expect(stakeableFromRound(b(3), { ownerId: ANN, acquiredRound: 2 })).toBe(4);
    expect(stakeableFromRound(b(4), { ownerId: ANN, acquiredRound: 2 })).toBeNull();
    expect(stakeableFromRound(b(1), { ownerId: ANN, acquiredRound: 0 })).toBeNull();
    const noLock = board({ rules: parseRules({ war: { lockRounds: 0 } }), acquired: { A3: 2 }, round: 2 });
    expect(stakeableFromRound(noLock, { ownerId: ANN, acquiredRound: 2 })).toBeNull();
  });
});

describe('suggested stakes', () => {
  it('pick the cheapest stake over every launcher', () => {
    expect(suggestStake(board(), ANN, 'B5')).toEqual({ launchId: 'A4', stake: ['A4'], value: 4 });
    expect(suggestStake(board(), ANN, 'B7')).toEqual({ launchId: 'A6', stake: ['A6'], value: 6 });
  });

  it('meet a raise with the cheapest connected additions', () => {
    const raise = { minValue: raiseFloor(rules, 7) };
    expect(suggestStake(board(), ANN, 'B7', raise)).toEqual({ launchId: 'A6', stake: ['A6', 'A1', 'A2'], value: 9 });
  });

  it('prefer fewer countries at the same value', () => {
    const b = board({ owners: { ...OWNERS, Q2: ANN } });
    expect(suggestStake(b, ANN, 'B2', { launchId: 'A3', minValue: 7 })).toEqual({
      launchId: 'A3',
      stake: ['A3', 'A4'],
      value: 7,
    });
  });

  it('can rework a war’s own stake, which the war itself locks', () => {
    const b = board({ wars: [war()] });
    expect(suggestStake(b, ANN, 'B5', { launchId: 'A4', minValue: 7 })).toBeNull();
    expect(suggestStake(b, ANN, 'B5', { launchId: 'A4', minValue: 7, exceptWarId: 'w1' })).toEqual({
      launchId: 'A4',
      stake: ['A4', 'A3'],
      value: 7,
    });
  });

  it('return null when no stake is big enough', () => {
    expect(suggestStake(board({ owners: { A1: ANN, A2: BO } }), ANN, 'A2')).toBeNull();
  });

  it('still answer quickly in a sprawl of small countries', () => {
    // A 12 x 12 grid of value-1 countries: far too many partial stakes to search them all.
    const size = 12;
    const id = (r: number, c: number) => `G${String(r * size + c).padStart(3, '0')}`;
    const cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const land = [
          r > 0 && id(r - 1, c),
          r < size - 1 && id(r + 1, c),
          c > 0 && id(r, c - 1),
          c < size - 1 && id(r, c + 1),
        ].filter((x): x is string => Boolean(x));
        cells.push(makeTerritory(id(r, c), 1, c === size - 1 && r === 0 ? [...land, 'T'] : land));
      }
    }
    const target = makeTerritory('T', 10, [id(0, size - 1)]);
    const gridIdx = indexDataset({ ...warDataset(), territories: [...cells, target], seaLanes: [] });
    const holdings = new Map(cells.map((t) => [t.id, { ownerId: ANN, acquiredRound: 0 }]));
    holdings.set('T', { ownerId: BO, acquiredRound: 0 });
    const b: WarBoard = { idx: gridIdx, rules, round: 1, holdings, wars: [], truces: [] };
    const plan = suggestStake(b, ANN, 'T', { minValue: 13 });
    expect(plan?.value).toBe(13);
    expect(checkStake(b, ANN, 'T', plan!.launchId, plan!.stake, { minValue: 13 })).toBeNull();
  });
});

describe('defender responses', () => {
  it('allow a raise only while the stake is below the raise floor', () => {
    expect(canRaise(board(), war({ stake: ['A4'] }))).toBe(true);
    expect(canRaise(board(), war({ stake: ['A4', 'A3'] }))).toBe(false);
  });

  it('redirect to same-value countries bordering the attacker', () => {
    expect(redirectOptions(board(), war({ targetId: 'B2', stake: ['A3'] }))).toEqual(['Q2']);
    const busy = war({ id: 'w2', targetId: 'Q2', stake: ['A2'] });
    expect(redirectOptions(board({ wars: [busy] }), war({ targetId: 'B2', stake: ['A3'] }))).toEqual([]);
  });

  it('offer tribute from cheaper countries not caught up in a war', () => {
    expect(tributeOptions(board(), war())).toEqual(['B1', 'B2', 'Q2', 'R2']);
    const busy = war({ id: 'w2', targetId: 'B2', stake: ['A3'] });
    expect(tributeOptions(board({ wars: [war(), busy] }), war())).toEqual(['B1', 'Q2', 'R2']);
    expect(tributeOptions(board(), war({ targetId: 'B1', stake: ['A1'] }))).toEqual([]);
  });

  it('lock offered countries while the attacker decides', () => {
    expect(offeredCountry({ kind: 'redirect', targetId: 'Q2' })).toBe('Q2');
    expect(offeredCountry({ kind: 'tribute', territoryId: 'B1', tokens: 0 })).toBe('B1');
    expect(offeredCountry({ kind: 'tribute', territoryId: null, tokens: 2 })).toBeNull();
    expect(offeredCountry({ kind: 'raise', minValue: 7 })).toBeNull();
    expect([...warLocks([war({ offered: 'Q2' })]).keys()].sort()).toEqual(['A4', 'B5', 'Q2']);
  });
});

describe('clock modifiers', () => {
  it('weigh home turf and terrain against supply lines', () => {
    expect(clockModifiers(board(), ANN, 'B5')).toEqual({
      parts: [
        { label: 'Home turf', side: 'defender', pct: 10 },
        { label: 'Supply line', side: 'attacker', pct: 5 },
      ],
      net: 5,
    });
    expect(clockModifiers(board(), ANN, 'B7').net).toBe(15);
    const mountains = clockModifiers(board({ owners: { ...OWNERS, B7: ANN, R2: ANN } }), ANN, 'B10');
    expect(mountains.parts.map((p) => p.label)).toEqual(['Home turf', 'Mountains', 'Supply lines (2)']);
    expect(mountains.net).toBe(10);
  });

  it('cap the advantage', () => {
    const spokes = Array.from({ length: 8 }, (_, i) => makeTerritory(`S${i}`, 1, ['HUB']));
    const hub = makeTerritory(
      'HUB',
      3,
      spokes.map((s) => s.id),
    );
    const starIdx = indexDataset({ ...warDataset(), territories: [hub, ...spokes], seaLanes: [] });
    const holdings = new Map(spokes.map((s) => [s.id, { ownerId: ANN, acquiredRound: 0 }]));
    holdings.set('HUB', { ownerId: BO, acquiredRound: 0 });
    const b: WarBoard = { idx: starIdx, rules, round: 1, holdings, wars: [], truces: [] };
    expect(clockModifiers(b, ANN, 'HUB').net).toBe(-25);
  });

  it('can be switched off', () => {
    const off = board({ rules: parseRules({ war: { clockModifiers: false } }) });
    expect(clockModifiers(off, ANN, 'B7')).toEqual({ parts: [], net: 0 });
  });
});

describe('time controls', () => {
  const live = parseRules({ war: { pace: 'live', liveClock: '5+3' } });

  it('give the favored side extra time and increment', () => {
    expect(warTimeControl(live, { parts: [], net: 15 })).toEqual({
      kind: 'live',
      white: { initialMs: 300_000, incrementMs: 3000 },
      black: { initialMs: 345_000, incrementMs: 3450 },
    });
    expect(warTimeControl(rules, { parts: [], net: -10 })).toEqual({
      kind: 'correspondence',
      white: { perMoveMs: 95_040_000 },
      black: { perMoveMs: 86_400_000 },
    });
  });

  it('give Black four fifths of the time in Armageddon, with the attacker on Black', () => {
    expect(warTimeControl(live, { parts: [], net: 5 }, true)).toEqual({
      kind: 'live',
      white: { initialMs: 315_000, incrementMs: 3150 },
      black: { initialMs: 240_000, incrementMs: 2400 },
    });
  });
});

describe('resolution', () => {
  const armageddon = parseRules({ war: { draws: 'armageddon' } });

  it('turns game results into war outcomes', () => {
    expect(afterGame(rules, false, 'white')).toBe('attacker');
    expect(afterGame(rules, false, 'black')).toBe('defender');
    expect(afterGame(rules, false, null)).toBe('held');
    expect(afterGame(armageddon, false, null)).toBe('armageddon');
    expect(afterGame(armageddon, true, 'white')).toBe('defender');
    expect(afterGame(armageddon, true, 'black')).toBe('attacker');
    expect(afterGame(armageddon, true, null)).toBe('attacker');
  });

  it('moves the target or the stake', () => {
    const w = war({ stake: ['A4', 'A3'] });
    expect(warTransfers(w, 'attacker')).toEqual([{ territoryId: 'B5', from: BO, to: ANN }]);
    expect(warTransfers(w, 'defender')).toEqual([
      { territoryId: 'A4', from: ANN, to: BO },
      { territoryId: 'A3', from: ANN, to: BO },
    ]);
    expect(warTransfers(w, 'held')).toEqual([]);
  });

  it('refills tokens up to the cap, keeping tribute above it', () => {
    expect([0, 2, 3, 5].map((t) => refillTokens(rules, t))).toEqual([1, 3, 3, 5]);
    expect(refillTokens(parseRules({ war: { tokensPerRound: 2 } }), 2)).toBe(3);
  });

  it('starts truces after fought and paid-off wars, not withdrawals', () => {
    const resolved = [
      { attackerId: ANN, defenderId: BO, outcome: 'held' as const, resolvedRound: 2 },
      { attackerId: BO, defenderId: 'cy', outcome: 'withdrawn' as const, resolvedRound: 2 },
      { attackerId: BO, defenderId: ANN, outcome: 'tribute' as const, resolvedRound: 1 },
    ];
    const truces = activeTruces(rules, 2, resolved);
    expect(truces).toEqual([{ players: [ANN, BO], endsRound: 3 }]);
    expect(truceBetween(board({ truces, round: 2 }), BO, ANN)).toBeDefined();
    expect(truceBetween(board({ truces, round: 2 }), BO, 'cy')).toBeUndefined();
    expect(activeTruces(rules, 3, resolved)).toEqual([]);
  });
});
