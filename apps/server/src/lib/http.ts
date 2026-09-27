import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Env } from '../env';
import { badRequest } from './errors';

/** Validates untrusted input, turning the first problem into a 400 with a readable message. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${field}${issue?.message ?? 'Invalid request.'}`, 'invalid');
  }
  return result.data;
}

/**
 * Origin of the web app as the player sees it. The web app proxies /api here, so the forwarded
 * host is the one that matters (Fastify's trustProxy applies X-Forwarded-*).
 */
export function publicOrigin(env: Env, req: FastifyRequest): string {
  if (env.PUBLIC_URL) return new URL(env.PUBLIC_URL).origin;
  return `${req.protocol}://${req.host}`;
}

/**
 * Whether a browser's Origin header is the web app's configured public origin. In production the
 * web app and this server have different hosts (geochess.xyz and api.geochess.xyz).
 */
export function isPublicOrigin(env: Env, origin: string): boolean {
  return env.PUBLIC_URL !== undefined && origin === new URL(env.PUBLIC_URL).origin;
}

/** Only same-site relative paths may be used as post-sign-in destinations. */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
