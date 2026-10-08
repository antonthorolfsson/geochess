/**
 * Peace terms: either player at war may offer terms to end it until its game is over. Offers are
 * private to the two players (they log no events and push only to them); an accepted offer ends
 * the war as `settled`, and its resolution makes the terms public. A move in the war's game
 * passes over any offer made to the player moving, as moving does a draw offer (see `playMove`).
 */
import {
  PEACE_REJECTION_MESSAGES,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_TEXT,
  getTerritory,
  peaceIssue,
  peaceTermsText,
  peaceTransfers,
  type PeaceTerms,
  type ProposePeaceInput,
} from '@empire/rules';
import { and, eq, lte } from 'drizzle-orm';
import { mutate, requireActive, requireMember, userName, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { peaceOffers } from '../db/schema';
import { signAgreedAccord } from '../diplomacy/accords';
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from '../lib/errors';
import { newId } from '../lib/ids';
import { RateLimiter } from '../lib/rate-limit';
import { loadBoard, type PeaceOfferRow, type WarRow } from './board';
import { addTokens, findWar, resolveWar, startQueuedGames, stopWarGames, warUrl } from './service';

/** Offers one player may make in one war in the window, so offer-and-withdraw can't flood the other. */
const OFFERS_PER_WAR = 6;
const OFFER_WINDOW_MS = 60 * 60_000;
const offerLimiters = new WeakMap<AppContext, RateLimiter>();

function offerLimiter(ctx: AppContext): RateLimiter {
  let limiter = offerLimiters.get(ctx);
  if (!limiter) {
    limiter = new RateLimiter(OFFERS_PER_WAR, OFFER_WINDOW_MS, () => ctx.now().getTime());
    offerLimiters.set(ctx, limiter);
  }
  return limiter;
}

/** One tag per war, so each notice about its peace replaces the last on the device. */
const peaceTag = (warId: string) => `peace:${warId}`;

/** Each side's war tokens: whoever pays must have them. */
function tokensOf(scope: MutationScope, war: WarRow): { attacker: number; defender: number } {
  const tokens = (userId: string) => scope.members.find((m) => m.userId === userId)?.tokens ?? 0;
  return { attacker: tokens(war.attackerId), defender: tokens(war.defenderId) };
}

/** The terms in words, from `viewerId`'s side ("you"), for a notice. */
async function termsText(ctx: AppContext, scope: MutationScope, war: WarRow, terms: PeaceTerms, viewerId: string) {
  const idx = ctx.datasets.get(scope.campaign.datasetVersion);
  const name = async (userId: string) => (userId === viewerId ? 'you' : await userName(scope.tx, userId));
  return peaceTermsText(terms, {
    attacker: await name(war.attackerId),
    defender: await name(war.defenderId),
    country: (id) => getTerritory(idx, id).name,
  });
}

async function findOffer(scope: MutationScope, warId: string, offerId: string, userId: string): Promise<PeaceOfferRow> {
  const [offer] = await scope.tx
    .select()
    .from(peaceOffers)
    .where(
      and(eq(peaceOffers.id, offerId), eq(peaceOffers.warId, warId), eq(peaceOffers.campaignId, scope.campaign.id)),
    );
  // Offers are private: to anyone else, one doesn't exist.
  if (!offer || (offer.proposerId !== userId && offer.recipientId !== userId)) throw notFound('Offer not found.');
  return offer;
}

/** Ends an offer that came to nothing. Only the two players hear about it. */
async function closeOffer(
  ctx: AppContext,
  scope: MutationScope,
  offer: PeaceOfferRow,
  status: 'declined' | 'withdrawn' | 'lapsed',
): Promise<void> {
  await scope.tx
    .update(peaceOffers)
    .set({ status, respondBy: null, endedAt: ctx.now() })
    .where(eq(peaceOffers.id, offer.id));
  scope.notifyOnly([offer.proposerId, offer.recipientId]);
}

/** A player at war offers terms to end it. A new offer replaces their last one still open. */
export async function proposePeace(
  ctx: AppContext,
  campaignId: string,
  warId: string,
  userId: string,
  input: ProposePeaceInput,
): Promise<{ id: string }> {
  return mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    requireActive(scope);
    const war = await findWar(scope, warId);
    if (war.attackerId !== userId && war.defenderId !== userId) {
      throw forbidden('Only the two players at war can offer peace.');
    }
    if (war.status === 'resolved') throw conflict('This war is already over.', 'war-over');
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const active = board.wars.find((w) => w.id === war.id)!;
    const terms = input.terms;
    const issue = peaceIssue(board, active, terms, tokensOf(scope, war));
    if (issue) {
      const message = PEACE_REJECTION_MESSAGES[issue];
      throw issue === 'off' ? conflict(message, issue) : badRequest(message, issue);
    }
    if (!offerLimiter(ctx).take(`${war.id}\n${userId}`)) {
      throw tooManyRequests('You have offered terms in this war several times in the last hour. Try again later.');
    }

    const now = ctx.now();
    const recipientId = war.attackerId === userId ? war.defenderId : war.attackerId;
    await scope.tx
      .update(peaceOffers)
      .set({ status: 'withdrawn', respondBy: null, endedAt: now })
      .where(
        and(eq(peaceOffers.warId, war.id), eq(peaceOffers.proposerId, userId), eq(peaceOffers.status, 'proposed')),
      );
    const pace = scope.campaign.rules.war.pace;
    const [offer] = await scope.tx
      .insert(peaceOffers)
      .values({
        id: newId(),
        campaignId,
        warId: war.id,
        proposerId: userId,
        recipientId,
        terms,
        status: 'proposed',
        createdAt: now,
        respondBy: new Date(now.getTime() + RESPONSE_WINDOW_MS[pace]),
      })
      .returning();
    scope.notifyOnly([war.attackerId, war.defenderId]);

    const target = getTerritory(ctx.datasets.get(scope.campaign.datasetVersion), war.targetId).name;
    const playing = war.status === 'playing';
    scope.notify({
      userId: recipientId,
      title: `${await userName(scope.tx, userId)} offers peace over ${target}`,
      body:
        `${await termsText(ctx, scope, war, terms, recipientId)}. Answer within ${RESPONSE_WINDOW_TEXT[pace]}` +
        (playing ? ', and before your next move' : '') +
        ', or the offer lapses.',
      url: warUrl(war),
      tag: peaceTag(war.id),
      email: true,
    });
    return { id: offer!.id };
  });
}

