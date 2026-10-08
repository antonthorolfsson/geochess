import {
  ChessGame,
  OVER_THE_BOARD_REJECTION_MESSAGES,
  REPORT_WINDOW_MS,
  REPORT_WINDOW_TEXT,
  chargeClock,
  colorToMove,
  getTerritory,
  opposite,
  overTheBoard,
  parseRules,
  turnDeadline,
  winFor,
  type Clocks,
  type Color,
  type GameEnding,
  type GameView,
  type OverTheBoardAction,
} from '@empire/rules';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { userName } from '../campaigns/mutate';
import { requireSeasonOn } from '../campaigns/round-end';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { campaigns, games, members, peaceOffers, wars } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { GameRow } from './board';
import { LIVE_COUNTDOWN_MS, settleGame } from './service';
import { toGameView } from './views';

/** The most lag credited to a live move: about one round trip, for the move and the push before it. */
export const MAX_LAG_CREDIT_MS = 750;
/** How long past a live deadline the server waits before flagging, for a move still in flight. */
export const FLAG_GRACE_MS = MAX_LAG_CREDIT_MS;

export type GameAction = 'resign' | 'offer-draw' | 'accept-draw' | 'decline-draw';

/** A game stopped because its war ended without it: peace terms, or the campaign's end. */
const CALLED_OFF = 'The war ended without this game, so it was called off.';
const PLAYED_OVER_THE_BOARD = 'This game is being played over the board. Report the result instead.';

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
    otbOfferBy: null,
    report: null,
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
 * state, and a finished game settles its war. Once a scheduled last round's time is up, its games
 * stand as they were (`requireSeasonOn`), but for a deadline that fell due by `upTo`.
 */
