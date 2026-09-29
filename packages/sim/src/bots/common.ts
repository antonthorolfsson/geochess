/** Helpers every bot uses: secret choices, stakes, war odds, token counting. */
import {
  suggestStake,
  type SecretOption,
  type StakePlan,
  type TerritoryId,
  type UserId,
  type WarBoard,
} from '@empire/rules';
import type { SecretChooser } from '../engine/lifecycle';
import { secretPoints } from '../engine/state';
import type { SimState } from '../engine/types';
import { pick } from '../random';
import type { BotKnobs } from './knobs';

/**
 * The effort a player sees on an option: conquests, or wins for the battle missions (Backstab's
 * estimate counts the accord to break and the conquests).
 */
export function shownEffort(o: SecretOption): number {
  switch (o.spec.kind) {
    case 'iron_wall':
    case 'checkmate_artist':
      return o.spec.wins;
    default:
      return o.estimate.conquests;
  }
}

export function secretChooser(knobs: BotKnobs): SecretChooser {
  return (s, _player, options) => {
    if (options.length === 0) return null;
    const byRank = [...options].sort((a, b) => a.rank - b.rank);
    switch (knobs.secretChoice) {
      case 'rank1':
        return byRank[0]!;
      case 'random':
        return pick(options, s.rng.bots)!;
      case 'ease': {
        // Effort per point: the same as effort alone while every secret is worth the same.
        const points = (o: SecretOption) => s.cfg.variant?.secretPoints?.(o.spec.kind) ?? secretPoints(s);
        return [...byRank].sort((a, b) => shownEffort(a) / points(a) - shownEffort(b) / points(b))[0]!;
      }
      case 'forced':
        throw new Error('Forced secret missions need the scenario to assign them.');
    }
  };
}

/** The attacker's cheapest stake for a target, from a given launcher if one is named. */
export function stakeFor(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  opts: { launchId?: TerritoryId; minValue?: number; exceptWarId?: string } = {},
): StakePlan | null {
  return suggestStake(board, attackerId, targetId, opts);
}

/** A copy of the board on which these countries can't be staked (they count as newly won). */
export function boardKeeping(board: WarBoard, keep: ReadonlySet<TerritoryId>): WarBoard {
  if (keep.size === 0) return board;
  const holdings = new Map(board.holdings);
  for (const id of keep) {
    const h = holdings.get(id);
    if (h) holdings.set(id, { ...h, acquiredRound: board.round });
  }
  return { ...board, holdings };
}

/** Whether the public Lightning Campaign is in play and this player hasn't scored it. */
export function lightningOpen(s: SimState, userId: UserId): boolean {
  return s.publicSpecs.some(
    (spec, i) =>
      spec.kind === 'lightning_campaign' && !s.awards.some((a) => a.userId === userId && a.missionKey === `p${i}`),
  );
}
