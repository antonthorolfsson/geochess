/**
 * Declaring in turns, where the campaign's rules have it (`rules.war.turns`): each round, players
 * declare war or fortify one at a time, round the table, until everyone has passed. The rules are
 * in `@empire/rules` (`turns.ts`); this keeps the round's state on the campaign row.
 */
import {
  TURN_REJECTION_MESSAGES,
  TURN_WINDOW_MS,
  TURN_WINDOW_TEXT,
  canTakeTurn,
  checkTurn,
  nextTurn,
  turnOrder,
  type PassTurnInput,
  type TurnState,
} from '@empire/rules';
import { and, eq, lte } from 'drizzle-orm';
import {
  mutate,
  requireActive,
  requireMember,
  userName,
  type CampaignRow,
  type MemberRow,
  type MutationScope,
} from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns, members } from '../db/schema';
import { conflict, forbidden } from '../lib/errors';
import { loadBoard } from './board';
import { busyPlayers, startQueuedGames } from './service';

/** The round's turns, or null when nobody takes turns this round. */
export function turnState(campaign: CampaignRow): TurnState | null {
  return campaign.turnOrder
    ? { order: campaign.turnOrder, passed: campaign.turnPassed, current: campaign.turnUserId }
    : null;
}

/** Whether players are still taking turns to declare this round. */
export const declaring = (campaign: CampaignRow) => campaign.turnOrder !== null && campaign.turnUserId !== null;

/**
 * The order of turns in `round` (by default the campaign's), or null when the campaign doesn't
 * declare in turns. Seats are the draft order.
 */
export function roundTurnOrder(campaign: CampaignRow, players: readonly MemberRow[], round = campaign.round) {
  if (!campaign.rules.war.turns) return null;
  const ids = new Set(players.map((m) => m.userId));
  const seats = campaign.draftOrder?.length
    ? campaign.draftOrder
    : [...players].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).map((m) => m.userId);
  return turnOrder(
    seats.filter((id) => ids.has(id)),
    round,
  );
}

async function saveTurns(scope: MutationScope, set: Partial<CampaignRow>): Promise<void> {
  await scope.tx.update(campaigns).set(set).where(eq(campaigns.id, scope.campaign.id));
  scope.campaign = { ...scope.campaign, ...set };
}

/**
 * A round has started (its tokens given, its accords settled): turns start from the top of the
 * order. Nothing happens in campaigns where anyone declares whenever they like.
 */
export async function beginTurns(ctx: AppContext, scope: MutationScope): Promise<void> {
  const order = roundTurnOrder(scope.campaign, scope.members);
  if (!order) return;
  await saveTurns(scope, { turnOrder: order, turnPassed: [], turnUserId: null, turnDeadline: null });
  await giveNextTurn(ctx, scope, null);
}

/** Refuses a declaration or fortification out of turn. */
export async function requireTurn(scope: MutationScope, userId: string): Promise<void> {
  const state = turnState(scope.campaign);
  const rejection = checkTurn(state, userId);
  if (!rejection) return;
  if (rejection === 'not-your-turn' && state?.current) {
    const name = await userName(scope.tx, state.current);
    throw conflict(`It's ${name}'s turn to declare. Yours comes round.`, rejection);
  }
  throw conflict(TURN_REJECTION_MESSAGES[rejection], rejection);
}

/** A player declared war or fortified on their turn: the turn moves on. */
export async function turnTaken(ctx: AppContext, scope: MutationScope, userId: string): Promise<void> {
  if (turnState(scope.campaign)?.current !== userId) return;
  await giveNextTurn(ctx, scope, userId);
}

/**
 * The turn goes to the next player with something to do; a player in a live game goes after
 * everyone else. With nobody left, declaring is over for the round (which claims held by turns wait
 * for), and live games held back for it begin.
 */
