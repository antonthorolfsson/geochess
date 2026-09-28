import type { SessionUser } from '@empire/rules';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import type { Env } from '../env';
import { unauthorized } from '../lib/errors';
import { hashToken, newToken } from '../lib/ids';

export const SESSION_COOKIE = 'ec_session';
const SESSION_DAYS = 90;

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in player, loaded from the session cookie on every request. */
    user: SessionUser | null;
  }
}

export async function startSession(db: Db, env: Env, reply: FastifyReply, userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    ...cookieScope(env),
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    expires: expiresAt,
  });
}

export async function endSession(db: Db, env: Env, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  reply.clearCookie(SESSION_COOKIE, cookieScope(env));
}

/** Signs a player out on every device, except the one whose session cookie holds `keep`. */
export async function endOtherSessions(db: Db, userId: string, keep?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), keep ? ne(sessions.tokenHash, hashToken(keep)) : undefined));
}

/** Where the session cookie applies. Clearing it must name the same path and domain. */
function cookieScope(env: Env): { path: string; domain?: string } {
  return { path: '/', domain: env.COOKIE_DOMAIN };
}

export async function loadSessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      lichessUsername: users.lichessUsername,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const { expiresAt: _, ...user } = row;
  return user;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
