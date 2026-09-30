import { describe, expect, it } from 'vitest';
import { parseRules } from './config';
import { indexDataset } from './graph';
import { warDataset } from './test-fixtures';
import { canTakeTurn, checkTurn, nextTurn, turnOrder, turnsBefore, type TurnState } from './turns';
import type { WarBoard } from './war';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';
const DI = 'di';
const idx = indexDataset(warDataset());

/** Ann holds the A countries; Bo the B countries plus Q2 and R2. */
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

function board(opts: { owners?: Record<string, string>; fortify?: boolean; fortified?: Record<string, number> } = {}) {
  return {
    idx,
    rules: parseRules({ war: { fortify: opts.fortify ?? false } }),
    round: 2,
    holdings: new Map(
      Object.entries(opts.owners ?? OWNERS).map(([id, ownerId]) => [
        id,
        { ownerId, acquiredRound: 0, fortifiedUntil: opts.fortified?.[id] ?? null },
      ]),
    ),
    wars: [],
    truces: [],
    accords: [],
    renunciations: [],
  } satisfies WarBoard;
}

describe('the order of turns', () => {
  const seats = [ANN, BO, CY, DI];

  it('starts round 1 with whoever drafted last, then moves on a seat each round', () => {
    expect(turnOrder(seats, 1)).toEqual([DI, ANN, BO, CY]);
    expect(turnOrder(seats, 2)).toEqual([ANN, BO, CY, DI]);
    expect(turnOrder(seats, 3)).toEqual([BO, CY, DI, ANN]);
    expect(turnOrder(seats, 5)).toEqual([DI, ANN, BO, CY]);
    expect(turnOrder(seats, 6)).toEqual([ANN, BO, CY, DI]);
  });

  it('gives everyone the first turn equally often', () => {
    const firsts = Array.from({ length: 12 }, (_, i) => turnOrder(seats, i + 1)[0]);
    for (const id of seats) expect(firsts.filter((f) => f === id)).toHaveLength(3);
    expect(turnOrder([ANN, BO], 1)).toEqual([BO, ANN]);
    expect(turnOrder([], 3)).toEqual([]);
  });
});

describe('whose turn comes next', () => {
  const order = [ANN, BO, CY, DI];
  const anyone = () => true;

  it('goes round the table from the player who just took a turn, coming back to them last', () => {
    expect(nextTurn({ order, passed: [] }, null, anyone)).toBe(ANN);
    expect(nextTurn({ order, passed: [] }, ANN, anyone)).toBe(BO);
    expect(nextTurn({ order, passed: [] }, DI, anyone)).toBe(ANN);
    expect(nextTurn({ order, passed: [BO, CY, DI] }, ANN, anyone)).toBe(ANN);
  });

  it('passes over players who passed or have nothing to do', () => {
    expect(nextTurn({ order, passed: [BO] }, ANN, anyone)).toBe(CY);
    expect(nextTurn({ order, passed: [] }, ANN, (id) => id !== BO && id !== CY)).toBe(DI);
    expect(nextTurn({ order, passed: [ANN] }, ANN, (id) => id === ANN)).toBeNull();
    expect(nextTurn({ order, passed: [ANN, BO, CY, DI] }, null, anyone)).toBeNull();
  });

  it('keeps a player busy in a live game waiting until nobody else can go', () => {
    const busy = (id: string) => id === BO;
    expect(nextTurn({ order, passed: [] }, ANN, anyone, busy)).toBe(CY);
    expect(nextTurn({ order, passed: [CY, DI] }, ANN, (id) => id !== ANN, busy)).toBe(BO);
    expect(nextTurn({ order, passed: [ANN, CY, DI] }, ANN, anyone, busy)).toBe(BO);
  });
});

describe('taking a turn', () => {
  const state = (over: Partial<TurnState> = {}): TurnState => ({
    order: [ANN, BO, CY],
    passed: [],
    current: ANN,
    ...over,
  });

  it('is only for the player whose turn it is, until declaring is over', () => {
    expect(checkTurn(state(), ANN)).toBeNull();
    expect(checkTurn(state(), BO)).toBe('not-your-turn');
    expect(checkTurn(state({ current: null }), ANN)).toBe('turns-over');
    // No turns this round: anyone declares.
    expect(checkTurn(null, BO)).toBeNull();
  });

  it('needs a token and a country to declare war on or fortify', () => {
    expect(canTakeTurn(board(), ANN, 1)).toBe(true);
    expect(canTakeTurn(board(), ANN, 0)).toBe(false);
    // Bo alone on the map: nobody to attack, and fortifying is off.
    const alone = Object.fromEntries(Object.keys(OWNERS).map((id) => [id, BO]));
    expect(canTakeTurn(board({ owners: alone }), BO, 1)).toBe(false);
    expect(canTakeTurn(board({ owners: alone, fortify: true }), BO, 1)).toBe(true);
    // Everything already fortified as long as it can be: nothing to do but pass.
    const fortified = Object.fromEntries(Object.keys(OWNERS).map((id) => [id, 4]));
    expect(canTakeTurn(board({ owners: alone, fortify: true, fortified }), BO, 1)).toBe(false);
    expect(canTakeTurn(board({ fortify: true }), ANN, 0)).toBe(false);
  });

  it('counts the turns to come before a player’s', () => {
    expect(turnsBefore(state(), ANN)).toBe(0);
    expect(turnsBefore(state(), BO)).toBe(1);
    expect(turnsBefore(state(), CY)).toBe(2);
    expect(turnsBefore(state({ passed: [BO] }), CY)).toBe(1);
    expect(turnsBefore(state({ current: CY }), BO)).toBe(2);
    expect(turnsBefore(state({ passed: [BO] }), BO)).toBeNull();
    expect(turnsBefore(state({ current: null }), BO)).toBeNull();
    expect(turnsBefore(state(), DI)).toBeNull();
    // Bo has nothing to do, so his turn will be passed over; the player whose turn it is still counts.
    expect(turnsBefore(state(), CY, (id) => id !== BO)).toBe(1);
    expect(turnsBefore(state({ current: BO }), ANN, (id) => id !== BO && id !== CY)).toBe(1);
  });
});