async function changeGame(
  ctx: AppContext,
  gameId: string,
  playerId: string | null,
  change: (game: GameRow, chess: ChessGame) => Partial<GameRow> | null,
  alongside?: (tx: Tx, game: GameRow) => Promise<void>,
  { upTo }: { upTo?: Date } = {},
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
      // Read, not locked: a game lock never waits on its campaign's lock here.
      const [campaign] = await tx
        .select({
          status: campaigns.status,
          round: campaigns.round,
          rules: campaigns.rules,
          nextRoundAt: campaigns.nextRoundAt,
          roundPausedAt: campaigns.roundPausedAt,
        })
        .from(campaigns)
        .where(eq(campaigns.id, game.campaignId));
      if (campaign) requireSeasonOn({ ...campaign, rules: parseRules(campaign.rules) }, ctx.now(), upTo);
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
      if (game.overTheBoardAt) throw conflict(PLAYED_OVER_THE_BOARD, 'over-the-board');
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
        // Moving declines the opponent's offers of a draw or a real board; your own stand.
        drawOfferBy: game.drawOfferBy === userId ? userId : null,
        otbOfferBy: game.otbOfferBy === userId ? userId : null,
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

/** Resigning, and offering, accepting or declining a draw. Over the board, resigning reports a loss. */
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
    if (game.overTheBoardAt && action !== 'resign') throw conflict(PLAYED_OVER_THE_BOARD, 'over-the-board');
    switch (action) {
      case 'resign': {
        const reason = game.overTheBoardAt ? 'over-the-board' : 'resignation';
        return finish({ result: winFor(opposite(color)), reason }, at, clocks);
      }
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

/**
 * Playing a game over the board (`@empire/rules` over-the-board.ts): offering and answering, reporting
 * the result and answering the report, and going back online. Moving over the board stops the
 * clocks where they stand; going back online starts them again (live games after a countdown).
 */
export async function overTheBoardAction(
  ctx: AppContext,
  gameId: string,
  userId: string,
  action: OverTheBoardAction,
): Promise<GameView> {
  const at = ctx.now();
  const [seated] = await ctx.db
    .select({ campaignId: games.campaignId, whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(eq(games.id, gameId));
  if (!seated) throw notFound('Game not found.');
  // A bot (standing in for a person, too) can't sit at a real board.
  const bots = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(
        eq(members.campaignId, seated.campaignId),
        inArray(members.userId, [seated.whiteId, seated.blackId]),
        isNotNull(members.botLevel),
      ),
    );
  const view = await changeGame(ctx, gameId, userId, (game) => {
    if (game.status === 'cancelled') throw conflict(CALLED_OFF, 'game-cancelled');
    if (game.status === 'finished') throw conflict('This game is over.', 'game-over');
    const state = {
      status: game.status,
      whiteId: game.whiteId,
      blackId: game.blackId,
      offerBy: game.otbOfferBy,
      overTheBoard: game.overTheBoardAt !== null,
      report: game.report,
    };
    const outcome = overTheBoard(state, userId, action, new Set(bots.map((b) => b.userId)));
    if (!outcome.ok) throw conflict(OVER_THE_BOARD_REJECTION_MESSAGES[outcome.reason], outcome.reason);
    const { change } = outcome;
    if (change.ending) return finish({ result: change.ending, reason: 'over-the-board' }, at);
    const set: Partial<GameRow> = {};
    if (change.offerBy !== undefined) set.otbOfferBy = change.offerBy;
    if (change.report !== undefined) {
      set.report = change.report;
      set.deadline = change.report ? new Date(at.getTime() + REPORT_WINDOW_MS[game.timeControl.kind]) : null;
    }
    if (change.overTheBoard === true) {
      Object.assign(set, { overTheBoardAt: at, clocks: clocksAt(game, at), lastMoveAt: null, deadline: null });
      set.drawOfferBy = null;
    } else if (change.overTheBoard === false) {
      const startsAt = at.getTime() + (game.timeControl.kind === 'live' ? LIVE_COUNTDOWN_MS : 0);
      const turn = colorToMove(game.moves.length);
      Object.assign(set, {
        overTheBoardAt: null,
        startsAt: new Date(startsAt),
        lastMoveAt: new Date(startsAt),
        deadline: new Date(turnDeadline(game.timeControl, game.clocks, turn, startsAt)),
      });
    }
    return set;
  });
  await tellOpponent(ctx, view, userId, action).catch((err: unknown) =>
    ctx.log.error({ err }, 'could not send an over-the-board notification'),
  );
  return view;
}

/** Tells the other player what `userId` just did over the board, where it needs them. */
async function tellOpponent(ctx: AppContext, game: GameView, userId: string, action: OverTheBoardAction) {
  const opponentId = game.whiteId === userId ? game.blackId : game.whiteId;
  const [war] = await ctx.db
    .select({ targetId: wars.targetId, datasetVersion: campaigns.datasetVersion })
    .from(wars)
    .innerJoin(campaigns, eq(campaigns.id, wars.campaignId))
    .where(eq(wars.id, game.warId));
  if (!war) return;
  const battle = `the battle for ${getTerritory(ctx.datasets.get(war.datasetVersion), war.targetId).name}`;
  const name = await userName(ctx.db, userId);
  const correspondence = game.timeControl.kind === 'correspondence';
  const message = (() => {
    switch (action) {
      case 'offer':
        return game.overTheBoard
          ? { title: 'Over the board', body: `${name} agreed to play ${battle} on a real board.` }
          : { title: 'Play over the board?', body: `${name} wants to play ${battle} on a real board.` };
      case 'accept':
        return {
          title: 'Over the board',
          body: `${name} agreed to play ${battle} on a real board. Report the result when the game is over.`,
        };
      case 'decline':
        return { title: 'Playing online', body: `${name} would rather play ${battle} online.` };
      case 'report-win':
      case 'report-draw': {
        const what = action === 'report-win' ? 'a win' : 'a draw';
        const window = REPORT_WINDOW_TEXT[game.timeControl.kind];
        return {
          title: `${name} reports ${what}`,
          body: `${name} reports ${what} over the board in ${battle}. Confirm or dispute it within ${window}; unanswered, it stands.`,
          email: correspondence,
        };
      }
      case 'dispute':
        return {
          title: 'Result disputed',
          body: `${name} disputes the result you reported in ${battle}. Report it again, or play the game online.`,
        };
      case 'online':
        return {
          title: 'Back online',
          body: `${name} took ${battle} back online. ${correspondence ? 'The clock is running again.' : 'The clocks start in 15 seconds.'}`,
        };
      case 'confirm':
        return null;
    }
  })();
  if (!message) return;
  // Bots aren't told anything: they look at the game themselves.
  const [seat] = await ctx.db
    .select({ botLevel: members.botLevel })
    .from(members)
    .where(and(eq(members.campaignId, game.campaignId), eq(members.userId, opponentId)));
  if (seat?.botLevel != null) return;
  await ctx.notifier.send({
    userId: opponentId,
    url: `/c/${game.campaignId}?game=${game.id}`,
    tag: `game:${game.id}`,
    ...message,
  });
}

/**
 * Ends a game on time if the side to move is past their deadline (live games get a little grace for
 * lag). Over the board, a reported result nobody answered by its deadline stands.
 */
export async function flagIfDue(ctx: AppContext, gameId: string, upTo: Date = ctx.now()): Promise<void> {
  await changeGame(
    ctx,
    gameId,
    null,
    (game, chess) => {
      if (game.status !== 'playing' || !game.deadline) return null;
      const grace = game.timeControl.kind === 'live' ? FLAG_GRACE_MS : 0;
      if (upTo.getTime() < game.deadline.getTime() + grace) return null;
      if (game.overTheBoardAt) {
        return game.report ? finish({ result: game.report.result, reason: 'over-the-board' }, game.deadline) : null;
      }
      const mover = chess.turn;
      const clocks = game.clocks ? { clocks: { ...game.clocks, [mover]: 0 } } : {};
      return finish(chess.timeout(mover), game.deadline, clocks);
    },
    undefined,
    { upTo },
  );
}

/** Arms the timer that flags a live game's side to move the moment their time runs out. */
export function armFlag(ctx: AppContext, game: GameRow): void {
  if (game.status !== 'playing' || !game.deadline || game.timeControl.kind !== 'live') {
    ctx.timers.clear(`flag:${game.id}`);
    return;
  }
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
 * Deadlines the server keeps: flags games whose side to move ran out of time by `upTo`, and
 * settles games that finished while their war wasn't updated (the server stopped in between).
 */
export async function flagOverdueGames(ctx: AppContext, upTo: Date = ctx.now()): Promise<void> {
  const due = await ctx.db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.status, 'playing'), lte(games.deadline, upTo)));
  for (const { id } of due) {
    await flagIfDue(ctx, id, upTo).catch((err: unknown) => ctx.log.error({ err, gameId: id }, 'flag check failed'));
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
