/**
 * Bots that play on country value alone: auto-draft picks, the best-fit secret, no diplomacy, and
 * wars whenever the expected value gain beats the threshold. The baseline for how often missions
 * get done by accident.
 */
import { attackableTargets, clockTarget, suggestPick, valueOf } from '@empire/rules';
import { warBoard } from '../engine/board';
import { warOdds } from '../engine/chess';
import type { SimState, SimWar } from '../engine/types';
import type { Bots } from './index';
import { stakeFor } from './common';
import type { BotKnobs } from './knobs';

function greedyDraft(s: SimState, userId: string): string {
  const owners = new Map([...s.holdings].map(([id, h]) => [id, h.ownerId]));
  return suggestPick(s.idx, s.rules, owners, userId)!;
}

export function greedyBots(knobs: BotKnobs): Bots {
  const value = (s: SimState, ids: readonly string[]) => valueOf(s.idx, ids);
  return {
    draftPick: (s, userId) => greedyDraft(s, userId),
    chooseSecret: (_s, _p, options) => [...options].sort((a, b) => a.rank - b.rank)[0] ?? null,
    diplomacy: () => {},
    declare(s, player) {
      const board = warBoard(s);
      let best: { u: number; targetId: string; launchId: string; stake: string[] } | null = null;
      for (const targetId of attackableTargets(board, player.id)) {
        const plan = stakeFor(board, player.id, targetId);
        if (!plan) continue;
        const defenderId = s.holdings.get(targetId)!.ownerId;
        const odds = warOdds(s, player.id, defenderId, targetId, board);
        const u = odds.attacker * s.idx.byId.get(targetId)!.value - odds.defender * plan.value;
        if (!best || u > best.u) best = { u, targetId, launchId: plan.launchId, stake: plan.stake };
      }
      const threshold = player.tokens >= s.rules.war.tokenCap ? knobs.declareThresholdAtCap : knobs.declareThreshold;
      return best && best.u > threshold ? best : null;
    },
    fortify: () => null,
    recall: () => false,
    respond: () => ({ kind: 'accept' }),
    answerPeace: () => false,
    reply(s, war: SimWar) {
      const counter = war.counter!;
      if (counter.kind === 'tribute') return { kind: 'accept' };
      const board = warBoard(s);
      const targetId = counter.kind === 'redirect' ? counter.targetId : war.targetId;
      const stake =
        counter.kind === 'raise'
          ? stakeFor(board, war.attackerId, war.targetId, {
              launchId: war.launchId,
              minValue: counter.minValue,
              exceptWarId: war.id,
            })?.stake
          : war.stake;
      if (!stake) return { kind: 'withdraw' };
      const clockId = clockTarget(s.rules, {
        targetId,
        redirectedFrom: counter.kind === 'redirect' ? war.targetId : null,
      });
      const odds = warOdds(s, war.attackerId, war.defenderId, clockId, board);
      // A matched raise's country comes with the target; a paid counter's token comes to the attacker.
      const won = value(s, counter.kind === 'raise' && counter.added ? [targetId, counter.added] : [targetId]);
      const u = odds.attacker * won - odds.defender * value(s, stake) + (counter.tokens ?? 0) * knobs.tokenValue;
      if (u <= 0) return { kind: 'withdraw' };
      return counter.kind === 'raise' ? { kind: 'accept', stake } : { kind: 'accept' };
    },
  };
}
