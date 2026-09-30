import {
  ChessGame,
  chargeClock,
  colorToMove,
  opposite,
  turnDeadline,
  winFor,
  type Clocks,
  type Color,
  type GameEnding,
  type GameView,
} from '@empire/rules';
import { and, eq, lte } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { games, members, peaceOffers, wars } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { GameRow } from './board';
import { settleGame } from './service';
import { toGameView } from './views';

/** The most lag credited to a live move: about one round trip, for the move and the push before it. */
export const MAX_LAG_CREDIT_MS = 750;
/** How long past a live deadline the server waits before flagging, for a move still in flight. */
export const FLAG_GRACE_MS = MAX_LAG_CREDIT_MS;

export type GameAction = 'resign' | 'offer-draw' | 'accept-draw' | 'decline-draw';

/** A game stopped because its war ended without it: peace terms, or the campaign's end. */
const CALLED_OFF = 'The war ended without this game, so it was called off.';

const playerOf = (game: GameRow, color: Color) => (color === 'white' ? game.whiteId : game.blackId);

/** A game as a campaign member sees it. */
export async function gameView(ctx: AppContext, gameId: string, viewerId: string): Promise<GameView> {
  const [game] = await ctx.db.select().from(games).where(eq(games.id, gameId));
  if (!game) throw notFound('Game not found.');
  const [member] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.campaignId, game.campaignId), eq(members.userId, viewerId)));
  if (!member) throw notFound('Game not found.');
  return toGameView(game, ctx.now());
}

function finish(ending: GameEnding, at: Date, extra: Partial<GameRow> = {}): Partial<GameRow> {
  return {
    ...extra,
    status: 'finished',
    result: ending.result,
    reason: ending.reason,
    finishedAt: at,
    deadline: null,
    drawOfferBy: null,
  };
}

/** Live clocks as of `at`, with the side to move charged for the time since the last move. */
function clocksAt(game: GameRow, at: Date): Clocks | null {
  if (!game.clocks || game.status !== 'playing' || !game.lastMoveAt) return game.clocks;
  const turn = colorToMove(game.moves.length);
  const running = Math.max(0, at.getTime() - game.lastMoveAt.getTime());
  return { ...game.clocks, [turn]: Math.max(0, game.clocks[turn] - running) };
}

/**
 * Changes one game: serialized per game, inside a transaction holding the game row. `change`
 * returns the columns to update, or null to leave the game alone; `alongside` does more in the
 * same transaction once the game has changed. Afterwards every campaign member gets the new
 * state, and a finished game settles its war.
 */
async function changeGame(
  ctx: AppContext,
  gameId: string,
  playerId: string | null,
  change: (game: GameRow, chess: ChessGame) => Partial<GameRow> | null,
  alongside?: (tx: Tx, game: GameRow) => Promise<void>,
): Promise<GameView> {
  return ctx.gameLocks.run(gameId, async () => {
    const { row, changed } = await ctx.db.transaction(async (tx) => {
      const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for('update');
      if (!game) throw notFound('Game not found.');
      if (playerId !== null && playerId !== game.whiteId && playerId !== game.blackId) {
        throw forbidden('Only the players can do that.');
      }
      const set = change(game, ChessGame.fromMoves(game.moves));
      if (!set) return { row: game, changed: false };
      const [updated] = await tx.update(games).set(set).where(eq(games.id, gameId)).returning();
      if (alongside) await alongside(tx, updated!);
      return { row: updated!, changed: true };
    });
    if (changed) {
      await publishGame(ctx, row);
      if (row.status === 'finished') {
        ctx.timers.clear(`flag:${row.id}`);
        await settleGame(ctx, row.campaignId, row.id);
      } else {
        armFlag(ctx, row);
        ctx.bots.gameChanged(row);
      }
    }
    return toGameView(row, ctx.now());
  });
}

/**
 * A player's move. `ply` is the number of moves they saw on the board, so a move made against a
 * stale position is refused. Live clocks charge the thinking time since the previous move, less
 * a lag credit of about one measured round trip; a move that arrives after the flag has fallen
 * loses on time instead.
 */
