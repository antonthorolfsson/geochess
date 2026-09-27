import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { ApiError } from '@empire/rules';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { createMailer, type Mailer } from './auth/mailer';
import { registerAuthRoutes } from './auth/routes';
import { SESSION_COOKIE, loadSessionUser } from './auth/session';
import { registerCampaignRoutes } from './campaigns/routes';
import type { AppContext } from './context';
import type { DatasetProvider } from './datasets';
import type { Db } from './db/client';
import type { Env } from './env';
import { HttpError, forbidden } from './lib/errors';
import { KeyedMutex } from './lib/mutex';
import { Timers } from './lib/timers';
import { createNotifier, type Notifier } from './notifications/notifier';
import { registerNotificationRoutes } from './notifications/routes';
import { Hub } from './realtime/hub';
import { registerRealtimeRoutes } from './realtime/routes';
import { registerWarRoutes } from './wars/routes';
import { startScheduler } from './wars/scheduler';

export interface AppDeps {
  db: Db;
  env: Env;
  datasets: DatasetProvider;
  mailer?: Mailer;
  notifier?: Notifier;
  /** The clock. Tests pass their own to step through deadlines. */
  now?: () => Date;
  /**
   * Whether to run the deadline scheduler and live flag timers. Tests turn it off and call
   * `runDueWork` themselves.
   */
  scheduler?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Shared services, exposed for tests. */
    ctx: AppContext;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.env.NODE_ENV === 'test' ? false : { level: 'info' },
    logController: new LogController({ disableRequestLogging: deps.env.NODE_ENV !== 'production' }),
    // The web app proxies /api to this server (and a reverse proxy does in production).
    trustProxy: true,
  });

  const hub = new Hub();
  const mailer = deps.mailer ?? createMailer(deps.env, app.log);
  const scheduling = deps.scheduler ?? true;
  const timers = new Timers(scheduling);
  const ctx: AppContext = {
    db: deps.db,
    env: deps.env,
    datasets: deps.datasets,
    hub,
    mailer,
    notifier: deps.notifier ?? createNotifier({ db: deps.db, env: deps.env, mailer, log: app.log }),
    log: app.log,
    now: deps.now ?? (() => new Date()),
    locks: new KeyedMutex(),
    gameLocks: new KeyedMutex(),
    timers,
  };
  app.decorate('ctx', ctx);
  const scheduler = scheduling ? startScheduler(ctx) : null;
  app.addHook('onClose', async () => {
    scheduler?.stop();
    timers.clearAll();
    hub.close();
  });

  await app.register(cookie);
  await app.register(websocket);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    // Cross-site request forgery guard, on top of SameSite=Lax session cookies.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.host) throw forbidden('Cross-site request blocked.');
    }
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await loadSessionUser(ctx.db, token) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { message: err.message, code: err.code } } satisfies ApiError);
    }
    const status =
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    const message = status >= 500 ? 'Something went wrong on our side.' : (err as Error).message;
    return reply.code(status).send({ error: { message } } satisfies ApiError);
  });

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, ctx);
  registerCampaignRoutes(app, ctx);
  registerWarRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerRealtimeRoutes(app, ctx);
  return app;
}
