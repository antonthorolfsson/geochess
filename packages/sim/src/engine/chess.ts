/**
 * The chess model: who wins a war's game, from the players' ratings, the colours and the clocks.
 * Expected scores follow Elo, with White's edge and each side's share of clock time converted
 * to rating points; a fixed share of games are drawn. How a decisive game ends matters only to
 * Checkmate Artist.
 */
import {
  ARMAGEDDON_BLACK_TIME,
  attackerColor,
  clockModifiers,
  type Color,
  type GameEndReason,
  type WarBoard,
} from '@empire/rules';
import { warBoard } from './board';
import type { ChessModel, SimState, SimWar } from './types';

export const DEFAULT_CHESS: ChessModel = {
  drawRate: 0.08,
  whiteElo: 20,
  eloPerTimePct: 1.5,
  mateShare: 0.3,
  timeoutShare: 0.2,
  mateDenial: 0,
};

export interface GameOdds {
  /** Chance White wins, Black wins, and of a draw. */
  white: number;
  black: number;
  draw: number;
}

const expected = (edge: number) => 1 / (1 + 10 ** (-edge / 400));

/** The odds of one game, from White's rating edge over Black (colour and clock included). */
export function oddsFromEdge(model: ChessModel, edge: number): GameOdds {
  const e = expected(edge);
  const white = Math.max(0, e - model.drawRate / 2);
  const black = Math.max(0, 1 - e - model.drawRate / 2);
  return { white, black, draw: Math.max(0, 1 - white - black) };
}

/**
 * White's edge in a war's game (or its Armageddon tiebreak): ratings, the colour, and clock time
 * as the war's time control shares it out (`warTimeControl`).
 */
export function whiteEdge(
  model: ChessModel,
  eloAttacker: number,
  eloDefender: number,
  modifierNet: number,
  armageddon: boolean,
): number {
  const attacker = attackerColor(armageddon);
  const favored = modifierNet > 0 ? 'defender' : modifierNet < 0 ? 'attacker' : null;
  const factor = (color: Color) => {
    const side = color === attacker ? 'attacker' : 'defender';
    const bonus = side === favored ? 1 + Math.abs(modifierNet) / 100 : 1;
    return bonus * (armageddon && color === 'black' ? ARMAGEDDON_BLACK_TIME : 1);
  };
  const timePct = (factor('white') / factor('black') - 1) * 100;
  const [eloWhite, eloBlack] = attacker === 'white' ? [eloAttacker, eloDefender] : [eloDefender, eloAttacker];
  return eloWhite - eloBlack + model.whiteElo + timePct * model.eloPerTimePct;
}

/**
 * The chances a war ends each way, before it's fought: the attacker wins, the defender wins, or it's
 * held (a draw with defender-holds). With Armageddon a draw goes to a second game Black wins on a draw.
 */
export function warOdds(
  s: SimState,
  attackerId: string,
  defenderId: string,
  targetId: string,
  board: WarBoard = warBoard(s),
): WarOdds {
  return oddsWithModifier(s, attackerId, defenderId, clockModifiers(board, attackerId, targetId).net);
}

export interface WarOdds {
  attacker: number;
  defender: number;
  held: number;
}

/** A war's odds given the net clock modifier (positive favours the defender). */
export function oddsWithModifier(s: SimState, attackerId: string, defenderId: string, net: number): WarOdds {
  const model = s.cfg.chess;
  const ea = s.byId.get(attackerId)!.elo;
  const ed = s.byId.get(defenderId)!.elo;
  const first = oddsFromEdge(model, whiteEdge(model, ea, ed, net, false));
  if (s.rules.war.draws !== 'armageddon') return { attacker: first.white, defender: first.black, held: first.draw };
  const second = oddsFromEdge(model, whiteEdge(model, ea, ed, net, true));
  // In the tiebreak the attacker is Black and wins a drawn game.
  const attackerSecond = second.black + second.draw;
  return {
    attacker: first.white + first.draw * attackerSecond,
    defender: first.black + first.draw * second.white,
    held: 0,
  };
}

export interface PlayedGame {
  winner: Color | null;
  reason: GameEndReason;
}

/** Plays one game of a war (the first, or its Armageddon tiebreak). */
export function playGame(s: SimState, war: SimWar, armageddon: boolean): PlayedGame {
  const model = s.cfg.chess;
  const net = clockModifiers(warBoard(s), war.attackerId, war.targetId).net;
  const edge = whiteEdge(model, s.byId.get(war.attackerId)!.elo, s.byId.get(war.defenderId)!.elo, net, armageddon);
  const odds = oddsFromEdge(model, edge);
  const r = s.rng.chess();
  const winner: Color | null = r < odds.white ? 'white' : r < odds.white + odds.black ? 'black' : null;
  if (winner === null) return { winner, reason: s.rng.chess() < 0.5 ? 'agreement' : 'threefold-repetition' };
  const winnerId = (winner === 'white') === (attackerColor(armageddon) === 'white') ? war.attackerId : war.defenderId;
  const q = s.rng.chess();
  let reason: GameEndReason =
    q < model.mateShare ? 'checkmate' : q < model.mateShare + model.timeoutShare ? 'timeout' : 'resignation';
  // A revealed Checkmate Artist's opponents resign rather than be mated, some of the time.
  const artist = s.byId.get(winnerId)!;
  if (
    reason === 'checkmate' &&
    artist.secret?.kind === 'checkmate_artist' &&
    artist.revealedRound !== null &&
    s.rng.chess() < model.mateDenial
  ) {
    reason = 'resignation';
  }
  return { winner, reason };
}
