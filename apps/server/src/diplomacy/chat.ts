import {
  conversationKey,
  type ChatSummary,
  type FeedFilter,
  type FeedItem,
  type FeedPage,
  type MessageView,
  type MessagesPage,
  type SendMessageInput,
} from '@empire/rules';
import { and, count, desc, eq, inArray, isNull, like, lt, max, ne, or, sql, type SQL } from 'drizzle-orm';
import { userName } from '../campaigns/mutate';
import { toEventView } from '../campaigns/views';
import type { AppContext } from '../context';
import { campaigns, chatReads, events, members, messages } from '../db/schema';
import { isBotId } from '../bots/ids';
import { badRequest, forbidden, notFound, tooManyRequests } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { toMessageView, type MessageRow } from './views';

/** Items per page of the feed or a conversation. */
export const PAGE_SIZE = 60;
/** At most this many messages per player in the window, to stop floods. */
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10_000;
/** One push per private conversation in this window; later messages wait for the player to look. */
const PUSH_COOLDOWN_MS = 60_000;
/** Longest preview of a private message in a notification. */
const PREVIEW_CHARS = 140;

const CHANNEL = conversationKey('', null);

/** Which dispatches each feed filter shows. `chat` shows none. */
function eventFilter(filter: FeedFilter): SQL | undefined {
  if (filter === 'wars') {
    return or(
      like(events.type, 'war.%'),
      eq(events.type, 'round.started'),
      eq(events.type, 'country.fortified'),
      eq(events.type, 'turn.passed'),
      eq(events.type, 'turns.ended'),
    );
  }
  if (filter === 'accords') return or(like(events.type, 'accord.%'), like(events.type, 'reputation.%'));
  return undefined;
}

/** A feed cursor: the ids to page below for dispatches and messages. Empty means no bound; 0 means none left. */
interface Cursor {
  event: number | null;
  message: number | null;
}

function parseCursor(before: string | undefined): Cursor {
  if (!before) return { event: null, message: null };
  const [event, message] = before.split('.').map((part) => (part === '' ? null : Number(part)));
  return { event: event ?? null, message: message ?? null };
}

const formatCursor = (c: Cursor) => `${c.event ?? ''}.${c.message ?? ''}`;

/**
 * Chat: the campaign channel and private conversations between two players. Messages don't change
 * the campaign, so they skip the campaign lock and go straight to the players who can read them.
 */
