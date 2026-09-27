import {
  PROPOSAL_REJECTION_MESSAGES,
  REPUTATION_BROKEN,
  REPUTATION_KEPT,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_TEXT,
  accordEndsRound,
  checkProposal,
  cleanText,
  diplomacyOpen,
  isPartyTo,
  partnerIn,
  type CampaignEvent,
  type ProposeAccordInput,
} from '@empire/rules';
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { mutate, requireMember, userName, type CampaignRow, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { accords, members } from '../db/schema';
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from '../lib/errors';
import { newId } from '../lib/ids';
import { RateLimiter } from '../lib/rate-limit';
import type { Notice } from '../notifications/notifier';
import type { AccordRow } from './views';

/** Ended accords (kept, broken or renewed) included in a campaign view, most recent first. */
const RECENT_ACCORDS = 30;
/** The viewer's own proposals that came to nothing, included so they can see how they were answered. */
const RECENT_PROPOSALS = 10;

/** Proposals one player may make to another in the window, so propose-and-withdraw can't flood them. */
const PROPOSALS_PER_PAIR = 4;
const PROPOSAL_WINDOW_MS = 60 * 60_000;
const proposalLimiters = new WeakMap<AppContext, RateLimiter>();

function proposalLimiter(ctx: AppContext): RateLimiter {
  let limiter = proposalLimiters.get(ctx);
  if (!limiter) {
    limiter = new RateLimiter(PROPOSALS_PER_PAIR, PROPOSAL_WINDOW_MS, () => ctx.now().getTime());
    proposalLimiters.set(ctx, limiter);
  }
  return limiter;
}

const accordUrl = (campaignId: string, accordId: string) => `/c/${campaignId}?accord=${accordId}`;
/**
 * One tag per pair of players, from the recipient's side: each notice replaces the last on the
 * device, and the email cooldown covers every proposal between them.
 */
const accordTag = (campaignId: string, otherId: string) => `accord:${campaignId}:${otherId}`;

function notify(ctx: AppContext, scope: MutationScope, notice: Notice): void {
  scope.afterCommit(() => ctx.notifier.send(notice));
}

async function findAccord(scope: MutationScope, accordId: string): Promise<AccordRow> {
  const [accord] = await scope.tx
    .select()
    .from(accords)
    .where(and(eq(accords.id, accordId), eq(accords.campaignId, scope.campaign.id)));
  if (!accord) throw notFound('Accord not found.');
  return accord;
}

/** The accord in force between two players, if any. */
async function accordInForce(scope: MutationScope, a: string, b: string): Promise<AccordRow | undefined> {
  const [accord] = await scope.tx
    .select()
    .from(accords)
    .where(
      and(
        eq(accords.campaignId, scope.campaign.id),
        eq(accords.status, 'active'),
        or(
          and(eq(accords.proposerId, a), eq(accords.recipientId, b)),
          and(eq(accords.proposerId, b), eq(accords.recipientId, a)),
        ),
      ),
    );
  return accord;
}

/** Accords the war rules look at: those in force, and those renounced this round (the breaker must wait). */
export async function warAccords(db: Tx | Db, campaign: CampaignRow): Promise<AccordRow[]> {
  return db
    .select()
    .from(accords)
    .where(
      and(
        eq(accords.campaignId, campaign.id),
        or(eq(accords.status, 'active'), and(eq(accords.status, 'broken'), gte(accords.endedRound, campaign.round))),
      ),
    );
}

/**
 * What a member may see: accords in force and recently ended (public), and their own proposals,
 * waiting or recently turned down (private to the two players).
 */
export async function visibleAccords(db: Tx | Db, campaignId: string, viewerId: string): Promise<AccordRow[]> {
  const inCampaign = eq(accords.campaignId, campaignId);
  const mine = or(eq(accords.proposerId, viewerId), eq(accords.recipientId, viewerId));
  const active = await db
    .select()
    .from(accords)
    .where(and(inCampaign, eq(accords.status, 'active')))
    .orderBy(desc(accords.signedAt));
  const ended = await db
    .select()
    .from(accords)
    .where(and(inCampaign, inArray(accords.status, ['kept', 'broken', 'renewed'])))
    .orderBy(desc(accords.endedAt))
    .limit(RECENT_ACCORDS);
  const pending = await db
    .select()
    .from(accords)
    .where(and(inCampaign, eq(accords.status, 'proposed'), mine))
    .orderBy(desc(accords.proposedAt));
  const closed = await db
    .select()
    .from(accords)
    .where(and(inCampaign, inArray(accords.status, ['declined', 'withdrawn', 'lapsed']), mine))
    .orderBy(desc(accords.endedAt))
    .limit(RECENT_PROPOSALS);
  return [...pending, ...active, ...ended, ...closed];
}

async function changeReputation(
  scope: MutationScope,
  userId: string,
  delta: number,
  reason: Extract<CampaignEvent, { type: 'reputation.changed' }>['payload']['reason'],
  accordId: string,
): Promise<void> {
  const [row] = await scope.tx
    .update(members)
    .set({ reputation: sql`${members.reputation} + ${delta}` })
    .where(and(eq(members.campaignId, scope.campaign.id), eq(members.userId, userId)))
    .returning({ reputation: members.reputation });
  if (!row) return;
  await scope.log.add(
    { type: 'reputation.changed', payload: { userId, delta, reputation: row.reputation, reason, accordId } },
    null,
    scope.campaign.round,
  );
}

/** Ends a proposal that came to nothing. Only the two players hear about it. */
async function closeProposal(
  ctx: AppContext,
  scope: MutationScope,
  accord: AccordRow,
  status: 'declined' | 'withdrawn' | 'lapsed',
): Promise<void> {
  await scope.tx
    .update(accords)
    .set({ status, respondBy: null, endedRound: scope.campaign.round, endedAt: ctx.now() })
    .where(eq(accords.id, accord.id));
  scope.notifyOnly([accord.proposerId, accord.recipientId]);
}

// ---------------------------------------------------------------------------------------------
// Proposing and answering

export async function proposeAccord(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  input: ProposeAccordInput,
): Promise<{ id: string }> {
  return mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const terms = cleanText(input.terms);
    const pending = await scope.tx
      .select({ proposerId: accords.proposerId, recipientId: accords.recipientId, status: accords.status })
      .from(accords)
      .where(and(eq(accords.campaignId, campaignId), eq(accords.status, 'proposed')));
    const campaign = {
      status: scope.campaign.status,
      memberIds: scope.members.map((m) => m.userId),
      accords: pending,
    };
    const rejection = checkProposal(campaign, userId, input.partnerId, input.rounds, terms);
    if (rejection) {
      const message = PROPOSAL_REJECTION_MESSAGES[rejection];
      throw rejection === 'closed' || rejection === 'pending'
        ? conflict(message, rejection)
        : badRequest(message, rejection);
    }
    if (!proposalLimiter(ctx).take(`${campaignId}\n${userId}\n${input.partnerId}`)) {
      throw tooManyRequests('You have proposed to this player several times in the last hour. Try again later.');
    }

    const now = ctx.now();
    const pace = scope.campaign.rules.war.pace;
    const [accord] = await scope.tx
      .insert(accords)
      .values({
        id: newId(),
        campaignId,
        proposerId: userId,
        recipientId: input.partnerId,
        status: 'proposed',
        rounds: input.rounds,
        terms,
        proposedRound: scope.campaign.round,
        proposedAt: now,
        respondBy: new Date(now.getTime() + RESPONSE_WINDOW_MS[pace]),
      })
      .returning();
    scope.notifyOnly([userId, input.partnerId]);

    const renewal = await accordInForce(scope, userId, input.partnerId);
    const rounds = `${input.rounds} ${input.rounds === 1 ? 'round' : 'rounds'}`;
    notify(ctx, scope, {
      userId: input.partnerId,
      title: `${await userName(scope.tx, userId)} proposes ${renewal ? 'renewing your accord' : 'an accord'}`,
      body:
        `No war between you for ${rounds}${terms ? `, on these terms: “${terms}”` : ''}. ` +
        `Answer within ${RESPONSE_WINDOW_TEXT[pace]} or the proposal lapses.`,
      url: accordUrl(campaignId, accord!.id),
      tag: accordTag(campaignId, userId),
      email: true,
    });
    return { id: accord!.id };
  });
}

