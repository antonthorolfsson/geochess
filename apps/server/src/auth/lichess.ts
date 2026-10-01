import { createHash } from 'node:crypto';
import { parseLichessPerfs } from '@empire/rules';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { users } from '../db/schema';
import { newId, newToken } from '../lib/ids';
import { publicOrigin, sanitizeNext } from '../lib/http';
import { startSession } from './session';

const STATE_COOKIE = 'ec_oauth';
const COOKIE_PATH = '/api/auth/lichess';

const pendingSchema = z.object({ verifier: z.string(), state: z.string(), next: z.string() });

/**
 * "Sign in with Lichess": OAuth 2 authorization code flow with PKCE. Lichess accepts public
 * clients without registration, so no client secret is needed. We only read the account
 * identity and ratings (for handicaps) and revoke the token straight away.
 */
export function registerLichessRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, env } = ctx;
  const redirectUri = (req: Parameters<typeof publicOrigin>[1]) =>
    `${publicOrigin(env, req)}/api/auth/lichess/callback`;

  app.get('/api/auth/lichess', async (req, reply) => {
    const next = sanitizeNext((req.query as { next?: unknown }).next);
    const verifier = newToken();
    const state = newToken();
    reply.setCookie(STATE_COOKIE, JSON.stringify({ verifier, state, next }), {
      path: COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      secure: env.secureCookies,
      maxAge: 10 * 60,
    });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.LICHESS_CLIENT_ID,
      redirect_uri: redirectUri(req),
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      state,
    });
    return reply.redirect(`${env.LICHESS_HOST}/oauth?${params}`);
  });

  app.get('/api/auth/lichess/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const pending = pendingSchema.safeParse(safeJson(req.cookies[STATE_COOKIE]));
    reply.clearCookie(STATE_COOKIE, { path: COOKIE_PATH });
    if (!pending.success || !query.code || query.state !== pending.data.state) {
      return reply.redirect('/login?error=lichess');
    }

    try {
      const tokenRes = await fetch(`${env.LICHESS_HOST}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          code_verifier: pending.data.verifier,
          redirect_uri: redirectUri(req),
          client_id: env.LICHESS_CLIENT_ID,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
      const auth = { Authorization: `Bearer ${accessToken}` };

      const accountRes = await fetch(`${env.LICHESS_HOST}/api/account`, { headers: auth });
      if (!accountRes.ok) throw new Error(`account lookup failed: ${accountRes.status}`);
      const account = (await accountRes.json()) as { id: string; username: string; perfs?: unknown };
      void fetch(`${env.LICHESS_HOST}/api/token`, { method: 'DELETE', headers: auth }).catch(() => {});

      const userId = await upsertLichessUser(ctx, account, req.user?.id ?? null);
      await startSession(db, env, reply, userId);
      return reply.redirect(pending.data.next);
    } catch (err) {
      req.log.warn({ err }, 'Lichess sign-in failed');
      return reply.redirect('/login?error=lichess');
    }
  });
}

async function upsertLichessUser(
  ctx: AppContext,
  account: { id: string; username: string; perfs?: unknown },
  currentUserId: string | null,
): Promise<string> {
  const lichess = {
    lichessUsername: account.username,
    lichessRatings: parseLichessPerfs(account.perfs),
    lichessRatingsAt: ctx.now(),
  };
  const { db } = ctx;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.lichessId, account.id));
  if (existing) {
    await db.update(users).set(lichess).where(eq(users.id, existing.id));
    return existing.id;
  }
  if (currentUserId) {
    // Already signed in (e.g. by email): link the Lichess account to this player.
    await db
      .update(users)
      .set({ lichessId: account.id, ...lichess })
      .where(eq(users.id, currentUserId));
    return currentUserId;
  }
  const [created] = await db
    .insert(users)
    .values({ id: newId(), name: account.username, lichessId: account.id, ...lichess })
    .returning({ id: users.id });
  return created!.id;
}

function safeJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