export class ChatService {
  private readonly sent: RateLimiter;
  private readonly pushed = new Map<string, number>();
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.sent = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS, () => ctx.now().getTime());
  }

  private async memberIds(campaignId: string): Promise<string[]> {
    const rows = await this.ctx.db
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.campaignId, campaignId));
    return rows.map((r) => r.userId);
  }

  private async requireMember(campaignId: string, userId: string): Promise<string[]> {
    const ids = await this.memberIds(campaignId);
    if (!ids.includes(userId)) throw notFound('Campaign not found.');
    return ids;
  }

  /** Who hears about a message: every member for the channel, the two players for a private one. */
  private audience(row: MessageRow, memberIds: string[]): string[] {
    return row.recipientId === null ? memberIds : [row.authorId, row.recipientId];
  }

  async send(campaignId: string, userId: string, input: SendMessageInput): Promise<MessageView> {
    const memberIds = await this.requireMember(campaignId, userId);
    const to = input.to ?? null;
    if (to !== null && (to === userId || !memberIds.includes(to))) {
      throw badRequest('Send private messages to another player in this campaign.', 'bad-recipient');
    }
    // Nothing reads a bot's messages (and a bot's user goes when the host removes it).
    if (to !== null && isBotId(to)) throw badRequest('Bots don’t read messages.', 'bot-recipient');
    if (!this.sent.take(userId)) throw tooManyRequests('You are sending messages too quickly. Wait a moment.');
    const [row] = await this.ctx.db
      .insert(messages)
      .values({
        campaignId,
        conversation: conversationKey(userId, to),
        authorId: userId,
        recipientId: to,
        body: input.body,
      })
      .returning();
    const view = toMessageView(row!);
    this.ctx.hub.send(this.audience(row!, memberIds), { type: 'chat.message', campaignId, message: view });
    if (to !== null) this.notifyPrivate(campaignId, row!);
    return view;
  }

  /** Pushes a private message to its recipient, at most once a minute per conversation. */
  private notifyPrivate(campaignId: string, row: MessageRow): void {
    const recipientId = row.recipientId!;
    const key = `${campaignId}\n${recipientId}\n${row.authorId}`;
    const now = this.ctx.now().getTime();
    if (now - (this.pushed.get(key) ?? -Infinity) < PUSH_COOLDOWN_MS) return;
    this.pushed.set(key, now);
    const body = row.body.length > PREVIEW_CHARS ? `${row.body.slice(0, PREVIEW_CHARS - 1)}…` : row.body;
    void userName(this.ctx.db, row.authorId)
      .then((author) =>
        this.ctx.notifier.send({
          userId: recipientId,
          title: `Message from ${author}`,
          body,
          url: `/c/${campaignId}?chat=${row.authorId}`,
          tag: `chat:${campaignId}:${row.authorId}`,
        }),
      )
      .catch((err: unknown) => this.ctx.log.error({ err }, 'could not send a message notification'));
  }

  /** Authors can delete their own messages; the host can remove any message in the channel. */
  async remove(campaignId: string, messageId: number, userId: string): Promise<MessageView> {
    const memberIds = await this.requireMember(campaignId, userId);
    const [row] = await this.ctx.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.campaignId, campaignId)));
    if (!row || !this.audience(row, memberIds).includes(userId)) throw notFound('Message not found.');
    if (row.removedAt) return toMessageView(row);
    if (row.authorId !== userId) {
      const [campaign] = await this.ctx.db
        .select({ hostId: campaigns.hostId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      if (row.recipientId !== null || campaign?.hostId !== userId) {
        throw forbidden('Only its author or the host can remove a message.');
      }
    }
    const [updated] = await this.ctx.db
      .update(messages)
      .set({ body: '', removedAt: this.ctx.now(), removedBy: userId })
      .where(eq(messages.id, row.id))
      .returning();
    const view = toMessageView(updated!);
    this.ctx.hub.send(this.audience(row, memberIds), { type: 'chat.message', campaignId, message: view });
    return view;
  }

  /** Dispatches and channel messages merged into one timeline, newest first. */
  async feed(campaignId: string, userId: string, filter: FeedFilter, before?: string): Promise<FeedPage> {
    await this.requireMember(campaignId, userId);
    const cursor = parseCursor(before);
    const eventRows =
      filter !== 'chat' && cursor.event !== 0
        ? await this.ctx.db
            .select()
            .from(events)
            .where(
              and(
                eq(events.campaignId, campaignId),
                cursor.event !== null ? lt(events.id, cursor.event) : undefined,
                eventFilter(filter),
              ),
            )
            .orderBy(desc(events.id))
            .limit(PAGE_SIZE)
        : [];
    const messageRows =
      (filter === 'all' || filter === 'chat') && cursor.message !== 0
        ? await this.ctx.db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.campaignId, campaignId),
                eq(messages.conversation, CHANNEL),
                cursor.message !== null ? lt(messages.id, cursor.message) : undefined,
              ),
            )
            .orderBy(desc(messages.id))
            .limit(PAGE_SIZE)
        : [];

    // Merge the two newest-first lists, keeping each in its own order so the cursors never skip a
    // row. At the same instant a message comes after the dispatch it answers.
    const items: FeedItem[] = [];
    const next: Cursor = { ...cursor };
    let e = 0;
    let m = 0;
    while (items.length < PAGE_SIZE && (e < eventRows.length || m < messageRows.length)) {
      const event = eventRows[e];
      const message = messageRows[m];
      if (event && (!message || event.createdAt > message.createdAt)) {
        items.push({ kind: 'event', event: toEventView(event) });
        next.event = event.id;
        e++;
      } else {
        items.push({ kind: 'message', message: toMessageView(message!) });
        next.message = message!.id;
        m++;
      }
    }
    // A source that came back empty has nothing older.
    if (filter !== 'chat' && eventRows.length === 0) next.event = 0;
    if ((filter === 'all' || filter === 'chat') && messageRows.length === 0) next.message = 0;
    const more =
      e < eventRows.length ||
      m < messageRows.length ||
      eventRows.length === PAGE_SIZE ||
      messageRows.length === PAGE_SIZE;
    return { items, next: more ? formatCursor(next) : null };
  }

  /** A private conversation between the viewer and another player, newest first. */
  async conversation(campaignId: string, userId: string, peerId: string, before?: number): Promise<MessagesPage> {
    await this.requireMember(campaignId, userId);
    const rows = await this.ctx.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.campaignId, campaignId),
          eq(messages.conversation, conversationKey(userId, peerId)),
          before !== undefined ? lt(messages.id, before) : undefined,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    return { messages: page.map(toMessageView), next: rows.length > PAGE_SIZE ? page.at(-1)!.id : null };
  }

  /** Unread counts for the channel and each private conversation, with each conversation's last message. */
  async summary(campaignId: string, userId: string): Promise<ChatSummary> {
    await this.requireMember(campaignId, userId);
    // Only current members count: nobody can open a conversation with a player who left.
    const unread = await this.ctx.db
      .select({ conversation: messages.conversation, n: count() })
      .from(messages)
      .innerJoin(members, and(eq(members.campaignId, messages.campaignId), eq(members.userId, messages.authorId)))
      .leftJoin(
        chatReads,
        and(
          eq(chatReads.campaignId, messages.campaignId),
          eq(chatReads.userId, userId),
          eq(chatReads.conversation, messages.conversation),
        ),
      )
      .where(
        and(
          eq(messages.campaignId, campaignId),
          or(eq(messages.recipientId, userId), and(eq(messages.conversation, CHANNEL), ne(messages.authorId, userId))),
          isNull(messages.removedAt),
          sql`${messages.id} > coalesce(${chatReads.lastReadId}, 0)`,
        ),
      )
      .groupBy(messages.conversation);
    const unreadIn = new Map(unread.map((r) => [r.conversation, r.n]));
    const latest = await this.ctx.db
      .selectDistinctOn([messages.conversation])
      .from(messages)
      .where(
        and(
          eq(messages.campaignId, campaignId),
          or(eq(messages.authorId, userId), eq(messages.recipientId, userId)),
          ne(messages.conversation, CHANNEL),
        ),
      )
      .orderBy(messages.conversation, desc(messages.id));
    return {
      channelUnread: unreadIn.get(CHANNEL) ?? 0,
      conversations: latest
        .map((row) => ({
          userId: row.authorId === userId ? row.recipientId! : row.authorId,
          unread: unreadIn.get(row.conversation) ?? 0,
          last: toMessageView(row),
        }))
        .sort((a, b) => b.last.id - a.last.id),
    };
  }

  /** Records how far the viewer has read a conversation, and tells their other devices. */
  async markRead(campaignId: string, userId: string, peerId: string | null, lastId: number): Promise<void> {
    await this.requireMember(campaignId, userId);
    const conversation = conversationKey(userId, peerId);
    // Never past the newest message, so later messages still count as unread.
    const [newest] = await this.ctx.db
      .select({ id: max(messages.id) })
      .from(messages)
      .where(and(eq(messages.campaignId, campaignId), eq(messages.conversation, conversation)));
    const readTo = Math.min(lastId, newest?.id ?? 0);
    if (readTo <= 0) return;
    await this.ctx.db
      .insert(chatReads)
      .values({ campaignId, userId, conversation, lastReadId: readTo })
      .onConflictDoUpdate({
        target: [chatReads.campaignId, chatReads.userId, chatReads.conversation],
        set: { lastReadId: sql`greatest(${chatReads.lastReadId}, excluded.last_read_id)` },
      });
    this.ctx.hub.send([userId], { type: 'chat.read', campaignId });
  }
}

/** Per campaign, the private messages the player hasn't read. */
export async function unreadPrivateMessages(
  ctx: AppContext,
  userId: string,
  campaignIds: string[],
): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ campaignId: messages.campaignId, n: count() })
    .from(messages)
    // From current members only, like the unread counts in the Diplo tab.
    .innerJoin(members, and(eq(members.campaignId, messages.campaignId), eq(members.userId, messages.authorId)))
    .leftJoin(
      chatReads,
      and(
        eq(chatReads.campaignId, messages.campaignId),
        eq(chatReads.userId, userId),
        eq(chatReads.conversation, messages.conversation),
      ),
    )
    .where(
      and(
        inArray(messages.campaignId, campaignIds),
        eq(messages.recipientId, userId),
        isNull(messages.removedAt),
        sql`${messages.id} > coalesce(${chatReads.lastReadId}, 0)`,
      ),
    )
    .groupBy(messages.campaignId);
  return new Map(rows.map((r) => [r.campaignId, r.n]));
}
