/** What must always hold in a simulated campaign; checked after every change in debug runs. */
import { activeWar, warLocks, type TerritoryId } from '@empire/rules';
import { openWars } from './board';
import type { SimState } from './types';

export function checkInvariants(s: SimState): void {
  const fail = (what: string) => {
    throw new Error(`Invariant broken: ${what} (seed ${s.seed}, round ${s.round})`);
  };
  if (s.status !== 'lobby' && s.status !== 'draft') {
    if (s.holdings.size !== s.idx.ids.length) fail(`${s.holdings.size} of ${s.idx.ids.length} countries held`);
  }
  for (const [id, h] of s.holdings) if (!s.byId.has(h.ownerId)) fail(`${id} held by unknown ${h.ownerId}`);
  for (const p of s.players) if (p.tokens < 0) fail(`${p.id} has ${p.tokens} tokens`);

  const locked = new Map<TerritoryId, string>();
  for (const war of openWars(s)) {
    if (s.holdings.get(war.targetId)?.ownerId !== war.defenderId) fail(`${war.id}'s target isn't the defender's`);
    for (const id of war.stake) if (s.holdings.get(id)?.ownerId !== war.attackerId) fail(`${war.id} stakes ${id}`);
    const active = activeWar(war);
    for (const id of active.reserves ?? []) {
      if (s.holdings.get(id)?.ownerId !== war.attackerId) fail(`${war.id} holds ${id} in reserve`);
    }
    for (const id of active.added ?? []) {
      if (s.holdings.get(id)?.ownerId !== war.defenderId) fail(`${war.id} puts in ${id}, which isn't the defender's`);
    }
    for (const id of warLocks([active]).keys()) {
      const other = locked.get(id);
      if (other && other !== war.id) fail(`${id} caught up in ${other} and ${war.id}`);
      locked.set(id, war.id);
    }
  }

  const seen = new Set<string>();
  const points = new Map(s.players.map((p) => [p.id, 0]));
  for (const a of s.awards) {
    const key = `${a.userId}\n${a.missionKey}`;
    if (seen.has(key)) fail(`${key} awarded twice`);
    seen.add(key);
    if (a.claimStartedRound !== null && a.round < a.claimStartedRound + 2) {
      fail(`${key} scored in round ${a.round} from a claim started in ${a.claimStartedRound}`);
    }
    points.set(a.userId, points.get(a.userId)! + a.points);
  }
  for (const [id, p] of points) if (s.points.get(id) !== p) fail(`${id}'s points don't match the awards`);
  let last = 0;
  for (const war of s.history.wars) {
    if (war.seq <= last) fail('wars out of order in the history');
    last = war.seq;
    if (war.declaredSeq >= war.seq) fail(`${war.id} resolved before it was declared`);
  }
}
