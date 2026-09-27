import {
  INITIAL_FEN,
  RESPONSE_WINDOW_MS,
  STAKE_REJECTION_MESSAGES,
  TARGET_REJECTION_MESSAGES,
  afterGame,
  attackerColor,
  canRaise,
  checkStake,
  checkTarget,
  clockModifiers,
  getTerritory,
  initialClocks,
  raiseFloor,
  redirectOptions,
  refillTokens,
  tributeOptions,
  turnDeadline,
  valueOf,
  warTimeControl,
  warTransfers,
  winnerOf,
  type DeclareWarInput,
  type GameEndReason,
  type GameResult,
  type Transfer,
  type WarCounter,
  type WarOutcome,
  type WarReply,
  type WarResponse,
} from '@empire/rules';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { mutate, requireActive, requireHost, requireMember, userName, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns, games, holdings, members, wars } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Notice } from '../notifications/notifier';
import { loadBoard, type WarRow } from './board';
import { armFlag } from './games';

/** Live games open with a countdown, so both players can get to the board. */
export const LIVE_COUNTDOWN_MS = 15_000;

const warUrl = (war: WarRow) => `/c/${war.campaignId}?war=${war.id}`;
const gameUrl = (campaignId: string, gameId: string) => `/c/${campaignId}?game=${gameId}`;

function notify(ctx: AppContext, scope: MutationScope, notice: Notice): void {
  scope.afterCommit(() => ctx.notifier.send(notice));
}

function windowText(scope: MutationScope): string {
  return scope.campaign.rules.war.pace === 'live' ? '5 minutes' : '24 hours';
}

function responseDeadline(ctx: AppContext, scope: MutationScope): Date {
  return new Date(ctx.now().getTime() + RESPONSE_WINDOW_MS[scope.campaign.rules.war.pace]);
}

async function addTokens(scope: MutationScope, userId: string, delta: number): Promise<void> {
  await scope.tx
    .update(members)
    .set({ tokens: sql`${members.tokens} + ${delta}` })
    .where(and(eq(members.campaignId, scope.campaign.id), eq(members.userId, userId)));
  const member = scope.members.find((m) => m.userId === userId);
  if (member) member.tokens += delta;
}

async function findWar(scope: MutationScope, warId: string): Promise<WarRow> {
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
    if (me.tokens < 1) throw conflict('You have no war tokens. The next round brings one.', 'no-tokens');
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const targetRejection = checkTarget(board, userId, input.targetId);
    if (targetRejection) throw conflict(TARGET_REJECTION_MESSAGES[targetRejection], targetRejection);
    const stakeRejection = checkStake(board, userId, input.targetId, input.launchId, input.stake);
    if (stakeRejection) throw badRequest(STAKE_REJECTION_MESSAGES[stakeRejection], stakeRejection);

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
        status: 'declared',
        declaredRound: scope.campaign.round,
        respondBy: responseDeadline(ctx, scope),
        declaredAt: ctx.now(),
      })
      .returning();
    await addTokens(scope, userId, -1);
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
        `${valueOf(board.idx, stake)}. Answer within ${windowText(scope)} or the war goes ahead as declared.`,
      url: warUrl(war!),
      tag: `war:${war!.id}`,
      email: true,
    });
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
  let counter: WarCounter | null = null;
  switch (input.response) {
    case 'accept':
      break;
    case 'raise':
      if (!canRaise(board, active))
        throw conflict('The stake already meets what a raise would demand.', 'cannot-raise');
      counter = { kind: 'raise', minValue: raiseFloor(board.rules, target.value) };
      break;
    case 'redirect':
      if (!redirectOptions(board, active).includes(input.targetId)) {
        throw badRequest(
          'Redirect to another of your countries worth the same, bordering the attacker and not caught up in a war.',
          'bad-redirect',
        );
      }
      counter = { kind: 'redirect', targetId: input.targetId };
      break;
    case 'tribute': {
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
  const defender = await userName(scope.tx, war.defenderId);
  const title = {
    raise: `${defender} raised the stakes`,
    redirect: `${defender} redirects your attack`,
    tribute: `${defender} offers tribute`,
  }[counter.kind];
  notify(ctx, scope, {
    userId: war.attackerId,
    title,
    body: `Your war on ${target.name} needs an answer within ${windowText(scope)}.`,
    url: warUrl(countered),
    tag: `war:${war.id}`,
    email: true,
  });
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
    { type: 'war.reply', payload: { warId: war.id, reply: input.reply, ...(stake ? { stake } : {}), auto } },
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
  const next =
    counter.kind === 'raise'
      ? await updateWar(scope, war, { stake })
      : await updateWar(scope, war, { targetId: counter.targetId, redirectedFrom: war.targetId });
  await beginFighting(ctx, scope, next);
}

// ---------------------------------------------------------------------------------------------
// Fighting

/** Players in a game that's underway in this campaign; each plays one live game at a time. */
async function busyPlayers(scope: MutationScope): Promise<Set<string>> {
  const rows = await scope.tx
    .select({ whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(and(eq(games.campaignId, scope.campaign.id), eq(games.status, 'playing')));
  return new Set(rows.flatMap((r) => [r.whiteId, r.blackId]));
}

/**
 * Sets up the war's game (or its Armageddon tiebreak). Live games wait until neither player is in
 * another game; correspondence games start at once.
 */
async function beginFighting(ctx: AppContext, scope: MutationScope, war: WarRow, armageddon = false): Promise<void> {
  const board = await loadBoard(ctx, scope.tx, scope.campaign);
  const tc = warTimeControl(scope.campaign.rules, clockModifiers(board, war.attackerId, war.targetId), armageddon);
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
    })
    .returning();
  const busy = tc.kind === 'live' ? await busyPlayers(scope) : new Set<string>();
  if (busy.has(whiteId) || busy.has(blackId)) {
    await updateWar(scope, war, { status: 'ready', respondBy: null });
    return;
  }
  await startGame(ctx, scope, game!.id);
}

async function startGame(ctx: AppContext, scope: MutationScope, gameId: string): Promise<void> {
  const [waiting] = await scope.tx.select().from(games).where(eq(games.id, gameId));
  const game = waiting!;
  const now = ctx.now().getTime();
  const startsAt = game.timeControl.kind === 'live' ? now + LIVE_COUNTDOWN_MS : now;
  const [started] = await scope.tx
    .update(games)
    .set({
      status: 'playing',
      startsAt: new Date(startsAt),
      lastMoveAt: new Date(startsAt),
      deadline: new Date(turnDeadline(game.timeControl, game.clocks, 'white', startsAt)),
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
  scope.afterCommit(() => armFlag(ctx, started!));

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
        `You play ${color} against ${await userName(scope.tx, opponentId)}.` +
        (live ? ' The clocks start in 15 seconds.' : color === 'White' ? ' Your move.' : ''),
      url: gameUrl(war!.campaignId, gameId),
      tag: `game:${gameId}`,
      email: !live && color === 'White',
    });
  }
}