async function giveNextTurn(ctx: AppContext, scope: MutationScope, after: string | null): Promise<void> {
  const state = turnState(scope.campaign)!;
  const board = await loadBoard(ctx, scope.tx, scope.campaign);
  const rows = await scope.tx
    .select({ userId: members.userId, tokens: members.tokens })
    .from(members)
    .where(eq(members.campaignId, scope.campaign.id));
  const tokens = new Map(rows.map((r) => [r.userId, r.tokens]));
  const { pace } = scope.campaign.rules.war;
  const busy = pace === 'live' ? await busyPlayers(scope) : new Set<string>();
  const current = nextTurn(
    state,
    after,
    (id) => canTakeTurn(board, id, tokens.get(id) ?? 0),
    (id) => busy.has(id),
  );
  const deadline = current ? new Date(ctx.now().getTime() + TURN_WINDOW_MS[pace]) : null;
  await saveTurns(scope, {
    turnUserId: current,
    turnDeadline: deadline,
    ...(current ? {} : { turnsEndedRound: scope.campaign.round }),
  });
  if (!current) {
    await scope.log.add({ type: 'turns.ended', payload: { round: scope.campaign.round } }, null, scope.campaign.round);
    await startQueuedGames(ctx, scope);
    return;
  }
  // Whoever just took a turn is looking at it already.
  if (current === after) return;
  const { fortify } = scope.campaign.rules.war;
  scope.notify({
    userId: current,
    title: 'Your turn to declare war',
    body: `Declare war${fortify ? ', fortify a country' : ''} or pass, within ${TURN_WINDOW_TEXT[pace]}.`,
    url: `/c/${scope.campaign.id}`,
    tag: `turn:${scope.campaign.id}`,
    email: pace === 'correspondence',
  });
}

/** `userId` is done declaring for the round: by choice, the host's, or because their time ran out. */
async function recordPass(
  ctx: AppContext,
  scope: MutationScope,
  userId: string,
  actorId: string | null,
  auto: boolean,
): Promise<void> {
  const passed = [...scope.campaign.turnPassed.filter((id) => id !== userId), userId];
  await saveTurns(scope, { turnPassed: passed });
  await scope.log.add({ type: 'turn.passed', payload: { userId, auto } }, actorId, scope.campaign.round);
  await giveNextTurn(ctx, scope, userId);
}

/**
 * A player passes their turn, which ends their declaring for the round. The host can pass the turn
 * for whoever holds it (someone away from the table); naming them keeps a pass from landing on
 * the next player if the turn has just moved on.
 */
export async function passTurn(
  ctx: AppContext,
  campaignId: string,
  actorId: string,
  input: PassTurnInput,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, actorId);
    requireActive(scope);
    const state = turnState(scope.campaign);
    if (!state) throw conflict('Players declare whenever they like in this campaign: there are no turns.', 'no-turns');
    if (!state.current) throw conflict(TURN_REJECTION_MESSAGES['turns-over'], 'turns-over');
    if (input.userId !== state.current) {
      throw conflict(input.userId === actorId ? "It's not your turn." : 'The turn has moved on.', 'not-your-turn');
    }
    if (actorId !== state.current && actorId !== scope.campaign.hostId) {
      throw forbidden("Only the host can pass another player's turn.");
    }
    await recordPass(ctx, scope, state.current, actorId, false);
  });
}

/** Turns whose time ran out pass on their own. */
export async function expireTurns(ctx: AppContext): Promise<void> {
  const due = await ctx.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'active'), lte(campaigns.turnDeadline, ctx.now())));
  for (const { id } of due) {
    try {
      await mutate(ctx, id, async (scope) => {
        const { turnUserId, turnDeadline } = scope.campaign;
        if (scope.campaign.status !== 'active' || !turnUserId || !turnDeadline || turnDeadline > ctx.now()) return;
        await recordPass(ctx, scope, turnUserId, null, true);
      });
    } catch (err) {
      ctx.log.error({ err, campaignId: id }, 'could not pass a turn whose time ran out');
    }
  }
}
