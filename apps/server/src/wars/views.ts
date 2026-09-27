import { colorToMove, type GameSummary, type GameView, type WarView } from '@empire/rules';
import type { GameRow, WarRow } from './board';

export function toGameSummary(game: GameRow): GameSummary {
  return {
    id: game.id,
    armageddon: game.armageddon,
    whiteId: game.whiteId,
    blackId: game.blackId,
    status: game.status,
    result: game.result,
    reason: game.reason,
  };
}

/** A game as of `now`: the clock of the side to move has kept running since the last move. */
export function toGameView(game: GameRow, now: Date): GameView {
  let clocks = game.clocks;
  if (clocks && game.status === 'playing' && game.lastMoveAt) {
    const turn = colorToMove(game.moves.length);
    const running = Math.max(0, now.getTime() - game.lastMoveAt.getTime());
    clocks = { ...clocks, [turn]: Math.max(0, clocks[turn] - running) };
  }
  return {
    ...toGameSummary(game),
    warId: game.warId,
    campaignId: game.campaignId,
    timeControl: game.timeControl,
    moves: game.moves,
    clocks,
    startsAt: game.startsAt?.toISOString() ?? null,
    deadline: game.deadline?.toISOString() ?? null,
    drawOfferBy: game.drawOfferBy,
    serverNow: now.toISOString(),
  };
}

/** `games` are the war's games in the order they were played. */
export function toWarView(war: WarRow, games: readonly GameRow[]): WarView {
  return {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    targetId: war.targetId,
    launchId: war.launchId,
    stake: war.stake,
    redirectedFrom: war.redirectedFrom,
    status: war.status,
    counter: war.counter,
    outcome: war.outcome,
    declaredRound: war.declaredRound,
    resolvedRound: war.resolvedRound,
    respondBy: war.respondBy?.toISOString() ?? null,
    declaredAt: war.declaredAt.toISOString(),
    resolvedAt: war.resolvedAt?.toISOString() ?? null,
    games: games.map(toGameSummary),
  };
}
