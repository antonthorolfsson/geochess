import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import type { Mailer } from '../auth/mailer';
import type { Db } from '../db/client';
import { pushSubscriptions, users } from '../db/schema';
import type { Env } from '../env';

/** An intel report for one player: a push notification, or an email for things that need an answer. */
export interface Notice {
  userId: string;
  title: string;
  body: string;
  /** The app path it opens, e.g. `/c/<campaign>?war=<war>`. */
  url: string;
  /** A later notice with the same tag replaces this one on the device. */
  tag?: string;
  /**
   * Worth an email when push can't reach the player: correspondence events that need an answer.
   * Emails with the same tag go out at most once per `EMAIL_TAG_COOLDOWN_MS`.
   */
  email?: boolean;
}

export interface Notifier {
  send(notice: Notice): Promise<void>;
}

/** One email per tag in this window, so a busy correspondence game doesn't flood an inbox. */
export const EMAIL_TAG_COOLDOWN_MS = 6 * 60 * 60_000;
/** How long a push service keeps trying to deliver. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends notices by web push to every browser the player allowed, and by email when push reached
 * none of them and the notice asks for it. Push is off unless VAPID keys are configured.
 */
export function createNotifier(deps: { db: Db; env: Env; mailer: Mailer; log: FastifyBaseLogger }): Notifier {
  const { db, env, mailer, log } = deps;
  const vapidDetails =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : null;
  const lastEmail = new Map<string, number>();
  const origin = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : 'http://localhost:3000';

  async function push(notice: Notice): Promise<boolean> {
    if (!vapidDetails) return false;
    const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, notice.userId));
    const payload = JSON.stringify({ title: notice.title, body: notice.body, url: notice.url, tag: notice.tag });
    let delivered = false;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails,
            TTL: PUSH_TTL_SECONDS,
            urgency: 'high',
            ...(notice.tag ? { topic: notice.tag.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) } : {}),
          },
        );
        delivered = true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped the subscription.
          await db
            .delete(pushSubscriptions)
            .where(and(eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions.userId, notice.userId)));
        } else {
          log.warn({ err, status }, 'web push failed');
        }
      }
    }
    return delivered;
  }

  async function email(notice: Notice): Promise<void> {
    const key = `${notice.userId}\n${notice.tag ?? notice.url}`;
    const now = Date.now();
    if (now - (lastEmail.get(key) ?? -Infinity) < EMAIL_TAG_COOLDOWN_MS) return;
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, notice.userId));
    if (!user?.email) return;
    lastEmail.set(key, now);
    await mailer.send({
      to: user.email,
      subject: `${notice.title} · Empire Chess`,
      text: `${notice.body}\n\n${origin}${notice.url}\n`,
    });
  }

  return {
    async send(notice) {
      const pushed = await push(notice);
      if (notice.email && !pushed) await email(notice);
    },
  };
}
