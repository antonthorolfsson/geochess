'use client';

import { colorToMove, type WarView } from '@empire/rules';
import type { CampaignModel } from './campaign';
import { useGames, type BoardGame } from './queries';

export interface MyGame {
  war: WarView;
  gameId: string;
  /** The live state, once loaded. */
  game: BoardGame | undefined;
  myMove: boolean;
}

/** The viewer's games underway, each with whether it's their move. */
export function useMyGames(model: CampaignModel): MyGame[] {
  const me = model.me.userId;
  const mine = model.activeWars.flatMap((war) => {
    const g = war.games.at(-1);
    return g && g.status === 'playing' && (g.whiteId === me || g.blackId === me) ? [{ war, gameId: g.id }] : [];
  });
  const states = useGames(mine.map((m) => m.gameId));
  return mine.map((m, i) => {
    const game = states[i]?.data;
    const turn = game && game.status === 'playing' ? colorToMove(game.moves.length) : null;
    return { ...m, game, myMove: turn !== null && (turn === 'white' ? game!.whiteId : game!.blackId) === me };
  });
}
