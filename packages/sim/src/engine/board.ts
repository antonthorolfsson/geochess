import {
  accordsInForce,
  activeTruces,
  activeWar,
  renunciationsFrom,
  type Holding,
  type OpenWar,
  type TerritoryId,
  type WarBoard,
} from '@empire/rules';
import type { SimState, SimWar } from './types';

export const openWars = (s: SimState): SimWar[] => s.wars.filter((w) => w.status !== 'resolved');

/** Everything the war rules look at, as the server's `loadBoard` builds it. */
export function warBoard(s: SimState, holdings: ReadonlyMap<TerritoryId, Holding> = s.holdings): WarBoard {
  const round = s.round;
  const recent = s.wars.filter(
    (w) => w.status === 'resolved' && w.resolvedRound !== null && w.resolvedRound >= round - s.rules.war.truceRounds,
  );
  return {
    idx: s.idx,
    rules: s.rules,
    round,
    holdings,
    wars: openWars(s).map((w) => activeWar(w)),
    truces: activeTruces(
      s.rules,
      round,
      recent.map((w) => ({
        attackerId: w.attackerId,
        defenderId: w.defenderId,
        outcome: w.outcome!,
        resolvedRound: w.resolvedRound!,
      })),
    ),
    accords: accordsInForce(s.accords, round),
    renunciations: renunciationsFrom(s.accords, round),
  };
}

/** Unresolved wars as the claim blockers see them. */
export const openWarViews = (s: SimState): OpenWar[] =>
  openWars(s).map((w) => ({
    id: w.id,
    attackerId: w.attackerId,
    defenderId: w.defenderId,
    targetId: w.targetId,
    launchId: w.launchId,
    stake: w.stake,
    status: w.status,
    counter: w.counter,
    reserves: w.reserves,
  }));
