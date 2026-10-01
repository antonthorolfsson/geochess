/**
 * Runs the bots. After any change to a campaign with bots in it, a pass works out what they do
 * next and does it, one action at a time, through the same services a player's requests go to,
 * so every rule is checked for them as for anyone. After any change to a game with a bot in it, the
 * bot moves (at once in correspondence; in live games once the clocks start, after a short
 * pause), or answers a draw offer. The scheduler's sweep catches anything missed, such as work
 * left over from before a restart.
 */
import { colorToMove, parseRules, type Color, type WarReply, type WarResponse } from '@empire/rules';
import { PROPOSED_ACCORD_ROUNDS, liveBots, type Reply, type Response } from '@empire/sim/live';
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { mutate } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { accords, campaigns, games, members, missionPlayers, peaceOffers, wars } from '../db/schema';
import { answerAccord, proposeAccord, renounceAccord } from '../diplomacy/accords';
import { HttpError } from '../lib/errors';
import { chooseSecret } from '../victory/selection';
import type { GameRow } from '../wars/board';
import { gameAction, overTheBoardAction, playMove } from '../wars/games';
import { answerPeace, proposePeace } from '../wars/peace';
import { declareWar, fortifyCountry, replyToWar, respondToWar } from '../wars/service';
import { passTurn } from '../wars/turns';
import { chooseMove, drawThreshold, takesDraw, thinkingMs } from './chess';
import { acceptsPeace, actionKey, nextAction, type BotAction, type Decider } from './decide';
import type { ChessEngine } from './engine';
import { playedByBot } from './ids';
import { botState, loadSnapshot } from './state';

/** The most a pass does before it hands over, should something keep it going. */
const MAX_ACTIONS = 60;
/** How long the sweep leaves a campaign alone after a pass failed on it. */
const COOL_DOWN_MS = 60_000;
/** How long closing waits for work underway. */
const CLOSE_WAIT_MS = 5_000;
/** At full strength, a live move takes at most this share of the clock. */
const CLOCK_SHARE = 1 / 30;

interface Work {
  again: boolean;
}

type GameRef = Pick<GameRow, 'id' | 'status' | 'whiteId' | 'blackId'>;

export class BotRunner {
  private readonly ctx: AppContext;
  private readonly engine: ChessEngine;
  /** Live games: pause over each move and wake for it, rather than leave it to the sweep. */
  private readonly pausing: boolean;
  private readonly decider: Decider;
  private readonly passes = new Map<string, Work>();
  private readonly moves = new Map<string, Work>();
  private readonly wakeups = new Map<string, NodeJS.Timeout>();
  /** The move worked out for a game's ply and when to play it, so a re-run keeps both. */
  private readonly plans = new Map<string, { uci: string; at: number }>();
  /** Draw offers already weighed, by game, ply and who offered. */
  private readonly draws = new Map<string, boolean>();
  private readonly failedAt = new Map<string, number>();
  private busy = 0;
  private idlers: (() => void)[] = [];
  private closed = false;

  constructor(ctx: AppContext, engine: ChessEngine, opts: { pausing: boolean }) {
    this.ctx = ctx;
    this.engine = engine;
    this.pausing = opts.pausing;
    this.decider = { ctx, bots: liveBots(), random: () => ctx.random() };
  }

  /** A campaign changed: its bots may have something to do. */
  campaignChanged(campaignId: string): void {
    this.run(this.passes, campaignId, () => this.pass(campaignId));
  }

  /**
   * A game changed: a bot in it may be to move or have a draw offer to answer. Whether a bot plays
   * either side (a bot of its own, or one standing in for a person) is looked up then.
   */
  gameChanged(game: GameRef): void {
    if (game.status !== 'playing') return;
    this.run(this.moves, game.id, () => this.play(game.id));
  }