/** Starts queued live games, oldest first, whose players are both free. */
async function startQueuedGames(ctx: AppContext, scope: MutationScope): Promise<void> {
  const queued = await scope.tx
    .select({ id: games.id, whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(and(eq(games.campaignId, scope.campaign.id), eq(games.status, 'waiting')))
    .orderBy(asc(games.createdAt));
  if (queued.length === 0) return;
  const busy = await busyPlayers(scope);
  for (const game of queued) {
    if (busy.has(game.whiteId) || busy.has(game.blackId)) continue;
    await startGame(ctx, scope, game.id);
    busy.add(game.whiteId).add(game.blackId);
  }
}

/**
 * A game has finished: resolve its war, or (on a first-game draw with the Armageddon rule) set up
 * the tiebreak. Safe to call more than once.
 */
export async function settleGame(ctx: AppContext, campaignId: string, gameId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
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
    if (next === 'armageddon') await beginFighting(ctx, scope, war, true);
    else await resolveWar(ctx, scope, war, next, { result: game.result, reason: game.reason ?? undefined });
    await startQueuedGames(ctx, scope);
  });
}

// ---------------------------------------------------------------------------------------------
// Resolution

async function resolveWar(
  ctx: AppContext,
  scope: MutationScope,
  war: WarRow,
  outcome: WarOutcome,
  detail: { result?: GameResult; reason?: GameEndReason; transfers?: Transfer[]; tokens?: number } = {},
): Promise<void> {
  const round = scope.campaign.round;
  const transfers = detail.transfers ?? warTransfers(war, outcome);
  for (const t of transfers) {
    await scope.tx
      .update(holdings)
      .set({ ownerId: t.to, acquiredRound: round })
      .where(and(eq(holdings.campaignId, war.campaignId), eq(holdings.territoryId, t.territoryId)));
  }
  await updateWar(scope, war, {
    status: 'resolved',
    outcome,
    resolvedRound: round,
    resolvedAt: ctx.now(),
    respondBy: null,
  });
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
    withdrawn: ['War called off', 'War called off'],
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

/** The host starts the next round: everyone's tokens refill, and locks and truces count down. */
export async function nextRound(ctx: AppContext, campaignId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'start the next round');
    requireActive(scope);
    const round = scope.campaign.round + 1;
    await scope.tx.update(campaigns).set({ round }).where(eq(campaigns.id, campaignId));
    for (const m of scope.members) {
      const tokens = refillTokens(scope.campaign.rules, m.tokens);
      if (tokens === m.tokens) continue;
      await scope.tx
        .update(members)
        .set({ tokens })
        .where(and(eq(members.campaignId, campaignId), eq(members.userId, m.userId)));
    }
    scope.campaign = { ...scope.campaign, round };
    await scope.log.add({ type: 'round.started', payload: { round } }, userId, round);
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