/** The recipient signs or declines a proposal. Signing makes the accord public. */
export async function answerAccord(
  ctx: AppContext,
  campaignId: string,
  accordId: string,
  userId: string,
  answer: 'accept' | 'decline',
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const accord = await findAccord(scope, accordId);
    if (!isPartyTo(accord, userId)) throw notFound('Accord not found.');
    if (accord.recipientId !== userId) throw forbidden('Only the player it was proposed to can answer.');
    if (accord.status !== 'proposed') throw conflict('This proposal has already been answered.', 'already-answered');
    const recipient = await userName(scope.tx, userId);

    if (answer === 'decline') {
      await closeProposal(ctx, scope, accord, 'declined');
      notify(ctx, scope, {
        userId: accord.proposerId,
        title: `${recipient} declined your accord`,
        body: 'Your proposal was turned down.',
        url: accordUrl(campaignId, accord.id),
        tag: accordTag(campaignId, userId),
      });
      return;
    }

    if (!diplomacyOpen(scope.campaign.status)) throw conflict(PROPOSAL_REJECTION_MESSAGES.closed, 'closed');
    const round = scope.campaign.round;
    const now = ctx.now();
    const renewed = await accordInForce(scope, accord.proposerId, accord.recipientId);
    if (renewed) {
      await scope.tx
        .update(accords)
        .set({ status: 'renewed', endedRound: round, endedAt: now })
        .where(eq(accords.id, renewed.id));
    }
    const endsRound = accordEndsRound(round, accord.rounds);
    await scope.tx
      .update(accords)
      .set({
        status: 'active',
        respondBy: null,
        signedRound: round,
        signedAt: now,
        endsRound,
        renews: renewed?.id ?? null,
      })
      .where(eq(accords.id, accord.id));
    await scope.log.add(
      {
        type: 'accord.signed',
        payload: {
          accordId: accord.id,
          proposerId: accord.proposerId,
          recipientId: accord.recipientId,
          rounds: accord.rounds,
          endsRound,
          terms: accord.terms,
          renews: renewed?.id ?? null,
        },
      },
      userId,
      round,
    );
    notify(ctx, scope, {
      userId: accord.proposerId,
      title: `${recipient} signed your accord`,
      body: `No war between you until round ${endsRound} starts.`,
      url: accordUrl(campaignId, accord.id),
      tag: accordTag(campaignId, userId),
    });
  });
}