export async function playMove(
  ctx: AppContext,
  gameId: string,
  userId: string,
  input: { uci: string; ply: number },
): Promise<GameView> {
  const receivedAt = ctx.now();
  const lag = Math.round(Math.min(ctx.hub.latency(userId), MAX_LAG_CREDIT_MS));
  let passedOver = false;
  const view = await changeGame(
    ctx,
    gameId,
    userId,
    (game, chess) => {
      if (game.status === 'waiting') throw conflict('This game has not started yet.', 'not-started');
      if (game.status === 'finished') throw conflict('This game is over.', 'game-over');
      if (game.status === 'cancelled') throw conflict(CALLED_OFF, 'game-cancelled');
      const mover = chess.turn;
      if (playerOf(game, mover) !== userId) throw conflict("It's not your move.", 'not-your-move');
      if (input.ply !== chess.ply) throw conflict('The position has changed. Check the board.', 'stale-move');
      if (game.startsAt && receivedAt < game.startsAt)
        throw conflict('The clocks have not started yet.', 'not-started');

      const tc = game.timeControl;
      let clocks = game.clocks;
      if (tc.kind === 'live' && clocks && game.lastMoveAt) {
        const thinking = receivedAt.getTime() - game.lastMoveAt.getTime() - lag;
        const charged = chargeClock(tc, clocks, mover, thinking);
        if (charged.flagged) return finish(chess.timeout(mover), receivedAt, { clocks: charged.clocks });
        clocks = charged.clocks;
      } else if (game.deadline && receivedAt > game.deadline) {
        return finish(chess.timeout(mover), game.deadline);
      }

      if (chess.play(input.uci) === null) throw badRequest('That move is not legal.', 'illegal-move');
      const played: Partial<GameRow> = {
        moves: chess.moves,
        fen: chess.fen,
        clocks,
        lastMoveAt: receivedAt,
        // Moving declines the opponent's draw offer; your own offer stands.
        drawOfferBy: game.drawOfferBy === userId ? userId : null,
      };
      const ending = chess.ending();
      if (ending) return finish(ending, receivedAt, played);
      return { ...played, deadline: new Date(turnDeadline(tc, clocks, chess.turn, receivedAt.getTime())) };
    },
    // Moving passes over the peace terms offered to the player moving, as it declines a draw offer.
    async (tx, game) => {
      const passed = await tx
        .update(peaceOffers)
        .set({ status: 'declined', respondBy: null, endedAt: receivedAt })
        .where(
          and(
            eq(peaceOffers.warId, game.warId),
            eq(peaceOffers.recipientId, userId),
            eq(peaceOffers.status, 'proposed'),
          ),
        )
        .returning({ id: peaceOffers.id });
      passedOver = passed.length > 0;
    },
  );
  if (passedOver) ctx.hub.send([view.whiteId, view.blackId], { type: 'campaign.changed', campaignId: view.campaignId });
  if (view.status === 'playing' && view.timeControl.kind === 'correspondence') {
    const next = colorToMove(view.moves.length);
    const nextId = next === 'white' ? view.whiteId : view.blackId;
    // A bot playing that side moves by itself.
    const [seat] = await ctx.db
      .select({ botLevel: members.botLevel })
      .from(members)
      .where(and(eq(members.campaignId, view.campaignId), eq(members.userId, nextId)));
    if (seat?.botLevel != null) return view;
    await ctx.notifier
      .send({
        userId: nextId,
        title: 'Your move',
        body: `Your opponent has moved. You have ${Math.round(view.timeControl[next].perMoveMs / 3_600_000)} hours.`,
        url: `/c/${view.campaignId}?game=${view.id}`,
        tag: `game:${view.id}`,
        email: true,
      })
      .catch((err: unknown) => ctx.log.error({ err }, 'could not send a move notification'));
  }
  return view;
}

