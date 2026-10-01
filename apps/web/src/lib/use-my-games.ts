'use client';

import { colorToMove, type WarView } from '@empire/rules';
import type { CampaignModel } from './campaign';
import { useGames, type BoardGame } from './queries';

export interface MyGame {
  war: WarView;
  gameId: string;
  /** The live state, once loaded. */
  game: BoardGame | undefined;
  /**
   * Whether the game waits for the viewer: their move, or an offer to play over the board, or
   * (over the board) a result reported to them.
   */
  myMove: boolean;
  /** Being played over the board, as of the live state. */
  overTheBoard: boolean;
}

/** The viewer's games underway, each with whether it waits for them. */
export function useMyGames(model: CampaignModel): MyGame[] {
  const me = model.me.userId;
  const mine = model.activeWars.flatMap((war) => {
    const g = war.games.at(-1);
    return g && g.status === 'playing' && (g.whiteId === me || g.blackId === me) ? [{ war, gameId: g.id }] : [];
  });
  const states = useGames(mine.map((m) => m.gameId));
  return mine.map((m, i) => {
    const game = states[i]?.data;
    if (!game || game.status !== 'playing') return { ...m, game, myMove: false, overTheBoard: false };
    if (game.overTheBoard) {
      return { ...m, game, myMove: game.report !== null && game.report.by !== me, overTheBoard: true };
    }
    const turn = colorToMove(game.moves.length);
    const offered = game.overTheBoardOfferBy !== null && game.overTheBoardOfferBy !== me;
    return {
      ...m,
      game,
      myMove: offered || (turn === 'white' ? game.whiteId : game.blackId) === me,
      overTheBoard: false,
    };
  });
}