/** The proposer takes back a proposal that hasn't been answered. */
export async function withdrawAccord(
  ctx: AppContext,
  campaignId: string,
  accordId: string,
  userId: string,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const accord = await findAccord(scope, accordId);
    if (!isPartyTo(accord, userId)) throw notFound('Accord not found.');
    if (accord.proposerId !== userId) throw forbidden('Only the player who proposed it can withdraw it.');
    if (accord.status !== 'proposed') throw conflict('This proposal has already been answered.', 'already-answered');
    await closeProposal(ctx, scope, accord, 'withdrawn');
  });
}

/**
 * A partner breaks an accord in force. It ends at once and everyone hears of it; the breaker
 * loses reputation and can't declare war on the former partner until the next round starts.
 */
export async function renounceAccord(
  ctx: AppContext,
  campaignId: string,
  accordId: string,
  userId: string,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const accord = await findAccord(scope, accordId);
    if (!isPartyTo(accord, userId)) {
      // Proposals are private: a third player can't tell one exists.
      throw accord.status === 'active'
        ? forbidden('Only its partners can renounce an accord.')
        : notFound('Accord not found.');
    }
    if (accord.status !== 'active') throw conflict('This accord is no longer in force.', 'not-in-force');
    const round = scope.campaign.round;
    const partnerId = partnerIn(accord, userId);
    await scope.tx
      .update(accords)
      .set({ status: 'broken', brokenBy: userId, endedRound: round, endedAt: ctx.now() })
      .where(eq(accords.id, accord.id));
    await scope.log.add(
      { type: 'accord.broken', payload: { accordId: accord.id, breakerId: userId, partnerId } },
      userId,
      round,
    );
    await changeReputation(scope, userId, REPUTATION_BROKEN, 'accord-broken', accord.id);
    const breaker = await userName(scope.tx, userId);
    notify(ctx, scope, {
      userId: partnerId,
      title: `${breaker} broke your accord`,
      body: `${breaker} renounced your accord and can't declare war on you until round ${round + 1} starts.`,
      url: accordUrl(campaignId, accord.id),
      tag: accordTag(campaignId, userId),
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Rounds and deadlines

/**
 * When a round starts, accords whose last round has passed run their course: both partners gain
 * reputation. Runs inside the host's "Next round" change, after the round has moved on.
 */
export async function keepFinishedAccords(ctx: AppContext, scope: MutationScope): Promise<void> {
  const round = scope.campaign.round;
  const due = await scope.tx
    .select()
    .from(accords)
    .where(and(eq(accords.campaignId, scope.campaign.id), eq(accords.status, 'active'), lte(accords.endsRound, round)))
    .orderBy(accords.signedAt);
  for (const accord of due) {
    await scope.tx
      .update(accords)
      .set({ status: 'kept', endedRound: round, endedAt: ctx.now() })
      .where(eq(accords.id, accord.id));
    const players: [string, string] = [accord.proposerId, accord.recipientId];
    await scope.log.add({ type: 'accord.kept', payload: { accordId: accord.id, players } }, null, round);
    for (const userId of players) {
      await changeReputation(scope, userId, REPUTATION_KEPT, 'accord-kept', accord.id);
      const partnerId = partnerIn(accord, userId);
      const partner = await userName(scope.tx, partnerId);
      notify(ctx, scope, {
        userId,
        title: `Your accord with ${partner} has run its course`,
        body: `Your reputation rises by ${REPUTATION_KEPT}. You may declare war on each other again.`,
        url: accordUrl(scope.campaign.id, accord.id),
        tag: accordTag(scope.campaign.id, partnerId),
      });
    }
  }
}

/** Proposals nobody answered in time lapse. */
export async function lapseProposals(ctx: AppContext): Promise<void> {
  const due = await ctx.db
    .select({ id: accords.id, campaignId: accords.campaignId })
    .from(accords)
    .where(and(eq(accords.status, 'proposed'), lte(accords.respondBy, ctx.now())));
  for (const { id, campaignId } of due) {
    try {
      await mutate(ctx, campaignId, async (scope) => {
        const accord = await findAccord(scope, id);
        if (accord.status !== 'proposed' || !accord.respondBy || accord.respondBy > ctx.now()) {
          scope.notifyOnly([]);
          return;
        }
        await closeProposal(ctx, scope, accord, 'lapsed');
      });
    } catch (err) {
      ctx.log.error({ err, accordId: id }, 'could not lapse an accord proposal');
    }
  }
}
