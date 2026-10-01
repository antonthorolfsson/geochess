import {
  DECLARE_COST,
  FORTIFY_COST,
  FORTIFY_REJECTION_MESSAGES,
  INITIAL_FEN,
  RESERVE_REJECTION_MESSAGES,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_TEXT,
  STAKE_REJECTION_MESSAGES,
  TARGET_REJECTION_MESSAGES,
  afterGame,
  attackerColor,
  canRaise,
  canRecall,
  checkFortify,
  checkReserves,
  checkStake,
  checkTarget,
  clockModifiers,
  clockTarget,
  counterCost,
  fortifyEnds,
  getTerritory,
  initialClocks,
  lastRoundOf,
  raiseDemand,
  raiseOptions,
  redirectOptions,
  refillTokens,
  stakeFromReserves,
  tributeOptions,
  turnDeadline,
  valueOf,
  ratingHandicap,
  warTimeControl,
  warTransfers,
  winnerOf,
  type DeclareWarInput,
  type GameEndReason,
  type GameResult,
  type Handicap,
  type PeaceTerms,
  type Transfer,
  type WarCounter,
  type WarOutcome,
  type WarReply,
  type WarResponse,
} from '@empire/rules';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { mutate, requireActive, requireHost, requireMember, userName, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns, games, holdings, members, peaceOffers, wars } from '../db/schema';
import { startRoundForAccords } from '../diplomacy/accords';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { seatRating } from '../ratings/service';
import type { Notice } from '../notifications/notifier';
import { botSeats } from '../bots/ids';
import { endSeason } from '../victory/finish';
import { loadBoard, type WarRow } from './board';
import { armFlag, publishGame } from './games';
import { beginTurns, declaring, requireTurn, roundTurnOrder, turnTaken } from './turns';

/** Live games open with a countdown, so both players can get to the board. */
export const LIVE_COUNTDOWN_MS = 15_000;

export const warUrl = (war: WarRow) => `/c/${war.campaignId}?war=${war.id}`;
const gameUrl = (campaignId: string, gameId: string) => `/c/${campaignId}?game=${gameId}`;

function notify(_ctx: AppContext, scope: MutationScope, notice: Notice): void {
  scope.notify(notice);
}

function windowText(scope: MutationScope): string {
  return RESPONSE_WINDOW_TEXT[scope.campaign.rules.war.pace];
}

function responseDeadline(ctx: AppContext, scope: MutationScope): Date {
  return new Date(ctx.now().getTime() + RESPONSE_WINDOW_MS[scope.campaign.rules.war.pace]);
}

export async function addTokens(scope: MutationScope, userId: string, delta: number): Promise<void> {
  await scope.tx
    .update(members)
    .set({ tokens: sql`${members.tokens} + ${delta}` })
    .where(and(eq(members.campaignId, scope.campaign.id), eq(members.userId, userId)));
  const member = scope.members.find((m) => m.userId === userId);
  if (member) member.tokens += delta;
}

export async function findWar(scope: MutationScope, warId: string): Promise<WarRow> {
  const [war] = await scope.tx
    .select()
    .from(wars)
    .where(and(eq(wars.id, warId), eq(wars.campaignId, scope.campaign.id)));
  if (!war) throw notFound('War not found.');
  return war;
}

async function updateWar(scope: MutationScope, war: WarRow, set: Partial<WarRow>): Promise<WarRow> {
  const [row] = await scope.tx.update(wars).set(set).where(eq(wars.id, war.id)).returning();
  return row!;
}

// ---------------------------------------------------------------------------------------------
// Declaring and answering

