import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  /** Postgres connection string. When unset, an embedded PGlite database is stored in DATA_DIR. */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('.data/pglite'),
  /**
   * Public origin of the web app, used in emailed links and OAuth redirects, and trusted for
   * writes and sockets when it differs from this server's host. When unset, the origin of the
   * incoming request is used, which suits local development on any host.
   */
  PUBLIC_URL: z.url().optional(),
  /**
   * Domain for the session cookie when this server has its own subdomain (the web app at
   * geochess.xyz, the server at api.geochess.xyz), so sockets opened to it are signed in too.
   * When unset, the cookie belongs to the host that set it.
   */
  COOKIE_DOMAIN: z.string().optional(),
  /** SMTP connection string for sign-in emails. When unset, links are logged to the console. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Geo Chess <no-reply@localhost>'),
  /** Password-free sign-in by name, for local testing. Defaults to on outside production. */
  DEV_LOGIN: z.enum(['0', '1']).optional(),
  LICHESS_HOST: z.url().default('https://lichess.org'),
  LICHESS_CLIENT_ID: z.string().default('geochess'),
  /**
   * Web push keys (`npx web-push generate-vapid-keys`). When unset, notifications go by email
   * only. The subject is a contact URL for push services, e.g. mailto:you@example.com.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:no-reply@localhost'),
});

export type Env = z.infer<typeof envSchema> & { devLogin: boolean; secureCookies: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);
  return {
    ...env,
    devLogin: env.DEV_LOGIN ? env.DEV_LOGIN === '1' : env.NODE_ENV !== 'production',
    secureCookies: env.PUBLIC_URL?.startsWith('https://') ?? false,
  };
}