  /**
   * Finds bot work nothing announced: answers owed, secrets to choose, rounds not begun, turns to
   * declare, moves due.
   */
  async sweep(): Promise<void> {
    const { db } = this.ctx;
    // Usually no campaign underway has a bot: one look settles that before the rest.
    const [underway] = await db
      .select({ campaignId: members.campaignId })
      .from(members)
      .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
      .where(and(isNotNull(members.botLevel), inArray(campaigns.status, ['draft', 'selection', 'active'])))
      .limit(1);
    if (!underway) return;
    const due = new Set<string>();
    const add = (rows: { campaignId: string }[]) => rows.forEach((r) => due.add(r.campaignId));
    add(
      await db
        .selectDistinct({ campaignId: wars.campaignId })
        .from(wars)
        .where(
          or(
            and(eq(wars.status, 'declared'), playedByBot(wars.campaignId, wars.defenderId)),
            and(eq(wars.status, 'countered'), playedByBot(wars.campaignId, wars.attackerId)),
          ),
        ),
    );
    add(
      await db
        .selectDistinct({ campaignId: accords.campaignId })
        .from(accords)
        .where(and(eq(accords.status, 'proposed'), playedByBot(accords.campaignId, accords.recipientId))),
    );
    add(
      await db
        .selectDistinct({ campaignId: peaceOffers.campaignId })
        .from(peaceOffers)
        .where(and(eq(peaceOffers.status, 'proposed'), playedByBot(peaceOffers.campaignId, peaceOffers.recipientId))),
    );
    add(
      await db
        .selectDistinct({ campaignId: missionPlayers.campaignId })
        .from(missionPlayers)
        .innerJoin(campaigns, eq(campaigns.id, missionPlayers.campaignId))
        .where(
          and(
            eq(campaigns.status, 'selection'),
            playedByBot(missionPlayers.campaignId, missionPlayers.userId),
            isNull(missionPlayers.secret),
            eq(missionPlayers.noSecret, false),
            sql`jsonb_array_length(${missionPlayers.options}) > 0`,
          ),
        ),
    );
    add(
      await db
        .selectDistinct({ campaignId: members.campaignId })
        .from(members)
        .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
        .where(
          and(
            isNotNull(members.botLevel),
            inArray(campaigns.status, ['selection', 'active']),
            or(isNull(members.botRound), lt(members.botRound, campaigns.round)),
          ),
        ),
    );
    add(
      await db
        .select({ campaignId: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.status, 'active'), playedByBot(campaigns.id, campaigns.turnUserId))),
    );
    const now = Date.now();
    for (const id of due) if (now - (this.failedAt.get(id) ?? -Infinity) >= COOL_DOWN_MS) this.campaignChanged(id);