export async function declareWar(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  input: DeclareWarInput,
): Promise<{ id: string }> {
  return mutate(ctx, campaignId, async (scope) => {
    const me = requireMember(scope, userId);
    requireActive(scope);
    await requireTurn(scope, userId);
    if (me.tokens < DECLARE_COST) throw conflict('You have no war tokens. The next round brings one.', 'no-tokens');
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const targetRejection = checkTarget(board, userId, input.targetId);
    if (targetRejection) throw conflict(TARGET_REJECTION_MESSAGES[targetRejection], targetRejection);
    const stakeRejection = checkStake(board, userId, input.targetId, input.launchId, input.stake);
    if (stakeRejection) throw badRequest(STAKE_REJECTION_MESSAGES[stakeRejection], stakeRejection);
    const reserves = input.reserves ?? [];
    const reserveRejection = checkReserves(board, userId, input.launchId, input.stake, reserves);
    if (reserveRejection) throw badRequest(RESERVE_REJECTION_MESSAGES[reserveRejection], reserveRejection);

    const defenderId = board.holdings.get(input.targetId)!.ownerId;
    const stake = [input.launchId, ...input.stake.filter((id) => id !== input.launchId)];
    const [war] = await scope.tx
      .insert(wars)
      .values({
        id: newId(),
        campaignId,
        attackerId: userId,
        defenderId,
        targetId: input.targetId,
        launchId: input.launchId,
        stake,
        reserves,
        status: 'declared',
        declaredRound: scope.campaign.round,
        respondBy: responseDeadline(ctx, scope),
        declaredAt: ctx.now(),
      })
      .returning();
    await addTokens(scope, userId, -DECLARE_COST);
    await scope.log.add(
      {
        type: 'war.declared',
        payload: {
          warId: war!.id,
          attackerId: userId,
          defenderId,
          targetId: input.targetId,
          launchId: input.launchId,
          stake,
          ...(reserves.length > 0 ? { reserves } : {}),
        },
      },
      userId,
      scope.campaign.round,
    );

    const target = getTerritory(board.idx, input.targetId);
    notify(ctx, scope, {
      userId: defenderId,
      title: `War declared on ${target.name}`,
      body:
        `${await userName(scope.tx, userId)} attacks ${target.name} (${target.value}), staking ` +
        `${valueOf(board.idx, stake)}${reserves.length > 0 ? `, with ${valueOf(board.idx, reserves)} in reserve` : ''}. ` +
        `Answer within ${windowText(scope)} or the war goes ahead as declared.`,
      url: warUrl(war!),
      tag: `war:${war!.id}`,
      email: true,
    });
    await turnTaken(ctx, scope, userId);
    return { id: war!.id };
  });
}

/** The defender answers a declaration: accept, raise, redirect or offer tribute. */
export async function respondToWar(
  ctx: AppContext,
  campaignId: string,
  warId: string,
  userId: string,
  input: WarResponse,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const war = await findWar(scope, warId);
    if (war.defenderId !== userId) throw forbidden('Only the defender can answer this declaration.');
    if (war.status !== 'declared') throw conflict('This declaration has already been answered.', 'already-answered');
    await applyResponse(ctx, scope, war, input, false);
  });
}

