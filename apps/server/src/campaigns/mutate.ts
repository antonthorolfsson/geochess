import { parseRules, type CampaignEvent, type EventView, type ServerMessage } from '@empire/rules';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { campaigns, events, members, users } from '../db/schema';
import { conflict, forbidden, notFound } from '../lib/errors';
import type { Notice } from '../notifications/notifier';
import { settleVictory } from '../victory/settle';
import { toEventView } from './views';

export type CampaignRow = typeof campaigns.$inferSelect;
export type MemberRow = typeof members.$inferSelect;

/** Events written inside a transaction, published to players once it commits. */
export class EventLog {
  readonly events: EventView[] = [];
  private readonly tx: Tx;
  private readonly campaignId: string;

  constructor(tx: Tx, campaignId: string) {
    this.tx = tx;
    this.campaignId = campaignId;
  }

  async add(event: CampaignEvent, actorId: string | null, round: number): Promise<void> {
    const [row] = await this.tx
      .insert(events)
      .values({ campaignId: this.campaignId, round, type: event.type, actorId, payload: event.payload })
      .returning();
    this.events.push(toEventView(row!));
  }
}

export interface MutationScope {
  tx: Tx;
  /** The campaign row, locked for the transaction, with its rules normalized. */
  campaign: CampaignRow;
  members: MemberRow[];
  log: EventLog;
  /** Runs `fn` once the change has committed (e.g. arming a timer); failures are only logged. */
  afterCommit(fn: () => unknown): void;
  /**
   * Sends a notification once the change has committed. If the same change ends the campaign, only
   * the notices marked `ending` go out: the others would announce what the ending called off.
   */
  notify(notice: Notice, opts?: { ending?: boolean }): void;
  /** Marks the change private: unless events are logged, only these players hear about it. */
  notifyOnly(userIds: readonly string[]): void;
}

interface Queued {
  after: (() => unknown)[];
  notices: { notice: Notice; ending: boolean }[];
}

/**
 * Runs a state change on one campaign: serialized per campaign, inside a transaction holding the
 * campaign row lock. Victory missions are then brought up to date in the same transaction (see
 * `settleVictory`), so every change that could complete, break or score a mission is checked in
 * one place. Afterwards every member (before or after the change) hears about it, unless
 * `notifyOnly` limits that to the players concerned by a private change that logged no events.
 */
export async function mutate<T>(
  ctx: AppContext,
  campaignId: string,
  fn: (scope: MutationScope) => Promise<T>,
  { notifyOnly }: { notifyOnly?: string | readonly string[] } = {},
): Promise<T> {
  return ctx.locks.run(campaignId, async () => {
    const recipients = new Set<string>();
    const queued: Queued = { after: [], notices: [] };
    let logged: EventView[] = [];
    let ended = false;
    let only = typeof notifyOnly === 'string' ? [notifyOnly] : notifyOnly;
    const result = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for('update');
      if (!row) throw notFound('Campaign not found.');
      const campaign = { ...row, rules: parseRules(row.rules) };
      const before = await tx.select().from(members).where(eq(members.campaignId, campaignId));
      const log = new EventLog(tx, campaignId);
      const scope: MutationScope = {
        tx,
        campaign,
        members: before,
        log,
        afterCommit: (f) => queued.after.push(f),
        notify: (notice, { ending = false } = {}) => void queued.notices.push({ notice, ending }),
        notifyOnly: (userIds) => void (only = userIds),
      };
      const value = await fn(scope);
      await settleSafely(ctx, scope, queued);
      ended = campaign.status !== 'finished' && scope.campaign.status === 'finished';
      const current = await tx
        .select({ userId: members.userId })
        .from(members)
        .where(eq(members.campaignId, campaignId));
      for (const m of [...before, ...current]) recipients.add(m.userId);
      logged = log.events;
      return value;
    });
    const message: ServerMessage =
      logged.length > 0
        ? { type: 'campaign.events', campaignId, events: logged }
        : { type: 'campaign.changed', campaignId };
    ctx.hub.send(only && logged.length === 0 ? only : recipients, message);
    const sends = queued.notices.filter((n) => n.ending || !ended).map((n) => () => ctx.notifier.send(n.notice));
    for (const f of [...queued.after, ...sends]) {
      void Promise.resolve()
        .then(f)
        .catch((err: unknown) => ctx.log.error({ err }, 'after-commit task failed'));
    }
    return result;
  });
}

/**
 * Brings the victory missions up to date inside a savepoint. Should that fail, the change itself
 * still goes through and the failure is logged, so a fault in mission scoring can't stop a
 * campaign's wars, games and rounds; the next change tries again.
 */
async function settleSafely(ctx: AppContext, scope: MutationScope, queued: Queued): Promise<void> {
  const mark = {
    campaign: scope.campaign,
    events: scope.log.events.length,
    after: queued.after.length,
    notices: queued.notices.length,
  };
  try {
    // A nested transaction is a savepoint on the same connection, so `scope.tx` works inside it.
    await scope.tx.transaction(() => settleVictory(ctx, scope));
  } catch (err) {
    scope.campaign = mark.campaign;
    scope.log.events.length = mark.events;
    queued.after.length = mark.after;
    queued.notices.length = mark.notices;
    ctx.log.error({ err, campaignId: scope.campaign.id }, 'could not bring the victory missions up to date');
  }
}

export function requireMember(scope: MutationScope, userId: string): MemberRow {
  const member = scope.members.find((m) => m.userId === userId);
  if (!member) throw notFound('Campaign not found.');
  return member;
}

export function requireHost(scope: MutationScope, userId: string, action: string): void {
  requireMember(scope, userId);
  if (scope.campaign.hostId !== userId) throw forbidden(`Only the host can ${action}.`);
}

export function requireLobby(scope: MutationScope, message = 'The campaign has already started.'): void {
  if (scope.campaign.status !== 'lobby') throw conflict(message, 'not-in-lobby');
}

export function requireActive(scope: MutationScope): void {
  if (scope.campaign.status !== 'active') throw conflict('The campaign is not underway.', 'not-active');
}

export async function userName(tx: Tx | Db, userId: string): Promise<string> {
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? 'Unknown';
}
