import { displayNameSchema, passwordSchema, type MeResponse } from '@empire/rules';
import { and, asc, eq, gt, isNull, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { loginTokens, users } from '../db/schema';
import { HttpError, badRequest, notFound, tooManyRequests } from '../lib/errors';
import { parse, publicOrigin, sanitizeNext } from '../lib/http';
import { hashToken, newId, newToken, randomString } from '../lib/ids';
import { RateLimiter } from '../lib/rate-limit';
import { registerLichessRoutes } from './lichess';
import { hashPassword, verifyPassword } from './passwords';
import { SESSION_COOKIE, endOtherSessions, endSession, requireUser, startSession } from './session';

const LOGIN_LINK_MINUTES = 20;
const DEV_USER_PREFIX = 'dev_';
const HOUR = 60 * 60 * 1000;

const emailSchema = z.email('Enter a valid email address.').toLowerCase();
/** A password typed to sign in. Only new passwords are held to `passwordSchema`. */
const typedPasswordSchema = z.string().min(1, 'Enter your password.').max(1024, 'That password is too long.');

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, env, mailer } = ctx;
  const emailLimiter = new RateLimiter(3, 10 * 60 * 1000);
  const ipLimiter = new RateLimiter(20, HOUR);
  // Password guesses, per account and per address. Anyone locked out can still email themselves a
  // link, so these can be strict.
  const passwordLimiter = new RateLimiter(10, HOUR);
  const passwordIpLimiter = new RateLimiter(30, HOUR);

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
    await endSession(db, env, req, reply);
    return { ok: true };
  });

  // Email sign-in: a single-use link, confirmed by a POST from the web app so that link scanners
  // in mail clients can't burn it. The link is also how new players sign up and how a forgotten
  // password is replaced (`reset` only changes the email and what the page asks first).
  app.post('/api/auth/email', async (req) => {
    const { email, next, reset } = parse(
      z.object({ email: emailSchema, next: z.string().optional(), reset: z.boolean().optional() }),
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
    const params = new URLSearchParams({ token, next: sanitizeNext(next) });
    if (reset) params.set('reset', '1');
    const link = `${publicOrigin(env, req)}/login/verify?${params}`;
    const expiry = `It works once and expires in ${LOGIN_LINK_MINUTES} minutes.`;
    await mailer.send(
      reset
        ? {
            to: email,
            subject: 'Choose a new Geo Chess password',
            text: `Open this link to choose a new password for Geo Chess:\n\n${link}\n\n${expiry} If you didn't ask for it, ignore this email and your password stays as it is.`,
          }
        : {
            to: email,
            subject: 'Your Geo Chess sign-in link',
            text: `Open this link to sign in to Geo Chess:\n\n${link}\n\n${expiry} If you didn't ask for it, ignore this email.`,
          },
    );
    return { sent: mailer.delivers, devLink: mailer.delivers ? undefined : link };
  });

  // Uses up a link and signs in, creating the player on their first link. With `password`, it also
  // sets that player's password: the link proves they own the email, so no old password is needed.
  app.post('/api/auth/email/verify', async (req, reply) => {
    const { token, password } = parse(
      z.object({ token: z.string().min(10), password: passwordSchema.optional() }),
      req.body,
    );
    const expired = () => badRequest('This sign-in link has expired or was already used.', 'link-expired');
    const live = and(
      eq(loginTokens.tokenHash, hashToken(token)),
      isNull(loginTokens.usedAt),
      gt(loginTokens.expiresAt, new Date()),
    );
    // A new password is hashed, which is slow, only for a live link, and before the link is used
    // up, so a failure while hashing doesn't cost the player their link.
    if (password) {
      const [pending] = await db.select({ email: loginTokens.email }).from(loginTokens).where(live);
      if (!pending) throw expired();
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const [used] = await db
      .update(loginTokens)
      .set({ usedAt: new Date() })
      .where(live)
      .returning({ email: loginTokens.email });
    if (!used) throw expired();

    let [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, used.email));
    if (!user && req.user && !req.user.email) {
      // Signed in another way without an email yet (so without a password too): attach this one.
      await db.update(users).set({ email: used.email }).where(eq(users.id, req.user.id));
      user = { id: req.user.id, passwordHash: null };
    }
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ id: newId(), name: nameFromEmail(used.email), email: used.email })
        .returning({ id: users.id, passwordHash: users.passwordHash });
    }
    if (passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, user!.id));
      // This replaces a forgotten password, which may have been guessed or shared: every other
      // device signs in again.
      await endOtherSessions(db, user!.id);
    }
    await startSession(db, env, reply, user!.id);
    return { ok: true, hasPassword: passwordHash !== null || user!.passwordHash !== null };
  });

  // Email and a password, for players who have set one.
  app.post('/api/auth/password', async (req, reply) => {
    const { email, password } = parse(z.object({ email: emailSchema, password: typedPasswordSchema }), req.body);
    if (!passwordLimiter.take(email) || !passwordIpLimiter.take(req.ip)) {
      throw tooManyRequests('Too many sign-in attempts. Try again later, or email yourself a sign-in link.');
    }
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));
    if (!(await verifyPassword(password, user?.passwordHash ?? null))) {
      throw badRequest('Wrong email or password.', 'wrong-password');
    }
    await startSession(db, env, reply, user!.id);
    return { ok: true };
  });

  // Sets a password, or changes one given the current password; a forgotten one is replaced from
  // an emailed link instead. Changing it signs the player out on their other devices.
  app.put('/api/me/password', async (req) => {
    const user = requireUser(req);
    const { password, currentPassword } = parse(
      z.object({ password: passwordSchema, currentPassword: z.string().max(1024).optional() }),
      req.body,
    );
    if (!user.email) throw badRequest('Only accounts with an email can have a password.', 'no-email');
    const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    const current = row?.passwordHash ?? null;
    if (current) {
      if (!currentPassword) throw badRequest('Enter your current password.', 'wrong-password');
      if (!passwordLimiter.take(user.email)) throw tooManyRequests('Too many attempts. Try again later.');
      if (!(await verifyPassword(currentPassword, current))) {
        throw badRequest('Your current password is wrong.', 'wrong-password');
      }
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
    if (current) await endOtherSessions(db, user.id, req.cookies[SESSION_COOKIE]);
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