    const owed = await db
      .select({ id: games.id, status: games.status, whiteId: games.whiteId, blackId: games.blackId })
      .from(games)
      .where(
        and(
          eq(games.status, 'playing'),
          or(
            and(playedByBot(games.campaignId, games.whiteId), sql`jsonb_array_length(${games.moves}) % 2 = 0`),
            and(playedByBot(games.campaignId, games.blackId), sql`jsonb_array_length(${games.moves}) % 2 = 1`),
            and(
              or(
                isNotNull(games.drawOfferBy),
                isNotNull(games.otbOfferBy),
                and(isNotNull(games.overTheBoardAt), isNull(games.report)),
              ),
              or(playedByBot(games.campaignId, games.whiteId), playedByBot(games.campaignId, games.blackId)),
            ),
          ),
        ),
      );
    for (const game of owed) this.gameChanged(game);
  }

  /** Resolves once no bot work is queued or underway (for tests). */
  idle(): Promise<void> {
    return this.busy === 0 ? Promise.resolve() : new Promise((resolve) => this.idlers.push(resolve));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.wakeups.values()) clearTimeout(timer);
    this.wakeups.clear();
    await Promise.race([this.idle(), new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS).unref())]);
  }

  /** Runs `job` for `key` unless it's already running, in which case it runs once more after. */
  private run(queue: Map<string, Work>, key: string, job: () => Promise<void>): void {
    if (this.closed) return;
    const queued = queue.get(key);
    if (queued) {
      queued.again = true;
      return;
    }
    const work: Work = { again: false };
    queue.set(key, work);
    this.busy++;
    void (async () => {
      try {
        do {
          work.again = false;
          await job().catch((err: unknown) => this.ctx.log.error({ err, key }, 'bot work failed'));
        } while (work.again && !this.closed);
      } finally {
        queue.delete(key);
        if (--this.busy === 0) for (const resolve of this.idlers.splice(0)) resolve();
      }
    })();
  }

  // -------------------------------------------------------------------------------------------
  // Campaigns

  private async pass(campaignId: string): Promise<void> {
    const skip = new Set<string>();
    try {
      for (let step = 0; step < MAX_ACTIONS && !this.closed; step++) {
        const snap = await loadSnapshot(this.ctx, campaignId);
        if (!snap) return;
        const action = nextAction(this.decider, snap, skip);
        if (!action) return;
        try {
          await this.perform(campaignId, action);
        } catch (err) {
          skip.add(actionKey(action));
          this.report(err, campaignId, action);
          await this.fallBack(campaignId, action);
        }
      }
      if (!this.closed) this.ctx.log.warn({ campaignId }, 'bots stopped after the most actions a pass may take');
    } catch (err) {
      this.failedAt.set(campaignId, Date.now());
      throw err;
    }
  }

  private async perform(campaignId: string, a: BotAction): Promise<void> {
    const { ctx } = this;
    switch (a.kind) {
      case 'accord':
        return answerAccord(ctx, campaignId, a.accordId, a.botId, a.accept ? 'accept' : 'decline');
      case 'secret':
        return chooseSecret(ctx, campaignId, a.botId, a.optionId);
      case 'peace':
        return answerPeace(ctx, campaignId, a.warId, a.offerId, a.botId, a.accept ? 'accept' : 'decline');
      case 'respond': {
        let answer = a.answer;
        if (answer.kind === 'peace') {
          // Terms first, and the answer it falls back on meanwhile, should they be turned down.
          const { terms } = answer;
          await this.attempt(campaignId, a, () => proposePeace(ctx, campaignId, a.warId, a.botId, { terms }));
          answer = answer.fallback;
        }
        return respondToWar(ctx, campaignId, a.warId, a.botId, warResponse(answer));
      }
      case 'reply':
        return replyToWar(ctx, campaignId, a.warId, a.botId, warReply(a.reply));
      case 'renounce':
        return renounceAccord(ctx, campaignId, a.accordId, a.botId);
      case 'round': {
        const { propose, fortify } = a;
        if (propose) {
          await this.attempt(campaignId, a, () =>
            proposeAccord(ctx, campaignId, a.botId, { partnerId: propose, rounds: PROPOSED_ACCORD_ROUNDS }),
          );
        }
        if (fortify) await this.attempt(campaignId, a, () => fortifyCountry(ctx, campaignId, a.botId, fortify));
        // The bot's own bookkeeping: nobody else needs to hear of it.
        await mutate(ctx, campaignId, async (scope) => {
          await scope.tx
            .update(members)
            .set({ botRound: a.round })
            .where(and(eq(members.campaignId, campaignId), eq(members.userId, a.botId)));
          scope.notifyOnly([]);
        });
        return;
      }
      case 'declare':
        await declareWar(ctx, campaignId, a.botId, a.declaration);
        return;
      case 'fortify':
        await fortifyCountry(ctx, campaignId, a.botId, a.territoryId);
        return;
      case 'pass':
        return passTurn(ctx, campaignId, a.botId, { userId: a.botId });
    }
  }

  /** What silence would have done, when the bot's own answer was refused. */
  private async fallBack(campaignId: string, a: BotAction): Promise<void> {
    const { ctx } = this;
    const safe: (() => Promise<unknown>) | null =
      a.kind === 'respond'
        ? () => respondToWar(ctx, campaignId, a.warId, a.botId, { response: 'accept' })
        : a.kind === 'reply'
          ? () =>
              replyToWar(ctx, campaignId, a.warId, a.botId, {
                reply: a.counter === 'tribute' ? 'accept' : 'withdraw',
              })
          : a.kind === 'peace' && a.accept
            ? () => answerPeace(ctx, campaignId, a.warId, a.offerId, a.botId, 'decline')
            : a.kind === 'accord' && a.accept
              ? () => answerAccord(ctx, campaignId, a.accordId, a.botId, 'decline')
              : null;
    if (safe) await this.attempt(campaignId, a, safe);
  }

  /** Runs one step of an action, reporting rather than throwing if it's refused. */
  private async attempt(campaignId: string, a: BotAction, step: () => Promise<unknown>): Promise<void> {
    try {
      await step();
    } catch (err) {
      this.report(err, campaignId, a);
    }
  }

  private report(err: unknown, campaignId: string, action: BotAction): void {
    // A refusal is usually the campaign moving on first (an answer in the meantime, a deadline).
    if (err instanceof HttpError) this.ctx.log.info({ campaignId, action, refused: err.message }, 'a bot was refused');
    else this.ctx.log.error({ err, campaignId, action }, 'a bot action failed');
  }

  // -------------------------------------------------------------------------------------------
  // Games

  private async play(gameId: string): Promise<void> {
    const { ctx } = this;
    const [game] = await ctx.db.select().from(games).where(eq(games.id, gameId));
    if (!game || game.status !== 'playing') return;
    const seats = await ctx.db
      .select({ userId: members.userId, level: members.botLevel })
      .from(members)
      .where(and(eq(members.campaignId, game.campaignId), inArray(members.userId, [game.whiteId, game.blackId])));
    /** The level of the bot playing this side, or null for a person. */
    const botLevel = (userId: string) => seats.find((seat) => seat.userId === userId)?.level ?? null;
    if (botLevel(game.whiteId) === null && botLevel(game.blackId) === null) return;
    const ply = game.moves.length;
    const turn = colorToMove(ply);
    const moverId = turn === 'white' ? game.whiteId : game.blackId;

    // Bots play online only. One offered a real board turns it down; one standing in for a person
    // who was playing over the board takes the game back online, once a reported result is answered
    // (or stands).
    if (game.otbOfferBy) {
      const botId = game.otbOfferBy === game.whiteId ? game.blackId : game.whiteId;
      if (botLevel(botId) !== null) return this.act(() => overTheBoardAction(ctx, gameId, botId, 'decline'));
    }
    if (game.overTheBoardAt) {
      if (game.report) return;
      const botId = botLevel(game.whiteId) !== null ? game.whiteId : game.blackId;
      return this.act(() => overTheBoardAction(ctx, gameId, botId, 'online'));
    }

    // A draw offered to a bot: taken, turned down, or on its own move passed over by moving.
    if (game.drawOfferBy) {
      const botId = game.drawOfferBy === game.whiteId ? game.blackId : game.whiteId;
      if (botLevel(botId) !== null) {
        if (await this.takesDraw(game, botId)) return this.act(() => gameAction(ctx, gameId, botId, 'accept-draw'));
        if (botId !== moverId) return this.act(() => gameAction(ctx, gameId, botId, 'decline-draw'));
      }
    }
    const level = botLevel(moverId);
    if (level === null) return;
    const startsAt = game.startsAt?.getTime() ?? 0;
    if (startsAt > ctx.now().getTime()) return this.wake(gameId, startsAt - ctx.now().getTime());
    // The move is worked out first; its pause, counted from the start of the turn, takes the search in.
    const key = `${gameId}:${ply}`;
    let plan = this.plans.get(key);
    if (!plan) {
      const clock = game.clocks?.[turn];
      const uci = await chooseMove(this.engine, level, game.moves, () => ctx.random(), {
        movetimeMs: game.timeControl.kind === 'live' && clock !== undefined ? clock * CLOCK_SHARE : undefined,
        onError: (err) => ctx.log.error({ err, gameId }, 'the chess engine failed, so the bot played a random move'),
      });
      plan = { uci, at: this.moveAt(game) };
      // Games that end on someone else's move leave their last plan behind.
      if (this.plans.size > 1_000) this.plans.clear();
      this.plans.set(key, plan);
    }
    const wait = plan.at - ctx.now().getTime();
    if (wait > 0) return this.wake(gameId, wait);
    this.plans.delete(key);
    // Moving would pass over terms offered to the bot in this war: it answers them first.
    if (await this.answerPeaceFirst(game, moverId)) return;
    const { uci } = plan;
    await this.act(() => playMove(ctx, gameId, moverId, { uci, ply }));
  }

  /**
   * When the bot to move plays: in a live game, its pause after the turn began (without pauses, as
   * in tests, at once); in correspondence, at once.
   */
  private moveAt(game: GameRow): number {
    const start = game.startsAt?.getTime() ?? 0;
    if (game.timeControl.kind !== 'live' || !this.pausing) return start;
    const since = Math.max(start, game.lastMoveAt?.getTime() ?? start);
    const turn: Color = colorToMove(game.moves.length);
    const clock = game.clocks?.[turn] ?? game.timeControl[turn].initialMs;
    return since + thinkingMs(clock, game.timeControl[turn].incrementMs, game.moves.length, () => this.ctx.random());
  }

  /** Looks at the game again in `ms`. Without pauses, the scheduler's sweep does. */
  private wake(gameId: string, ms: number): void {
    if (!this.pausing || this.closed) return;
    clearTimeout(this.wakeups.get(gameId));
    const timer = setTimeout(() => {
      this.wakeups.delete(gameId);
      this.run(this.moves, gameId, () => this.play(gameId));
    }, ms);
    timer.unref();
    this.wakeups.set(gameId, timer);
  }

  /** Answers any peace terms offered to the bot in this game's war; true if it took them. */
  private async answerPeaceFirst(game: GameRow, botId: string): Promise<boolean> {
    const { ctx } = this;
    const offers = await ctx.db
      .select({ id: peaceOffers.id })
      .from(peaceOffers)
      .where(
        and(eq(peaceOffers.warId, game.warId), eq(peaceOffers.recipientId, botId), eq(peaceOffers.status, 'proposed')),
      );
    if (offers.length === 0) return false;
    const snap = await loadSnapshot(ctx, game.campaignId);
    if (!snap) return false;
    const view = botState(ctx, snap, botId, Math.floor(ctx.random() * 2 ** 31));
    for (const { id } of offers) {
      const accept = acceptsPeace(this.decider, view, id);
      await this.act(() => answerPeace(ctx, game.campaignId, game.warId, id, botId, accept ? 'accept' : 'decline'));
      if (accept) return true;
    }
    return false;
  }

  private async takesDraw(game: GameRow, botId: string): Promise<boolean> {
    const key = `${game.id}:${game.moves.length}:${game.drawOfferBy}`;
    const known = this.draws.get(key);
    if (known !== undefined) return known;
    const [row] = await this.ctx.db
      .select({ attackerId: wars.attackerId, rules: campaigns.rules })
      .from(wars)
      .innerJoin(campaigns, eq(campaigns.id, wars.campaignId))
      .where(eq(wars.id, game.warId));
    if (!row) return false;
    const color: Color = botId === game.whiteId ? 'white' : 'black';
    const threshold = drawThreshold(game, parseRules(row.rules).war.draws, color, row.attackerId === botId);
    const takes = await takesDraw(this.engine, game.moves, color, threshold).catch((err: unknown) => {
      this.ctx.log.error({ err, gameId: game.id }, 'the chess engine failed, so the bot turned the draw down');
      return false;
    });
    if (this.draws.size > 1_000) this.draws.clear();
    this.draws.set(key, takes);
    return takes;
  }

  /** A move or game action; one refused (the game ended, the position moved on) is left be. */
  private async act(step: () => Promise<unknown>): Promise<void> {
    try {
      await step();
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      this.ctx.log.info({ refused: err.message }, 'a bot’s move was refused');
    }
  }
}

function warResponse(r: Response): WarResponse {
  switch (r.kind) {
    case 'accept':
      return { response: 'accept' };
    case 'raise':
      return r.territoryId ? { response: 'raise', territoryId: r.territoryId } : { response: 'raise' };
    case 'redirect':
      return { response: 'redirect', targetId: r.targetId };
    case 'tribute':
      return 'territoryId' in r
        ? { response: 'tribute', territoryId: r.territoryId }
        : { response: 'tribute', tokens: r.tokens };
  }
}

function warReply(r: Reply): WarReply {
  return r.kind === 'accept' ? { reply: 'accept', ...(r.stake ? { stake: r.stake } : {}) } : { reply: r.kind };
}
