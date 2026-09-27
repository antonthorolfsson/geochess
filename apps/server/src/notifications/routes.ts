import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { pushSubscriptions } from '../db/schema';
import { parse } from '../lib/http';

/**
 * Push services browsers use. The server posts to whatever endpoint a browser registers, so only
 * these hosts are accepted, which keeps it from being pointed at anything else.
 */
const PUSH_HOSTS = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}, 'That is not a known push service.');

const subscribeInput = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The key browsers need to subscribe, or null when push isn't set up on this server. */
  app.get('/api/push/key', async () => ({ publicKey: ctx.env.VAPID_PUBLIC_KEY ?? null }));

  app.post('/api/push/subscribe', async (req) => {
    const user = requireUser(req);
    const { endpoint: url, keys } = parse(subscribeInput, req.body);
    await ctx.db
      .insert(pushSubscriptions)
      .values({ endpoint: url, userId: user.id, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
      });
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const user = requireUser(req);
    const { endpoint: url } = parse(z.object({ endpoint: z.string().max(2000) }), req.body);
    await ctx.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, url), eq(pushSubscriptions.userId, user.id)));
    return { ok: true };
  });
}
