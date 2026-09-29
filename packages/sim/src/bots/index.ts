import type { SecretChooser, DraftPicker } from '../engine/lifecycle';
import type { SimPlayer, SimState, SimWar } from '../engine/types';
import type { Declaration, Reply, Response } from '../engine/wars';
import { greedyBots } from './greedy';
import type { BotKnobs } from './knobs';
import { standardBots } from './standard';

/** Every decision a campaign asks of its players. */
export interface Bots {
  draftPick: DraftPicker;
  chooseSecret: SecretChooser;
  /** Renouncing, proposing and answering accords, for every player. */
  diplomacy(s: SimState): void;
  /** One declaration for this player now, or null to stop declaring this wave. */
  declare(s: SimState, player: SimPlayer, wave: number): Declaration | null;
  respond(s: SimState, war: SimWar): Response;
  reply(s: SimState, war: SimWar): Reply;
}

export function makeBots(knobs: BotKnobs, chooseSecret?: SecretChooser): Bots {
  const bots = knobs.policy === 'greedy' ? greedyBots(knobs) : standardBots(knobs);
  return chooseSecret ? { ...bots, chooseSecret } : bots;
}