/** Resigning, and offering, accepting or declining a draw. */
export async function gameAction(
  ctx: AppContext,
  gameId: string,
  userId: string,
  action: GameAction,
): Promise<GameView> {
  const at = ctx.now();
  return changeGame(ctx, gameId, userId, (game) => {
    if (game.status === 'finished') throw conflict('This game is over.', 'game-over');
    if (game.status === 'cancelled') throw conflict(CALLED_OFF, 'game-cancelled');
    const color: Color = game.whiteId === userId ? 'white' : 'black';
    const opponentId = playerOf(game, opposite(color));
    const clocks = { clocks: clocksAt(game, at) };
    switch (action) {
      case 'resign':
        return finish({ result: winFor(opposite(color)), reason: 'resignation' }, at, clocks);
      case 'offer-draw':
        if (game.drawOfferBy === opponentId) return finish({ result: '1/2-1/2', reason: 'agreement' }, at, clocks);
        return game.drawOfferBy === userId ? null : { drawOfferBy: userId };
      case 'accept-draw':
        if (game.drawOfferBy !== opponentId) throw conflict('There is no draw offer to accept.', 'no-draw-offer');
        return finish({ result: '1/2-1/2', reason: 'agreement' }, at, clocks);
      case 'decline-draw':
        if (game.drawOfferBy !== opponentId) throw conflict('There is no draw offer to decline.', 'no-draw-offer');
        return { drawOfferBy: null };
    }
  });
}

/** Ends a game on time if the side to move is past their deadline (live games get a little grace for lag). */
export async function flagIfDue(ctx: AppContext, gameId: string): Promise<void> {
  await changeGame(ctx, gameId, null, (game, chess) => {
    if (game.status !== 'playing' || !game.deadline) return null;
    const grace = game.timeControl.kind === 'live' ? FLAG_GRACE_MS : 0;
    if (ctx.now().getTime() < game.deadline.getTime() + grace) return null;
    const mover = chess.turn;
    const clocks = game.clocks ? { clocks: { ...game.clocks, [mover]: 0 } } : {};
    return finish(chess.timeout(mover), game.deadline, clocks);
  });
}

/** Arms the timer that flags a live game's side to move the moment their time runs out. */
export function armFlag(ctx: AppContext, game: GameRow): void {
  if (game.status !== 'playing' || !game.deadline || game.timeControl.kind !== 'live') return;
  ctx.timers.set(`flag:${game.id}`, game.deadline.getTime() + FLAG_GRACE_MS + 50, () => {
    flagIfDue(ctx, game.id).catch((err: unknown) => ctx.log.error({ err, gameId: game.id }, 'flag check failed'));
  });
}

/** Sends a game's new state to every member of its campaign; boards apply it without refetching. */
export async function publishGame(ctx: AppContext, game: GameRow): Promise<void> {
  const rows = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.campaignId, game.campaignId));
  ctx.hub.send(
    rows.map((r) => r.userId),
    { type: 'game.update', campaignId: game.campaignId, game: toGameView(game, ctx.now()) },
  );
}

/**
 * Deadlines the server keeps: flags games whose side to move ran out of time, and settles games
 * that finished while their war wasn't updated (the server stopped in between).
 */
export async function flagOverdueGames(ctx: AppContext): Promise<void> {
  const due = await ctx.db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.status, 'playing'), lte(games.deadline, ctx.now())));
  for (const { id } of due) {
    await flagIfDue(ctx, id).catch((err: unknown) => ctx.log.error({ err, gameId: id }, 'flag check failed'));
  }
  const orphans = await ctx.db
    .select({ id: games.id, campaignId: games.campaignId })
    .from(games)
    .innerJoin(wars, eq(wars.id, games.warId))
    .where(and(eq(games.status, 'finished'), eq(wars.status, 'playing')));
  for (const { id, campaignId } of orphans) {
    await settleGame(ctx, campaignId, id).catch((err: unknown) =>
      ctx.log.error({ err, gameId: id }, 'could not settle a finished game'),
    );
  }
}

/** Re-arms live flag timers after a restart. */
export async function armAllFlags(ctx: AppContext): Promise<void> {
  const playing = await ctx.db.select().from(games).where(eq(games.status, 'playing'));
  for (const game of playing) armFlag(ctx, game);
}
