import type { PeaceTerms, TerritoryId } from '@empire/rules';
import type { SecretChooser, DraftPicker } from '../engine/lifecycle';
import type { SimPeaceOffer, SimPlayer, SimState, SimWar } from '../engine/types';
import type { Declaration, Reply, Response } from '../engine/wars';
import { greedyBots } from './greedy';
import type { BotKnobs } from './knobs';
import { standardBots } from './standard';

/**
 * A defender's answer to a declaration, or terms offered first: if the attacker turns them down,
 * `fallback` answers the declaration.
 */
export type Answer = Response | { kind: 'peace'; terms: PeaceTerms; fallback: Response };

/** Every decision a campaign asks of its players. */
export interface Bots {
  draftPick: DraftPicker;
  chooseSecret: SecretChooser;
  /** Renouncing, proposing and answering accords, for every player. */
  diplomacy(s: SimState): void;
  /** A country to fortify at the start of this player's turn in a round, or null. */
  fortify(s: SimState, player: SimPlayer): TerritoryId | null;
  /** One declaration for this player now, or null to stop declaring this wave. */
  declare(s: SimState, player: SimPlayer, wave: number): Declaration | null;
  /** Whether the attacker calls this declaration off before the defender answers. */
  recall(s: SimState, war: SimWar): boolean;
  respond(s: SimState, war: SimWar): Answer;
  /** Whether the player offered terms takes them. */
  answerPeace(s: SimState, war: SimWar, offer: SimPeaceOffer): boolean;
  reply(s: SimState, war: SimWar): Reply;
}

export function makeBots(knobs: BotKnobs, chooseSecret?: SecretChooser): Bots {
  const bots = knobs.policy === 'greedy' ? greedyBots(knobs) : standardBots(knobs);
  return chooseSecret ? { ...bots, chooseSecret } : bots;
}