async function applyResponse(
  ctx: AppContext,
  scope: MutationScope,
  war: WarRow,
  input: WarResponse,
  auto: boolean,
): Promise<void> {
  const board = await loadBoard(ctx, scope.tx, scope.campaign);
  const target = getTerritory(board.idx, war.targetId);
  const active = board.wars.find((w) => w.id === war.id)!;
  const rules = scope.campaign.rules.war;
  let counter: WarCounter | null = null;
  switch (input.response) {
    case 'accept':
      break;
    case 'raise': {
      if (rules.raise === 'off') throw conflict("Raising is not part of this campaign's rules.", 'no-raise');
      if (rules.raise === 'matched') {
        if (!input.territoryId) throw badRequest('Choose the country to put into the war.', 'raise-country');
        if (!raiseOptions(board, active).includes(input.territoryId)) {
          throw badRequest(
            'Put in one of your countries that is free to stake, worth between half the target and all of it, and no more than the attacker could still add.',
            'bad-raise',
          );
        }
        counter = { kind: 'raise', minValue: raiseDemand(board, active, input.territoryId), added: input.territoryId };
        break;
      }
      if (!canRaise(board, active))
        throw conflict('The stake already meets what a raise would demand.', 'cannot-raise');
      const cost = await payForCounter(scope, war.defenderId, counterCost(scope.campaign.rules, 'raise'));
      counter = { kind: 'raise', minValue: raiseDemand(board, active), ...(cost > 0 ? { tokens: cost } : {}) };
      break;
    }
    case 'redirect': {
      if (!redirectOptions(board, active).includes(input.targetId)) {
        throw badRequest(
          rules.redirect === 'nearby'
            ? 'Redirect to another of your countries worth the same, bordering both the target and the attacker, and not caught up in a war.'
            : 'Redirect to another of your countries worth the same, bordering the attacker and not caught up in a war.',
          'bad-redirect',
        );
      }
      const cost = await payForCounter(scope, war.defenderId, counterCost(scope.campaign.rules, 'redirect'));
      counter = { kind: 'redirect', targetId: input.targetId, ...(cost > 0 ? { tokens: cost } : {}) };
      break;
    }
    case 'tribute': {
      if (rules.peaceTerms) throw conflict('In this campaign, peace terms take the place of tribute.', 'no-tribute');
      const tokens = input.tokens ?? 0;
      if ((input.territoryId === undefined) === (tokens === 0)) {
        throw badRequest('Offer either one country or some tokens.', 'bad-tribute');
      }
      if (input.territoryId !== undefined && !tributeOptions(board, active).includes(input.territoryId)) {
        throw badRequest(
          'Tribute must be one of your countries worth less than the target and not caught up in a war.',
          'bad-tribute',
        );
      }
      const defender = requireMember(scope, war.defenderId);
      if (tokens > defender.tokens) throw conflict(`You have ${defender.tokens} tokens to offer.`, 'not-enough-tokens');
      // Offered tokens are held back until the attacker answers.
      if (tokens > 0) await addTokens(scope, war.defenderId, -tokens);
      counter = { kind: 'tribute', territoryId: input.territoryId ?? null, tokens };
      break;
    }
  }
  await scope.log.add(
    { type: 'war.response', payload: { warId: war.id, response: input.response, counter, auto } },
    auto ? null : war.defenderId,
    scope.campaign.round,
  );
  if (!counter) {
    await beginFighting(ctx, scope, war);
    return;
  }
  const countered = await updateWar(scope, war, {
    status: 'countered',
    counter,
    respondBy: responseDeadline(ctx, scope),
  });
  // Reserves set aside at the declaration meet a raise at once, when they can.
  if (counter.kind === 'raise' && countered.reserves.length > 0) {
    const stake = stakeFromReserves(board.idx, countered.stake, countered.reserves, counter.minValue);
    if (stake) {
      await applyReply(ctx, scope, countered, { reply: 'accept', stake }, false, true);
      return;
    }
  }
  const defender = await userName(scope.tx, war.defenderId);
  const title = {
    raise: `${defender} raised the stakes`,
    redirect: `${defender} redirects your attack`,
    tribute: `${defender} offers tribute`,
  }[counter.kind];
  const added = counter.kind === 'raise' && counter.added ? getTerritory(board.idx, counter.added) : null;
  notify(ctx, scope, {
    userId: war.attackerId,
    title,
    body:
      (added ? `${defender} puts ${added.name} (${added.value}) into the war: winning takes it too. ` : '') +
      `Your war on ${target.name} needs an answer within ${windowText(scope)}.`,
    url: warUrl(countered),
    tag: `war:${war.id}`,
    email: true,
  });
}

/** Takes what a counter-offer costs from the defender's tokens, refusing it if they're short. Returns the cost. */
async function payForCounter(scope: MutationScope, defenderId: string, cost: number): Promise<number> {
  if (cost === 0) return 0;
  const defender = requireMember(scope, defenderId);
  if (defender.tokens < cost) {
    throw conflict(
      `That costs ${cost} war ${cost === 1 ? 'token' : 'tokens'}, and you have ${defender.tokens}.`,
      'no-tokens',
    );
  }
  await addTokens(scope, defenderId, -cost);
  return cost;
}

