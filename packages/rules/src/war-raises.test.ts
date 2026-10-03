import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseRules } from './config';
import type { Dataset } from './dataset';
import { indexDataset } from './graph';
import { makeTerritory } from './test-fixtures';
import {
  activeTruces,
  activeWar,
  addedCountries,
  attackerRaiseMore,
  attackerRaiseRange,
  attackerRaised,
  canRaiseAgain,
  conceded,
  declaredStake,
  defenderAnswerOptions,
  owedByDefender,
  raiseAnswerer,
  raiseOptions,
  raisesMade,
  waitingOn,
  warLocks,
  warTransfers,
  type WarBoard,
  type WarCounter,
} from './war';

const ANN = 'ann';
const BO = 'bo';

/**
 * Ann's chain a1 - a2 - a3 - a4 (10 each), a1 bordering Bo's target t (8). Bo also holds b1 (4),
 * b2 (6), b3 (8), b4 (2) and b5 (12), each bordering t.
 */
function dataset(): Dataset {
  return {
    version: 'raise-test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    attribution: [],
    territories: [
      makeTerritory('a1', 10, ['a2', 't']),
      makeTerritory('a2', 10, ['a1', 'a3']),
      makeTerritory('a3', 10, ['a2', 'a4']),
      makeTerritory('a4', 10, ['a3']),
      makeTerritory('t', 8, ['a1', 'b1', 'b2', 'b3', 'b4', 'b5']),
      makeTerritory('b1', 4, ['t']),
      makeTerritory('b2', 6, ['t']),
      makeTerritory('b3', 8, ['t']),
      makeTerritory('b4', 2, ['t']),
      makeTerritory('b5', 12, ['t']),
    ],
    seaLanes: [],
  };
}

const idx = indexDataset(dataset());
const threeRaises = parseRules({ war: { raise: 'matched', raises: 3 } });

interface Row {
  id: string;
  attackerId: string;
  defenderId: string;
  targetId: string;
  stake: string[];
  status: string;
  counter: WarCounter | null;
}

