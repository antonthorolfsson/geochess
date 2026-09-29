/**
 * Which unresolved wars could still break a claim. A claim doesn't score while one of the
 * claimant's wars could, in some permitted outcome, take away (or add) countries so that the
 * mission would no longer hold. Every mission depends only on what its player holds, so only
 * wars they fight in matter; a war elsewhere never blocks.
 */
import type { TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import { reachableWithin } from '../graph';
import type { WarStatus } from '../protocol';
import {
  activeWar,
  addedCountry,
  canRaise,
  raiseOptions,
  redirectOptions,
  stakeableCountries,
  tributeOptions,
  type Transfer,
  type WarBoard,
  type WarCounter,
} from '../war';
import type { MissionSpec } from './catalog';
import { missionComplete } from './evaluate';
import { withTransfers, type MissionWorld } from './world';

/** An unresolved war as a server row or a client view has it. */
export interface OpenWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: readonly TerritoryId[];
  status: WarStatus;
  counter: WarCounter | null;
  /** Countries the attacker set aside to meet a raise. */
  reserves?: readonly TerritoryId[];
}

const key = (transfers: readonly Transfer[]) =>
  transfers
    .map((t) => `${t.territoryId}>${t.to}`)
    .sort()
    .join(',');

/**
 * Every way an unresolved war could still end, as the countries that would change hands (the empty
 * list when nothing does: a draw, a withdrawal, tokens as tribute). Open answers count every
 * option the rules allow, since the player choosing could pick any of them:
 * - declared: the defender may accept, raise (putting in any country a matched raise allows),
 *   redirect to any legal country or offer any legal tribute;
 * - countered: the attacker may accept or refuse the offer on the table;
 * - a raised stake may be anything the attacker could stake from the launching country.
 * Peace terms don't count: they need both players to agree, the claimant among them.
 */
export function possibleTransfers(board: WarBoard, war: OpenWar): Transfer[][] {
  const take = (...ids: TerritoryId[]): Transfer[] =>
    ids.map((id) => ({ territoryId: id, from: war.defenderId, to: war.attackerId }));
  const lose = (ids: Iterable<TerritoryId>): Transfer[] =>
    [...ids].map((id) => ({ territoryId: id, from: war.attackerId, to: war.defenderId }));
  const raisedStake = () => reachableWithin(board.idx, war.launchId, stakeableCountries(board, war.attackerId, war.id));
  const out: Transfer[][] = [[]];
  const fight = (targetId: TerritoryId) => out.push(take(targetId), lose(war.stake));

  switch (war.status) {
    case 'ready':
    case 'playing': {
      // A met matched raise put another of the defender's countries at stake.
      const added = addedCountry(war.counter);
      out.push(added ? take(war.targetId, added) : take(war.targetId), lose(war.stake));
      break;
    }
    case 'countered': {
      const counter = war.counter;
      if (counter?.kind === 'raise') {
        out.push(counter.added ? take(war.targetId, counter.added) : take(war.targetId), lose(raisedStake()));
      } else if (counter?.kind === 'redirect') fight(counter.targetId);
      else {
        if (counter?.territoryId) out.push(take(counter.territoryId));
        fight(war.targetId);
      }
      break;
    }
    case 'declared': {
      const active = activeWar(war);
      fight(war.targetId);
      if (canRaise(board, active)) {
        out.push(lose(raisedStake()));
        for (const id of raiseOptions(board, active)) out.push(take(war.targetId, id));
      }
      for (const id of redirectOptions(board, active)) out.push(take(id));
      for (const id of tributeOptions(board, active)) out.push(take(id));
      break;
    }
    case 'resolved':
      break;
  }
  const seen = new Set<string>();
  return out.filter((transfers) => {
    const k = key(transfers);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Combinations of outcomes checked one by one; beyond this, a cruder check stands in. */
const COMBINATION_LIMIT = 512;

/**
 * The unresolved wars that could still break `userId`'s complete mission, by id. Outcomes of
 * several wars are combined, so two wars that could each cost one position of a three-of-five set
 * held with four both block; a war whose every outcome leaves the mission complete (another route
 * or set still qualifies) doesn't, and neither does a war that only ever changes hands alongside
 * one that breaks the mission by itself.
 */
export function claimBlockers(
  world: MissionWorld,
  board: WarBoard,
  userId: UserId,
  spec: MissionSpec,
  wars: readonly OpenWar[],
): string[] {
  const mine = wars.filter((w) => w.status !== 'resolved' && (w.attackerId === userId || w.defenderId === userId));
  if (mine.length === 0) return [];
  const options = mine.map((w) => possibleTransfers(board, w));
  const holds = (transfers: readonly Transfer[]) => missionComplete(withTransfers(world, transfers), userId, spec);
  const blocking = new Set<string>();

  const combinations = options.reduce((n, o) => n * o.length, 1);
  if (combinations <= COMBINATION_LIMIT) {
    // Combination n picks outcome ⌊n / stride⌋ mod count of each war; outcome 0 is "nothing changes hands".
    const strides = options.map((_, i) => options.slice(0, i).reduce((n, o) => n * o.length, 1));
    const choiceOf = (n: number) => options.map((o, i) => Math.floor(n / strides[i]!) % o.length);
    const breaks = Array.from({ length: combinations }, (_, n) => {
      const transfers = choiceOf(n).flatMap((c, i) => options[i]![c]!);
      return transfers.length > 0 && !holds(transfers);
    });
    // A war blocks when its outcome is part of what breaks the mission: in some combination that
    // breaks it, the same with nothing changing hands in that war would leave it complete. Every
    // breaking combination has such a war (take one where the fewest wars change anything).
    breaks.forEach((broken, n) => {
      if (!broken) return;
      choiceOf(n).forEach((c, i) => {
        if (c > 0 && !breaks[n - c * strides[i]!]) blocking.add(mine[i]!.id);
      });
    });
  } else {
    // Too many combinations: each war's outcomes alone, then every loss at once and every gain at once.
    const losses = options.map((o) => o.flatMap((t) => t.filter((x) => x.from === userId)));
    const gains = options.map((o) => o.flatMap((t) => t.filter((x) => x.to === userId)));
    options.forEach((o, i) => {
      if (o.some((t) => t.length > 0 && !holds(t))) blocking.add(mine[i]!.id);
    });
    if (!holds(losses.flat())) losses.forEach((l, i) => l.length > 0 && blocking.add(mine[i]!.id));
    if (!holds(gains.flat())) gains.forEach((g, i) => g.length > 0 && blocking.add(mine[i]!.id));
  }
  return [...blocking].sort();
}