/**
 * The player offered terms accepts or declines. Accepting ends the war on them at once: the game
 * stops (its moves stand), the terms change hands, and an accord comes into force if they name one.
 */
export async function answerPeace(
  ctx: AppContext,
  campaignId: string,
  warId: string,
  offerId: string,
  userId: string,
  answer: 'accept' | 'decline',
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const offer = await findOffer(scope, warId, offerId, userId);
    if (offer.recipientId !== userId) throw forbidden('Only the player it was offered to can answer.');
    if (offer.status !== 'proposed') throw conflict('This offer is no longer open.', 'already-answered');
    const recipient = await userName(scope.tx, userId);
    const war = await findWar(scope, warId);

    if (answer === 'decline') {
      await closeOffer(ctx, scope, offer, 'declined');
      scope.notify({
        userId: offer.proposerId,
        title: `${recipient} turned down your terms`,
        body: 'The war goes on.',
        url: warUrl(war),
        tag: peaceTag(war.id),
      });
      return;
    }

    requireActive(scope);
    if (war.status === 'resolved') throw conflict('This war is already over.', 'war-over');
    const board = await loadBoard(ctx, scope.tx, scope.campaign);
    const active = board.wars.find((w) => w.id === war.id)!;
    const terms = offer.terms;
    const issue = peaceIssue(board, active, terms, tokensOf(scope, war));
    if (issue) throw conflict(`These terms can no longer be met. ${PEACE_REJECTION_MESSAGES[issue]}`, issue);

    // The game stops first (so a move being saved lands before, and a game just ended keeps its
    // result), then the offer: a move in the meantime passes over it.
    await stopWarGames(ctx, scope, war.id);
    const [accepted] = await scope.tx
      .update(peaceOffers)
      .set({ status: 'accepted', respondBy: null, endedAt: ctx.now() })
      .where(and(eq(peaceOffers.id, offer.id), eq(peaceOffers.status, 'proposed')))
      .returning({ id: peaceOffers.id });
    if (!accepted) throw conflict('This offer is no longer open.', 'already-answered');

    if (terms.tokensToAttacker > 0) {
      await addTokens(scope, war.defenderId, -terms.tokensToAttacker);
      await addTokens(scope, war.attackerId, terms.tokensToAttacker);
    }
    if (terms.tokensToDefender > 0) {
      await addTokens(scope, war.attackerId, -terms.tokensToDefender);
      await addTokens(scope, war.defenderId, terms.tokensToDefender);
    }
    await resolveWar(ctx, scope, war, 'settled', { transfers: peaceTransfers(war, terms), terms });
    if (terms.accordRounds) {
      const target = getTerritory(ctx.datasets.get(scope.campaign.datasetVersion), war.targetId).name;
      await signAgreedAccord(ctx, scope, {
        proposerId: offer.proposerId,
        recipientId: offer.recipientId,
        rounds: terms.accordRounds,
        terms: `Signed with the peace that ended the war for ${target}.`,
      });
    }
    // Stopping a live game frees both players for any game waiting on them.
    await startQueuedGames(ctx, scope);
  });
}

/** The proposer takes back an offer not yet answered. */
export async function withdrawPeace(
  ctx: AppContext,
  campaignId: string,
  warId: string,
  offerId: string,
  userId: string,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, userId);
    const offer = await findOffer(scope, warId, offerId, userId);
    if (offer.proposerId !== userId) throw forbidden('Only the player who made the offer can withdraw it.');
    if (offer.status !== 'proposed') throw conflict('This offer is no longer open.', 'already-answered');
    await closeOffer(ctx, scope, offer, 'withdrawn');
  });
}

/** Offers nobody answered in time lapse. */
export async function lapsePeaceOffers(ctx: AppContext, upTo: Date = ctx.now()): Promise<void> {
  const due = await ctx.db
    .select({ id: peaceOffers.id, warId: peaceOffers.warId, campaignId: peaceOffers.campaignId })
    .from(peaceOffers)
    .where(and(eq(peaceOffers.status, 'proposed'), lte(peaceOffers.respondBy, upTo)));
  for (const { id, warId, campaignId } of due) {
    try {
      await mutate(
        ctx,
        campaignId,
        async (scope) => {
          const [offer] = await scope.tx.select().from(peaceOffers).where(eq(peaceOffers.id, id));
          if (!offer || offer.status !== 'proposed' || !offer.respondBy || offer.respondBy > upTo) {
            scope.notifyOnly([]);
            return;
          }
          await closeOffer(ctx, scope, offer, 'lapsed');
        },
        { upTo },
      );
    } catch (err) {
      ctx.log.error({ err, offerId: id, warId }, 'could not lapse a peace offer');
    }
  }
}