function board(row: Row, opts: { rules?: WarBoard['rules']; owners?: Record<string, string> } = {}): WarBoard {
  const owners = opts.owners ?? {
    a1: ANN,
    a2: ANN,
    a3: ANN,
    a4: ANN,
    t: BO,
    b1: BO,
    b2: BO,
    b3: BO,
    b4: BO,
    b5: BO,
  };
  return {
    idx,
    rules: opts.rules ?? threeRaises,
    round: 1,
    holdings: new Map(Object.entries(owners).map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
    wars: [activeWar(row)],
    truces: [],
    accords: [],
    renunciations: [],
  };
}

const declared: Row = {
  id: 'w1',
  attackerId: ANN,
  defenderId: BO,
  targetId: 't',
  stake: ['a1'],
  status: 'declared',
  counter: null,
};

/** Bo put in b1 (4): Ann's stake (a1, 10) must reach 14. */
const firstRaise: Row = { ...declared, status: 'countered', counter: { kind: 'raise', minValue: 14, added: 'b1' } };

/** Ann met it and staked 6 over it (a1 and a2, 20): Bo owes a country worth 6. */
const annRaised: Row = {
  ...firstRaise,
  stake: ['a1', 'a2'],
  counter: {
    kind: 'raise',
    minValue: 14,
    added: 'b1',
    declared: ['a1'],
    steps: [{ by: 'attacker', stake: ['a1', 'a2'], more: 6 }],
  },
};

/** Bo put in b5 (12): 6 to meet Ann's raise, 6 more. Ann's stake must reach 26. */
const boRaised: Row = {
  ...annRaised,
  counter: {
    kind: 'raise',
    minValue: 26,
    added: 'b1',
    declared: ['a1'],
    steps: [
      { by: 'attacker', stake: ['a1', 'a2'], more: 6 },
      { by: 'defender', territoryId: 'b5', more: 6 },
    ],
  },
};

describe('raising back and forth', () => {
  it('is off unless the host allows more than one raise, as campaigns stored before played', () => {
    expect(parseRules({}).war.raises).toBe(1);
    expect(parseRules({ war: { raise: 'matched' } }).war.raises).toBe(1);
    expect(DEFAULT_RULES.war.raises).toBe(3);
    expect(() => parseRules({ war: { raises: 0 } })).toThrow();
    expect(() => parseRules({ war: { raises: 6 } })).toThrow();
    const single = parseRules({ war: { raise: 'matched' } });
    expect(canRaiseAgain(single, firstRaise.counter)).toBe(false);
    expect(attackerRaiseRange(board(firstRaise, { rules: single }), activeWar(firstRaise), firstRaise.counter)).toBe(
      null,
    );
    // Only a matched raise goes back and forth.
    const token = parseRules({ war: { raise: 'token', raises: 3 } });
    expect(canRaiseAgain(token, { kind: 'raise', minValue: 10 })).toBe(false);
  });

  it('counts raises, and knows who answers', () => {
    expect(raisesMade(null)).toBe(0);
    expect(raisesMade(firstRaise.counter)).toBe(1);
    expect(raisesMade(annRaised.counter)).toBe(2);
    expect(raisesMade(boRaised.counter)).toBe(3);
    expect(raiseAnswerer(firstRaise.counter!)).toBe('attacker');
    expect(raiseAnswerer(annRaised.counter!)).toBe('defender');
    expect(raiseAnswerer(boRaised.counter!)).toBe('attacker');
    expect(raiseAnswerer({ kind: 'redirect', targetId: 'b3' })).toBe('attacker');
    expect(waitingOn(declared)).toBe(BO);
    expect(waitingOn(firstRaise)).toBe(ANN);
    expect(waitingOn(annRaised)).toBe(BO);
    expect(waitingOn(boRaised)).toBe(ANN);
    expect(waitingOn({ ...boRaised, status: 'playing' })).toBeNull();
    expect(attackerRaised(firstRaise.counter)).toBe(false);
    expect(attackerRaised(annRaised.counter)).toBe(true);
    expect(owedByDefender(annRaised.counter)).toBe(6);
    expect(owedByDefender(boRaised.counter)).toBe(0);
  });

  it('lets the attacker raise again by half the target to all of it, and no more than the defender could meet', () => {
    const w = activeWar(firstRaise);
    // t is worth 8: a raise is 4 to 8. Bo's biggest country free to put in is b5 (12).
    expect(attackerRaiseRange(board(firstRaise), w, firstRaise.counter)).toEqual({ min: 4, max: 8 });
    // With only b2 (6) left to put in, Ann can raise by 6 at most.
    const owners = { a1: ANN, a2: ANN, a3: ANN, a4: ANN, t: BO, b1: BO, b2: BO };
    expect(attackerRaiseRange(board(firstRaise, { owners }), w, firstRaise.counter)).toEqual({ min: 4, max: 6 });
    // With nothing worth 4 left, Ann can only meet the raise.
    const poor = { a1: ANN, a2: ANN, a3: ANN, a4: ANN, t: BO, b1: BO, b4: BO };
    expect(attackerRaiseRange(board(firstRaise, { owners: poor }), w, firstRaise.counter)).toBeNull();
    // Without the reach to stake 14 + 4, neither.
    const short = { a1: ANN, t: BO, b1: BO, b5: BO };
    expect(attackerRaiseRange(board(firstRaise, { owners: short }), w, firstRaise.counter)).toBeNull();
    // A stake further over raises by the most.
    expect(attackerRaiseMore({ max: 8 }, 14, 20)).toBe(6);
    expect(attackerRaiseMore({ max: 8 }, 14, 30)).toBe(8);
    // Not while it's the defender's turn to answer.
    expect(attackerRaiseRange(board(annRaised), activeWar(annRaised), annRaised.counter)).toBeNull();
  });

  it('lets the defender meet with any country worth what the raise asks, or raise again with more', () => {
    const w = activeWar(annRaised);
    // Owed 6: b2 (6), b3 (8) and b5 (12) meet it; b5 is 6 over, within 4 to 8 and what Ann could add (20).
    expect(defenderAnswerOptions(board(annRaised), w, annRaised.counter)).toEqual({
      meet: ['b2', 'b3', 'b5'],
      raise: ['b5'],
    });
    // The third raise is the last with three allowed: Bo can only meet it.
    const two = parseRules({ war: { raise: 'matched', raises: 2 } });
    expect(defenderAnswerOptions(board(annRaised, { rules: two }), w, annRaised.counter)).toEqual({
      meet: ['b2', 'b3', 'b5'],
      raise: [],
    });
    // Nothing to answer while the attacker must.
    expect(defenderAnswerOptions(board(firstRaise), activeWar(firstRaise), firstRaise.counter)).toEqual({
      meet: [],
      raise: [],
    });
    // The first raise is unchanged.
    expect(raiseOptions(board(declared), activeWar(declared))).toEqual(['b1', 'b2', 'b3']);
  });

  it('keeps every country put in tied up, and at stake once met', () => {
    expect(addedCountries(boRaised.counter)).toEqual(['b1', 'b5']);
    expect(activeWar(boRaised).added).toEqual(['b1', 'b5']);
    expect([...warLocks([activeWar(boRaised)]).keys()].sort()).toEqual(['a1', 'a2', 'b1', 'b5', 't']);
    const met = { ...boRaised, status: 'playing', stake: ['a1', 'a2', 'a3'] };
    expect(warTransfers(met, 'attacker').map((t) => t.territoryId)).toEqual(['t', 'b1', 'b5']);
    expect(warTransfers(met, 'defender').map((t) => t.territoryId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('makes backing down after raising lose the war as declared, without a game', () => {
    // Bo backs down from Ann's raise: only the target goes; the countries Bo put in stay.
    expect(warTransfers(annRaised, 'yielded')).toEqual([{ territoryId: 't', from: BO, to: ANN }]);
    // Ann backs down from Bo's: the stake as declared goes, not what she added since.
    expect(declaredStake(boRaised)).toEqual(['a1']);
    expect(warTransfers(boRaised, 'forfeited')).toEqual([{ territoryId: 'a1', from: ANN, to: BO }]);
    expect(declaredStake(firstRaise)).toEqual(['a1']);
    expect(conceded('yielded')).toBe(true);
    expect(conceded('forfeited')).toBe(true);
    expect(conceded('attacker')).toBe(false);
    // A truce follows, as after a war fought out.
    expect(
      activeTruces(threeRaises, 2, [{ attackerId: ANN, defenderId: BO, outcome: 'yielded', resolvedRound: 2 }]),
    ).toEqual([{ players: [ANN, BO], endsRound: 3 }]);
  });
});
