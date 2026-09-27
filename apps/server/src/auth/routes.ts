import { displayNameSchema, type MeResponse } from '@empire/rules';
import { and, asc, eq, gt, isNull, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { loginTokens, users } from '../db/schema';
import { HttpError, badRequest, notFound } from '../lib/errors';
import { parse, publicOrigin, sanitizeNext } from '../lib/http';
import { hashToken, newId, newToken, randomString } from '../lib/ids';
import { RateLimiter } from '../lib/rate-limit';
import { registerLichessRoutes } from './lichess';
import { endSession, requireUser, startSession } from './session';

const LOGIN_LINK_MINUTES = 20;
const DEV_USER_PREFIX = 'dev_';

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, env, mailer } = ctx;
  const emailLimiter = new RateLimiter(3, 10 * 60 * 1000);
  const ipLimiter = new RateLimiter(20, 60 * 60 * 1000);

  app.get('/api/me', async (req): Promise<MeResponse> => ({
    user: req.user,
    auth: { devLogin: env.devLogin, email: mailer.delivers || env.devLogin, lichess: true },
  }));

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const { name } = parse(z.object({ name: displayNameSchema }), req.body);
    await db.update(users).set({ name }).where(eq(users.id, user.id));
    return { user: { ...user, name } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });

  // Email sign-in: a single-use link, confirmed by a POST from the web app so that link scanners
  // in mail clients can't burn it.
  app.post('/api/auth/email', async (req) => {
    const { email, next } = parse(
      z.object({ email: z.email('Enter a valid email address.').toLowerCase(), next: z.string().optional() }),
      req.body,
    );
    if (!mailer.delivers && !env.devLogin) throw new HttpError(503, 'Email sign-in is not set up on this server.');
    if (!emailLimiter.take(email) || !ipLimiter.take(req.ip)) {
      throw new HttpError(429, 'Too many sign-in emails. Try again in a few minutes.');
    }
    const token = newToken();
    await db.insert(loginTokens).values({
      tokenHash: hashToken(token),
      email,
      expiresAt: new Date(Date.now() + LOGIN_LINK_MINUTES * 60 * 1000),
    });
    const link = `${publicOrigin(env, req)}/login/verify?${new URLSearchParams({ token, next: sanitizeNext(next) })}`;
    await mailer.send({
      to: email,
      subject: 'Your Empire Chess sign-in link',
      text: `Open this link to sign in to Empire Chess:\n\n${link}\n\nIt works once and expires in ${LOGIN_LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    });
    return { sent: mailer.delivers, devLink: mailer.delivers ? undefined : link };
  });

  app.post('/api/auth/email/verify', async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const [used] = await db
      .update(loginTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(loginTokens.tokenHash, hashToken(token)),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, new Date()),
        ),
      )
      .returning({ email: loginTokens.email });
    if (!used) throw badRequest('This sign-in link has expired or was already used.', 'link-expired');

    let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, used.email));
    if (!user && req.user && !req.user.email) {
      // Signed in another way without an email yet: attach this one.
      await db.update(users).set({ email: used.email }).where(eq(users.id, req.user.id));
      user = { id: req.user.id };
    }
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ id: newId(), name: nameFromEmail(used.email), email: used.email })
        .returning({ id: users.id });
    }
    await startSession(db, env, reply, user!.id);
    return { ok: true };
  });

  // Password-free sign-in by name for local development and testing.
  app.get('/api/auth/dev', async () => {
    if (!env.devLogin) throw notFound();
    const devUsers = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(like(users.id, `${DEV_USER_PREFIX}%`))
      .orderBy(asc(users.name));
    return { users: devUsers };
  });

  app.post('/api/auth/dev', async (req, reply) => {
    if (!env.devLogin) throw notFound();
    const { name } = parse(z.object({ name: displayNameSchema }), req.body);
    const id = DEV_USER_PREFIX + slug(name);
    await db.insert(users).values({ id, name }).onConflictDoUpdate({ target: users.id, set: { name } });
    await startSession(db, env, reply, id);
    return { ok: true };
  });

  registerLichessRoutes(app, ctx);
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const name = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 32);
  return name.length >= 2 ? name : 'Player';
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || randomString(6)
  );
}
