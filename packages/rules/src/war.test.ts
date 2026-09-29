import { describe, expect, it } from 'vitest';
import { REVISED_WAR_RULES, parseRules } from './config';
import type { Accord, Renunciation } from './diplomacy';
import { indexDataset } from './graph';
import { makeTerritory, warDataset } from './test-fixtures';
import {
  WHITE_PEACE,
  activeTruces,
  activeWar,
  afterGame,
  attackableTargets,
  canRaise,
  canRecall,
  checkFortify,
  checkReserves,
  checkStake,
  checkTarget,
  clockModifiers,
  clockTarget,
  counterCost,
  declarationFloor,
  fortifiedUntil,
  isWhitePeace,
  launchersFor,
  offeredCountry,
  peaceIssue,
  peaceTermsText,
  peaceTransfers,
  raiseDemand,
  raiseFloor,
  matchedRaiseRange,
  raiseOptions,
  redirectOptions,
  refillTokens,
  stakeFloor,
  stakeFromReserves,
  stakeableFromRound,
  suggestStake,
  tributeCountries,
  tributeOptions,
  truceBetween,
  warLocks,
  warTimeControl,
  warTransfers,
  type ActiveWar,
  type PeaceTerms,
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
    accords?: Accord[];
    renunciations?: Renunciation[];
    round?: number;
    rules?: WarBoard['rules'];
    /** The round each fortified country's fortification ends. */
    fortified?: Record<string, number>;
  } = {},
): WarBoard {
  const owners = opts.owners ?? OWNERS;
  return {
    idx,
    rules: opts.rules ?? rules,
    round: opts.round ?? 1,
    holdings: new Map(
      Object.entries(owners).map(([id, ownerId]) => [
        id,
        { ownerId, acquiredRound: opts.acquired?.[id] ?? 0, fortifiedUntil: opts.fortified?.[id] ?? null },
      ]),
    ),
    wars: opts.wars ?? [],
    truces: opts.truces ?? [],
    accords: opts.accords ?? [],
    renunciations: opts.renunciations ?? [],
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

  it('respect accords both ways until the round they end', () => {
    const accords: Accord[] = [{ id: 'a1', players: [BO, ANN], endsRound: 4 }];
    expect(checkTarget(board({ accords, round: 3 }), ANN, 'B5')).toBe('accord');
    expect(checkTarget(board({ accords, round: 3 }), BO, 'A4')).toBe('accord');
    expect(attackableTargets(board({ accords, round: 3 }), ANN).size).toBe(0);
    expect(checkTarget(board({ accords, round: 4 }), ANN, 'B5')).toBeNull();
  });

  it('keep an accord breaker from attacking the betrayed player until the next round', () => {
    const renunciations: Renunciation[] = [{ breakerId: ANN, partnerId: BO, untilRound: 3 }];
    expect(checkTarget(board({ renunciations, round: 2 }), ANN, 'B5')).toBe('renounced');
    // The betrayed player may strike first.
    expect(checkTarget(board({ renunciations, round: 2 }), BO, 'A4')).toBeNull();
    expect(checkTarget(board({ renunciations, round: 3 }), ANN, 'B5')).toBeNull();
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
    const b: WarBoard = {
      idx: gridIdx,
      rules,
      round: 1,
      holdings,
      wars: [],
      truces: [],
      accords: [],
      renunciations: [],
    };
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
    const b: WarBoard = {
      idx: starIdx,
      rules,
      round: 1,
      holdings,
      wars: [],
      truces: [],
      accords: [],
      renunciations: [],
    };
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

describe('fortified countries', () => {
  const fortifying = parseRules({ war: { fortify: true } });

  it('need a raised stake until the round their fortification ends', () => {
    const b = board({ rules: fortifying, fortified: { B5: 3 }, round: 2 });
    expect(fortifiedUntil(b, 'B5')).toBe(3);
    // B5 is worth 5: 80% is 4, a raise's 125% is 7.
    expect(declarationFloor(b, 'B5')).toBe(7);
    expect(checkStake(b, ANN, 'B5', 'A4', ['A4'])).toBe('too-small');
    expect(checkStake(b, ANN, 'B5', 'A4', ['A4', 'A3'])).toBeNull();
    expect(suggestStake(b, ANN, 'B5')?.value).toBe(7);
    const after = board({ rules: fortifying, fortified: { B5: 3 }, round: 3 });
    expect(fortifiedUntil(after, 'B5')).toBeNull();
    expect(declarationFloor(after, 'B5')).toBe(4);
  });

  it('can be out of reach when the connected countries fall short', () => {
    // Fortified B7 (7) needs 9, which A6 reaches through the rest of Ann's empire.
    const b = board({ rules: fortifying, fortified: { B7: 4 }, round: 2 });
    expect(checkTarget(b, ANN, 'B7')).toBeNull();
    const small = board({ rules: fortifying, owners: { ...OWNERS, A1: BO, A2: BO }, fortified: { B7: 4 }, round: 2 });
    // A6 is cut off from the rest: alone it's worth 6, short of fortified B7's 9.
    expect(checkTarget(small, ANN, 'B7')).toBe('stake-too-small');
  });

  it('are the owner’s to fortify, and a fortification can be extended but not repeated', () => {
    expect(checkFortify(board(), ANN, 'A4')).toBe('off');
    expect(checkFortify(board({ rules: fortifying }), ANN, 'B5')).toBe('not-yours');
    expect(checkFortify(board({ rules: fortifying }), ANN, 'ZZ')).toBe('unknown-territory');
    expect(checkFortify(board({ rules: fortifying, round: 2 }), ANN, 'A4')).toBeNull();
    // Fortified in round 2 until round 4 starts: again in round 2 adds nothing, in round 3 it extends.
    expect(checkFortify(board({ rules: fortifying, round: 2, fortified: { A4: 4 } }), ANN, 'A4')).toBe('fortified');
    expect(checkFortify(board({ rules: fortifying, round: 3, fortified: { A4: 4 } }), ANN, 'A4')).toBeNull();
  });
});

describe('raise styles', () => {
  const matched = parseRules({ war: { raise: 'matched' } });

  it('matched: the defender puts in one of their countries, worth half the target to all of it', () => {
    // Ann attacks B7 (7) over the sea from A6.
    const w = war({ targetId: 'B7', stake: ['A6'] });
    const b = board({ rules: matched, wars: [w] });
    // Bo's free countries worth 4 to 7: B5. B1, B2, Q2 and R2 are worth too little, B10 too much.
    expect(matchedRaiseRange(7)).toEqual({ min: 4, max: 7 });
    expect(raiseOptions(b, w)).toEqual(['B5']);
    expect(canRaise(b, w)).toBe(true);
    // The attacker must bring the stake (A6, 6) up by B5's 5.
    expect(raiseDemand(b, w, 'B5')).toBe(11);
    expect(counterCost(matched, 'raise')).toBe(0);
    // Against B5 (5) Bo has nothing worth 3 to 5 to put in.
    expect(raiseOptions(board({ rules: matched, wars: [war()] }), war())).toEqual([]);
    expect(canRaise(board({ rules: matched, wars: [war()] }), war())).toBe(false);
  });

  it('matched: only what the attacker could still add', () => {
    // Staking A6, A2, A1 and A3 (12) leaves A4 (4) to add: short of B5's 5.
    const most = war({ targetId: 'B7', stake: ['A6', 'A2', 'A1', 'A3'] });
    expect(raiseOptions(board({ rules: matched, wars: [most] }), most)).toEqual([]);
    const some = war({ targetId: 'B7', stake: ['A6', 'A2'] });
    expect(raiseOptions(board({ rules: matched, wars: [some] }), some)).toEqual(['B5']);
  });

  it('token: a raise to a percentage that costs the defender a token', () => {
    const token = parseRules({ war: { raise: 'token' } });
    expect(canRaise(board({ rules: token }), war({ stake: ['A4'] }))).toBe(true);
    expect(canRaise(board({ rules: token }), war({ stake: ['A4', 'A3'] }))).toBe(false);
    expect(raiseDemand(board({ rules: token }), war())).toBe(7);
    expect(counterCost(token, 'raise')).toBe(1);
    expect(counterCost(rules, 'raise')).toBe(0);
  });

  it('off: no raising at all', () => {
    expect(canRaise(board({ rules: parseRules({ war: { raise: 'off' } }) }), war())).toBe(false);
  });

  it('a met matched raise leaves the added country at stake, won with the target', () => {
    const row = {
      id: 'w1',
      attackerId: ANN,
      defenderId: BO,
      targetId: 'B5',
      stake: ['A4', 'A3'],
      counter: { kind: 'raise' as const, minValue: 6, added: 'B2' },
    };
    // While the attacker decides it's on offer; once they meet it, it's at stake.
    expect(activeWar({ ...row, status: 'countered' })).toMatchObject({ offered: 'B2', added: null });
    expect(activeWar({ ...row, status: 'playing' })).toMatchObject({ offered: null, added: 'B2' });
    expect([...warLocks([activeWar({ ...row, status: 'playing' })]).keys()].sort()).toEqual(['A3', 'A4', 'B2', 'B5']);
    expect(warTransfers({ ...row }, 'attacker')).toEqual([
      { territoryId: 'B5', from: BO, to: ANN },
      { territoryId: 'B2', from: BO, to: ANN },
    ]);
    expect(warTransfers({ ...row }, 'defender').map((t) => t.territoryId)).toEqual(['A4', 'A3']);
    expect(offeredCountry(row.counter)).toBe('B2');
  });
});

describe('reserves', () => {
  const matched = parseRules({ war: { raise: 'matched' } });

  it('are the attacker’s free countries joined to the stake', () => {
    const b = board({ rules: matched });
    expect(checkReserves(b, ANN, 'A4', ['A4'], ['A3', 'A2'])).toBeNull();
    expect(checkReserves(b, ANN, 'A4', ['A4'], ['A2'])).toBe('not-connected');
    expect(checkReserves(b, ANN, 'A4', ['A4'], ['A4'])).toBe('in-stake');
    expect(checkReserves(b, ANN, 'A4', ['A4'], ['B2'])).toBe('not-yours');
    expect(checkReserves(b, ANN, 'A4', ['A4'], ['A3', 'A3'])).toBe('duplicate');
    expect(checkReserves(board(), ANN, 'A4', ['A4'], ['A3'])).toBe('no-raise');
    expect(checkReserves(board(), ANN, 'A4', ['A4'], [])).toBeNull();
    const busy = war({ id: 'w2', targetId: 'B2', stake: ['A3'] });
    expect(checkReserves(board({ rules: matched, wars: [busy] }), ANN, 'A4', ['A4'], ['A3'])).toBe('in-war');
  });

  it('are tied up while the declaration waits, and free once the war goes ahead', () => {
    const row = { id: 'w1', attackerId: ANN, defenderId: BO, targetId: 'B5', stake: ['A4'], counter: null };
    expect(activeWar({ ...row, status: 'declared', reserves: ['A3'] }).reserves).toEqual(['A3']);
    expect(activeWar({ ...row, status: 'playing', reserves: ['A3'] }).reserves).toEqual([]);
    expect(warLocks([war({ reserves: ['A3'] })]).get('A3')).toBe('w1');
  });

  it('meet a raise with the cheapest of them that keeps the stake in one piece', () => {
    // A4 (4) staked; A3 (3), A2 (2), A1 (1) and A6 (6) in reserve, in a chain from A3.
    expect(stakeFromReserves(idx, ['A4'], ['A3', 'A2', 'A1', 'A6'], 7)).toEqual(['A4', 'A3']);
    expect(stakeFromReserves(idx, ['A4'], ['A3', 'A2', 'A1', 'A6'], 9)).toEqual(['A4', 'A2', 'A3']);
    // A6 only joins through A2 and A3.
    expect(stakeFromReserves(idx, ['A4'], ['A3', 'A2', 'A6'], 15)).toEqual(['A4', 'A2', 'A3', 'A6']);
    expect(stakeFromReserves(idx, ['A4'], ['A2', 'A6'], 6)).toBeNull();
    expect(stakeFromReserves(idx, ['A4'], ['A3'], 20)).toBeNull();
  });
});

describe('nearby redirects', () => {
  // L and M are the attacker's; T, N and F the defender's, all worth 3. N borders the target T; F doesn't.
  const small = indexDataset({
    version: 'test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    attribution: [],
    territories: [
      { ...makeTerritory('L', 3, ['T', 'N', 'M']) },
      { ...makeTerritory('M', 3, ['L', 'F']) },
      { ...makeTerritory('T', 3, ['L', 'N']), terrain: ['mountains'] },
      makeTerritory('N', 3, ['T', 'L']),
      makeTerritory('F', 3, ['M']),
    ],
    seaLanes: [],
  });
  const owners = { L: ANN, M: ANN, T: BO, N: BO, F: BO };
  const onT = war({ targetId: 'T', stake: ['L'] });
  const smallBoard = (r: WarBoard['rules']): WarBoard => ({ ...board({ owners, rules: r }), idx: small });

  it('offer only countries bordering the original target', () => {
    expect(redirectOptions(smallBoard(rules), onT)).toEqual(['F', 'N']);
    expect(redirectOptions(smallBoard(parseRules({ war: { redirect: 'nearby' } })), onT)).toEqual(['N']);
  });

  it('keep the original target’s clock', () => {
    const nearby = parseRules({ war: { redirect: 'nearby' } });
    const redirected = { targetId: 'N', redirectedFrom: 'T' };
    expect(clockTarget(nearby, redirected)).toBe('T');
    expect(clockTarget(rules, redirected)).toBe('N');
    expect(clockTarget(nearby, { targetId: 'T', redirectedFrom: null })).toBe('T');
    // T's mountains stay with the war fought for N.
    expect(clockModifiers(smallBoard(nearby), ANN, clockTarget(nearby, redirected)).net).toBeGreaterThan(
      clockModifiers(smallBoard(nearby), ANN, 'N').net,
    );
  });

  it('can cost a token', () => {
    expect(counterCost(parseRules({ war: { redirectToken: true } }), 'redirect')).toBe(1);
    expect(counterCost(rules, 'redirect')).toBe(0);
  });
});

describe('recall', () => {
  it('is possible only before the defender answers, where the rules allow it', () => {
    const recalling = parseRules({ war: { recall: true } });
    expect(canRecall(recalling, 'declared')).toBe(true);
    expect(canRecall(recalling, 'countered')).toBe(false);
    expect(canRecall(rules, 'declared')).toBe(false);
  });
});

describe('peace terms', () => {
  const peace = parseRules({ war: REVISED_WAR_RULES });
  const tokens = { attacker: 2, defender: 1 };
  const terms = (over: Partial<PeaceTerms> = {}): PeaceTerms => ({ ...WHITE_PEACE, ...over });
  const w = war({ stake: ['A4', 'A3'] });
  const b = board({ rules: peace, wars: [w] });

  it('replace tribute as an answer', () => {
    expect(tributeOptions(b, w)).toEqual([]);
    expect(tributeCountries(b, w)).toEqual(['B1', 'B2', 'Q2', 'R2']);
  });

  it('hand over staked countries, the target, or one cheaper country, and tokens one way', () => {
    expect(peaceIssue(b, w, WHITE_PEACE, tokens)).toBeNull();
    expect(isWhitePeace(terms({ accordRounds: 3 }))).toBe(true);
    expect(peaceIssue(b, w, terms({ toDefender: ['A3'] }), tokens)).toBeNull();
    expect(peaceIssue(b, w, terms({ toAttacker: ['B5'] }), tokens)).toBeNull();
    expect(peaceIssue(b, w, terms({ toAttacker: ['Q2'], accordRounds: 3 }), tokens)).toBeNull();
    expect(peaceIssue(b, w, terms({ tokensToAttacker: 1 }), tokens)).toBeNull();
    // Not staked, not the target, worth too much, or too many.
    expect(peaceIssue(b, w, terms({ toDefender: ['A1'] }), tokens)).toBe('bad-country');
    expect(peaceIssue(b, w, terms({ toAttacker: ['B7'] }), tokens)).toBe('bad-country');
    expect(peaceIssue(b, w, terms({ toAttacker: ['B5', 'Q2'] }), tokens)).toBe('bad-tribute');
    expect(peaceIssue(b, w, terms({ toAttacker: ['Q2', 'R2'] }), tokens)).toBe('bad-tribute');
    expect(peaceIssue(b, w, terms({ toDefender: ['A3', 'A3'] }), tokens)).toBe('duplicate');
    // Tokens: one way, and only what the payer holds.
    expect(peaceIssue(b, w, terms({ tokensToAttacker: 1, tokensToDefender: 1 }), tokens)).toBe('tokens-both-ways');
    expect(peaceIssue(b, w, terms({ tokensToAttacker: 2 }), tokens)).toBe('short-of-tokens');
    expect(peaceIssue(b, w, terms({ tokensToDefender: -1 }), tokens)).toBe('bad-tokens');
    expect(peaceIssue(b, w, terms({ accordRounds: 11 }), tokens)).toBe('bad-accord');
    expect(peaceIssue(board({ wars: [w] }), w, WHITE_PEACE, tokens)).toBe('off');
  });

  it('can hand over a country a matched raise added', () => {
    const raised = { ...w, added: 'B2' };
    expect(
      peaceIssue(board({ rules: peace, wars: [raised] }), raised, terms({ toAttacker: ['B5', 'B2'] }), tokens),
    ).toBeNull();
  });

  it('move the countries they name', () => {
    expect(peaceTransfers(w, terms({ toAttacker: ['B5'], toDefender: ['A3'] }))).toEqual([
      { territoryId: 'B5', from: BO, to: ANN },
      { territoryId: 'A3', from: ANN, to: BO },
    ]);
  });

  it('read out in words', () => {
    const names = { attacker: 'Ann', defender: 'you', country: (id: string) => id };
    expect(peaceTermsText(WHITE_PEACE, names)).toBe('A white peace: nothing changes hands');
    expect(peaceTermsText(terms({ accordRounds: 1 }), names)).toBe('A white peace, with an accord for 1 round');
    expect(peaceTermsText(terms({ toAttacker: ['B5'], tokensToDefender: 2, accordRounds: 3 }), names)).toBe(
      'B5 goes to Ann; 2 war tokens go to you; with an accord for 3 rounds',
    );
    expect(peaceTermsText(terms({ toDefender: ['A3', 'A4'], tokensToAttacker: 1 }), names)).toBe(
      'A3 and A4 go to you; 1 war token goes to Ann',
    );
  });

  it('bring a truce like a war fought out', () => {
    const settled = [{ attackerId: ANN, defenderId: BO, outcome: 'settled' as const, resolvedRound: 2 }];
    expect(activeTruces(rules, 2, settled)).toEqual([{ players: [ANN, BO], endsRound: 3 }]);
  });
});
