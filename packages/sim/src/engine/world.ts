import type { MissionHistory, MissionWorld, TerritoryId, UserId } from '@empire/rules';
import type { SimState } from './types';

/** The history as it stands, copied so later changes don't reach into a snapshot. */
export function historySnapshot(s: SimState): MissionHistory {
  return {
    wars: [...s.history.wars],
    accords: s.history.accords.map((a) => ({ ...a })),
    roundStarts: [...s.history.roundStarts],
    awards: [...s.history.awards],
  };
}

export function ownersOf(s: SimState): Map<TerritoryId, UserId> {
  const owners = new Map<TerritoryId, UserId>();
  for (const [id, h] of s.holdings) owners.set(id, h.ownerId);
  return owners;
}

/** What mission evaluators look at, as the server's `loadWorld` builds it. */
export function missionWorld(s: SimState): MissionWorld {
  return {
    idx: s.idx,
    players: s.players.map((p) => p.id).sort(),
    owners: ownersOf(s),
    baseline: new Map(s.players.map((p) => [p.id, p.baseline])),
    history: historySnapshot(s),
  };
}