/** The attacker answers a counter-offer. */
export async function replyToWar(
  ctx: AppContext,
  campaignId: string,
  warId: string,
  userId: string,
  input: WarReply,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const war = await findWar(scope, warId);
    if (war.attackerId !== userId) throw forbidden('Only the attacker can answer this.');
    if (war.status !== 'countered' || !war.counter) throw conflict('There is nothing to answer.', 'nothing-to-answer');
    await applyReply(ctx, scope, war, input, false);
  });
}

async function applyReply(
  ctx: AppContext,
  scope: MutationScope,
  war: WarRow,
  input: WarReply,
  auto: boolean,
  fromReserves = false,
): Promise<void> {
  const counter = war.counter!;
  const allowed: Record<WarCounter['kind'], WarReply['reply'][]> = {
    raise: ['accept', 'withdraw'],
    redirect: ['accept', 'withdraw'],
    tribute: ['accept', 'refuse'],
  };
  if (!allowed[counter.kind].includes(input.reply))
    throw badRequest('That is not an answer to this offer.', 'bad-reply');

  let stake: string[] | undefined;
  if (counter.kind === 'raise' && input.reply === 'accept') {
    stake = input.stake;
    if (!stake) throw badRequest('Choose the raised stake.', 'stake-required');
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const rejection = checkStake(board, war.attackerId, war.targetId, war.launchId, stake, {
      minValue: counter.minValue,
      exceptWarId: war.id,
    });
    if (rejection) throw badRequest(STAKE_REJECTION_MESSAGES[rejection], rejection);
    stake = [war.launchId, ...stake.filter((id) => id !== war.launchId)];
  }
  await scope.log.add(
    {
      type: 'war.reply',
      payload: {
        warId: war.id,
        reply: input.reply,
        ...(stake ? { stake } : {}),
        auto,
        ...(fromReserves ? { fromReserves } : {}),
      },
    },
    auto ? null : war.attackerId,
    scope.campaign.round,
  );

  if (input.reply === 'withdraw') {
    await resolveWar(ctx, scope, war, 'withdrawn');
    return;
  }
  if (counter.kind === 'tribute') {
    if (input.reply === 'refuse') {
      if (counter.tokens > 0) await addTokens(scope, war.defenderId, counter.tokens);
      await beginFighting(ctx, scope, war);
      return;
    }
    if (counter.tokens > 0) await addTokens(scope, war.attackerId, counter.tokens);
    const transfers = counter.territoryId
      ? [{ territoryId: counter.territoryId, from: war.defenderId, to: war.attackerId }]
      : [];
    await resolveWar(ctx, scope, war, 'tribute', { transfers, tokens: counter.tokens });
    return;
  }
  // A counter the defender paid for: the attacker gets the tokens for fighting on.
  if (counter.tokens) await addTokens(scope, war.attackerId, counter.tokens);
  const next =
    counter.kind === 'raise'
      ? await updateWar(scope, war, { stake })
      : await updateWar(scope, war, { targetId: counter.targetId, redirectedFrom: war.targetId });
  await beginFighting(ctx, scope, next);
}

/**
 * The attacker calls off a declaration before the defender has answered, where the rules allow
 * it: the token is spent, nothing changes hands, and no truce follows.
 */
export async function recallWar(ctx: AppContext, campaignId: string, warId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const war = await findWar(scope, warId);
    if (war.attackerId !== userId) throw forbidden('Only the attacker can call off a declaration.');
    if (!scope.campaign.rules.war.recall) {
      throw conflict("Calling off a declaration is not part of this campaign's rules.", 'no-recall');
    }
    if (!canRecall(scope.campaign.rules, war.status)) {
      throw conflict('The defender has already answered, so the declaration stands.', 'already-answered');
    }
    await scope.log.add({ type: 'war.recalled', payload: { warId: war.id } }, userId, scope.campaign.round);
    await resolveWar(ctx, scope, war, 'withdrawn');
  });
}

/**
 * A player spends a war token fortifying one of their countries: until the round after next
 * starts, war on it needs a stake of the raise's percentage. Public, like the map.
 */
export async function fortifyCountry(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  territoryId: string,
): Promise<{ untilRound: number }> {
  return mutate(ctx, campaignId, async (scope) => {
    const me = requireMember(scope, userId);
    requireActive(scope);
    await requireTurn(scope, userId);
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const rejection = checkFortify(board, userId, territoryId);
    if (rejection) {
      const message = FORTIFY_REJECTION_MESSAGES[rejection];
      throw rejection === 'off' || rejection === 'fortified'
        ? conflict(message, rejection)
        : badRequest(message, rejection);
    }
    if (me.tokens < FORTIFY_COST) {
      throw conflict('Fortifying costs a war token, and you have none. The next round brings one.', 'no-tokens');
    }
    await addTokens(scope, userId, -FORTIFY_COST);
    const untilRound = fortifyEnds(scope.campaign.round);
    await scope.tx
      .update(holdings)
      .set({ fortifiedUntil: untilRound })
      .where(and(eq(holdings.campaignId, campaignId), eq(holdings.territoryId, territoryId)));
    await scope.log.add(
      { type: 'country.fortified', payload: { userId, territoryId, untilRound } },
      userId,
      scope.campaign.round,
    );
    await turnTaken(ctx, scope, userId);
    return { untilRound };
  });
}

// ---------------------------------------------------------------------------------------------
// Fighting

/**
 * Players in a game that's underway in this campaign; each person plays one live game at a time.
 * A bot (standing in for a person, too) can play any number at once.
 */
export async function busyPlayers(scope: MutationScope): Promise<Set<string>> {
  const rows = await scope.tx
    .select({ whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(and(eq(games.campaignId, scope.campaign.id), eq(games.status, 'playing')));
  const bots = botSeats(scope.members);
  return new Set(rows.flatMap((r) => [r.whiteId, r.blackId]).filter((id) => !bots.has(id)));
}

/**
 * Sets up the war's game (or its Armageddon tiebreak, played over the board if the drawn game
 * was). Live games wait until neither player is in another game, and while players are taking
 * turns to declare; correspondence games start at once.
 */
async function beginFighting(
  ctx: AppContext,
  scope: MutationScope,
  war: WarRow,
  armageddon = false,
  overTheBoard = false,
): Promise<void> {
  const board = await loadBoard(ctx, scope.tx, scope.campaign);
  const rules = scope.campaign.rules;
  const modifiers = clockModifiers(board, war.attackerId, clockTarget(rules, war));
  const tc = warTimeControl(rules, modifiers, armageddon, warHandicap(scope, war));
  const attackerWhite = attackerColor(armageddon) === 'white';
  const whiteId = attackerWhite ? war.attackerId : war.defenderId;
  const blackId = attackerWhite ? war.defenderId : war.attackerId;
  const [game] = await scope.tx
    .insert(games)
    .values({
      id: newId(),
      warId: war.id,
      campaignId: war.campaignId,
      armageddon,
      whiteId,
      blackId,
      timeControl: tc,
      fen: INITIAL_FEN,
      clocks: initialClocks(tc),
      status: 'waiting',
      overTheBoardAt: overTheBoard ? ctx.now() : null,
    })
    .returning();
  const busy = tc.kind === 'live' ? await busyPlayers(scope) : new Set<string>();
  if (busy.has(whiteId) || busy.has(blackId) || (tc.kind === 'live' && declaring(scope.campaign))) {
    await updateWar(scope, war, { status: 'ready', respondBy: null });
    return;
  }
  await startGame(ctx, scope, game!.id);
}

/** The rating handicap for a war's game, from the two seats' ratings as they stand (a stand-in plays at its level). */
function warHandicap(scope: MutationScope, war: WarRow): Handicap | null {
  const rating = (userId: string) => {
    const seat = scope.members.find((m) => m.userId === userId);
    return seat ? seatRating(scope.campaign.rules, scope.campaign.status, seat, null)?.rating : null;
  };
  return ratingHandicap(scope.campaign.rules.war, rating(war.attackerId), rating(war.defenderId));
}

async function startGame(ctx: AppContext, scope: MutationScope, gameId: string): Promise<void> {
  const [waiting] = await scope.tx.select().from(games).where(eq(games.id, gameId));
  const game = waiting!;
  const now = ctx.now().getTime();
  const otb = game.overTheBoardAt !== null;
  const startsAt = game.timeControl.kind === 'live' && !otb ? now + LIVE_COUNTDOWN_MS : now;
  const [started] = await scope.tx
    .update(games)
    .set({
      status: 'playing',
      startsAt: new Date(startsAt),
      // Over the board, the clocks here stay stopped.
      lastMoveAt: otb ? null : new Date(startsAt),
      deadline: otb ? null : new Date(turnDeadline(game.timeControl, game.clocks, 'white', startsAt)),
      ...(otb ? { overTheBoardAt: new Date(now) } : {}),
    })
    .where(eq(games.id, gameId))
    .returning();
  const [war] = await scope.tx
    .update(wars)
    .set({ status: 'playing', respondBy: null })
    .where(eq(wars.id, game.warId))
    .returning();
  await scope.log.add(
    {
      type: 'war.started',
      payload: { warId: war!.id, gameId, armageddon: game.armageddon, whiteId: game.whiteId, blackId: game.blackId },
    },
    null,
    scope.campaign.round,
  );
  scope.afterCommit(() => {
    armFlag(ctx, started!);
    ctx.bots.gameChanged(started!);
  });

  const idx = ctx.datasets.get(scope.campaign.datasetVersion);
  const target = getTerritory(idx, war!.targetId).name;
  const live = game.timeControl.kind === 'live';
  for (const [userId, color, opponentId] of [
    [game.whiteId, 'White', game.blackId],
    [game.blackId, 'Black', game.whiteId],
  ] as const) {
    notify(ctx, scope, {
      userId,
      title: `${game.armageddon ? 'Armageddon' : 'The battle'} for ${target} has begun`,
      body:
        `You play ${color} against ${await userName(scope.tx, opponentId)}` +
        (otb
          ? ' over the board, like the game before. Report the result when it is over.'
          : live
            ? '. The clocks start in 15 seconds.'
            : color === 'White'
              ? '. Your move.'
              : '.'),
      url: gameUrl(war!.campaignId, gameId),
      tag: `game:${gameId}`,
      email: !live && !otb && color === 'White',
    });
  }
}

/**
 * Starts queued live games, oldest first, whose players are both free, once nobody is taking turns
 * to declare.
 */
export async function startQueuedGames(ctx: AppContext, scope: MutationScope): Promise<void> {
  if (declaring(scope.campaign)) return;
  const queued = await scope.tx
    .select({ id: games.id, whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(and(eq(games.campaignId, scope.campaign.id), eq(games.status, 'waiting')))
    .orderBy(asc(games.createdAt));
  if (queued.length === 0) return;
  const busy = await busyPlayers(scope);
  const bots = botSeats(scope.members);
  for (const game of queued) {
    if (busy.has(game.whiteId) || busy.has(game.blackId)) continue;
    await startGame(ctx, scope, game.id);
    for (const id of [game.whiteId, game.blackId]) if (!bots.has(id)) busy.add(id);
  }
}

/**
 * Stops a war's games because the war is ending without them (peace terms): a live game waiting
 * its turn, or the one underway, whose moves stand. Waits for a move still being saved, and
 * refuses if the game ended in that moment, since its result stands.
 */
export async function stopWarGames(ctx: AppContext, scope: MutationScope, warId: string): Promise<void> {
  const stopped = await scope.tx
    .update(games)
    .set({ status: 'cancelled', deadline: null, drawOfferBy: null, otbOfferBy: null, report: null })
    .where(and(eq(games.warId, warId), inArray(games.status, ['waiting', 'playing'])))
    .returning();
  const [last] = await scope.tx
    .select({ status: games.status })
    .from(games)
    .where(eq(games.warId, warId))
    .orderBy(desc(games.createdAt))
    .limit(1);
  if (last?.status === 'finished') throw conflict('The game has just ended, and its result stands.', 'game-over');
  scope.afterCommit(async () => {
    for (const game of stopped) {
      ctx.timers.clear(`flag:${game.id}`);
      await publishGame(ctx, game);
    }
  });
}

/**
 * A game has finished: resolve its war, or (on a first-game draw with the Armageddon rule) set up
 * the tiebreak. Safe to call more than once.
 */
export async function settleGame(ctx: AppContext, campaignId: string, gameId: string): Promise<void> {
  await mutate(ctx, campaignId, (scope) => settleFinishedGame(ctx, scope, gameId));
}

async function settleFinishedGame(ctx: AppContext, scope: MutationScope, gameId: string): Promise<void> {
  const [game] = await scope.tx.select().from(games).where(eq(games.id, gameId));
  if (game?.status !== 'finished' || !game.result) return;
  const war = await findWar(scope, game.warId);
  if (war.status !== 'playing') return;
  if (!game.armageddon) {
    const [tiebreak] = await scope.tx
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.warId, war.id), eq(games.armageddon, true)));
    if (tiebreak) return;
  }
  const next = afterGame(scope.campaign.rules, game.armageddon, winnerOf(game.result));
  if (next === 'armageddon') await beginFighting(ctx, scope, war, true, game.reason === 'over-the-board');
  else await resolveWar(ctx, scope, war, next, { result: game.result, reason: game.reason ?? undefined });
  await startQueuedGames(ctx, scope);
}

/**
 * Settles, within a change already underway, every game that finished while this change waited
 * for the campaign: a game settles its war just after it ends, in a change of its own, and
 * anything scored before that must not miss (or end the campaign ahead of) the result.
 */
export async function settleFinishedGames(ctx: AppContext, scope: MutationScope): Promise<void> {
  const finished = await scope.tx
    .select({ id: games.id })
    .from(games)
    .innerJoin(wars, eq(wars.id, games.warId))
    .where(and(eq(games.campaignId, scope.campaign.id), eq(games.status, 'finished'), eq(wars.status, 'playing')))
    .orderBy(asc(games.finishedAt));
  for (const { id } of finished) await settleFinishedGame(ctx, scope, id);
}

// ---------------------------------------------------------------------------------------------
// Resolution

/**
 * A war ends: countries change hands (a fortification doesn't pass with them), offers of peace
 * still open lapse, and both players hear how it ended.
 */
export async function resolveWar(
  ctx: AppContext,
  scope: MutationScope,
  war: WarRow,
  outcome: WarOutcome,
  detail: {
    result?: GameResult;
    reason?: GameEndReason;
    transfers?: Transfer[];
    tokens?: number;
    terms?: PeaceTerms;
  } = {},
): Promise<void> {
  const round = scope.campaign.round;
  const transfers = detail.transfers ?? warTransfers(war, outcome);
  for (const t of transfers) {
    await scope.tx
      .update(holdings)
      .set({ ownerId: t.to, acquiredRound: round, fortifiedUntil: null })
      .where(and(eq(holdings.campaignId, war.campaignId), eq(holdings.territoryId, t.territoryId)));
  }
  await updateWar(scope, war, {
    status: 'resolved',
    outcome,
    resolvedRound: round,
    resolvedAt: ctx.now(),
    respondBy: null,
  });
  await scope.tx
    .update(peaceOffers)
    .set({ status: 'lapsed', respondBy: null, endedAt: ctx.now() })
    .where(and(eq(peaceOffers.warId, war.id), eq(peaceOffers.status, 'proposed')));
  await scope.log.add(
    {
      type: 'war.resolved',
      payload: {
        warId: war.id,
        outcome,
        ...(detail.result ? { result: detail.result } : {}),
        ...(detail.reason ? { reason: detail.reason } : {}),
        transfers,
        ...(detail.tokens ? { tokens: detail.tokens } : {}),
        ...(detail.terms ? { terms: detail.terms } : {}),
      },
    },
    null,
    round,
  );

  const idx = ctx.datasets.get(scope.campaign.datasetVersion);
  const target = getTerritory(idx, war.targetId).name;
  const headline: Record<WarOutcome, [attacker: string, defender: string]> = {
    attacker: [`${target} taken`, `${target} lost`],
    defender: ['Your attack was repelled', `${target} held; the stake is yours`],
    held: [`${target} held`, `${target} held`],
    tribute: ['Tribute accepted', 'Tribute accepted'],
    settled: [`Peace over ${target}`, `Peace over ${target}`],
    withdrawn: ['War called off', 'War called off'],
    cancelled: ['War cancelled', 'War cancelled'],
  };
  const [forAttacker, forDefender] = headline[outcome];
  for (const [userId, title] of [
    [war.attackerId, forAttacker],
    [war.defenderId, forDefender],
  ] as const) {
    notify(ctx, scope, {
      userId,
      title,
      body: `The war for ${target} is over.`,
      url: warUrl(war),
      tag: `war:${war.id}`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Rounds and deadlines

/**
 * The host starts the next round: everyone's tokens refill, locks and truces count down, accords
 * whose time is up run their course, and turns to declare begin where the rules have them. After
 * the season's last round, the campaign ends instead (see `endSeason`).
 */
export async function nextRound(ctx: AppContext, campaignId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'start the next round');
    requireActive(scope);
    const last = lastRoundOf(scope.campaign.rules);
    if (last !== null && scope.campaign.round >= last) {
      await endSeason(ctx, scope);
      return;
    }
    const round = scope.campaign.round + 1;
    const roundStartedAt = ctx.now();
    await scope.tx.update(campaigns).set({ round, roundStartedAt }).where(eq(campaigns.id, campaignId));
    for (const m of scope.members) {
      const tokens = refillTokens(scope.campaign.rules, m.tokens);
      if (tokens === m.tokens) continue;
      await scope.tx
        .update(members)
        .set({ tokens })
        .where(and(eq(members.campaignId, campaignId), eq(members.userId, m.userId)));
      m.tokens = tokens;
    }
    scope.campaign = { ...scope.campaign, round, roundStartedAt };
    const order = roundTurnOrder(scope.campaign, scope.members);
    await scope.log.add({ type: 'round.started', payload: { round, ...(order ? { order } : {}) } }, userId, round);
    await startRoundForAccords(ctx, scope);
    await beginTurns(ctx, scope);
  });
}

/**
 * Answers declarations and counter-offers whose time ran out: a silent defender accepts the war as
 * declared; a silent attacker gets no war (a raise or redirect is withdrawn, a tribute accepted).
 */
export async function expireResponses(ctx: AppContext): Promise<void> {
  const due = await ctx.db
    .select({ id: wars.id, campaignId: wars.campaignId })
    .from(wars)
    .where(and(inArray(wars.status, ['declared', 'countered']), lte(wars.respondBy, ctx.now())));
  for (const { id, campaignId } of due) {
    try {
      await mutate(ctx, campaignId, async (scope) => {
        const war = await findWar(scope, id);
        if (!war.respondBy || war.respondBy > ctx.now()) return;
        if (war.status === 'declared') await applyResponse(ctx, scope, war, { response: 'accept' }, true);
        else if (war.status === 'countered' && war.counter) {
          const reply: WarReply = war.counter.kind === 'tribute' ? { reply: 'accept' } : { reply: 'withdraw' };
          await applyReply(ctx, scope, war, reply, true);
        }
      });
    } catch (err) {
      ctx.log.error({ err, warId: id }, 'could not expire a war response');
    }
  }
}
