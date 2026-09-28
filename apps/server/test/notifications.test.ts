import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mailer } from '../src/auth/mailer';
import { openDatabase, type Database } from '../src/db/client';
import { pushSubscriptions, users } from '../src/db/schema';
import { loadEnv } from '../src/env';
import { createNotifier } from '../src/notifications/notifier';
import { signIn, startTestServer, type TestServer } from './helpers';

const log = { warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';

describe('the notifier', () => {
  let database: Database;
  const mail: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { delivers: false, send: async (m) => void mail.push(m) };

  beforeAll(async () => {
    database = await openDatabase({ dataDir: null });
    await database.db.insert(users).values([
      { id: 'kim', name: 'Kim', email: 'kim@example.com' },
      { id: 'lee', name: 'Lee' },
    ]);
  });
  afterAll(() => database.close());
  afterEach(() => {
    mail.length = 0;
    vi.restoreAllMocks();
  });

  const notice = { userId: 'kim', title: 'Your move', body: 'Bo moved.', url: '/c/x?game=g', tag: 'game:g' };

  it('emails notices that need an answer when push is off, once per tag in the cooldown', async () => {
    const notifier = createNotifier({ db: database.db, env: loadEnv({ NODE_ENV: 'test' }), mailer, log });
    await notifier.send({ ...notice, email: true });
    await notifier.send({ ...notice, email: true });
    await notifier.send({ ...notice, tag: 'game:h', email: true });
    await notifier.send({ ...notice, tag: 'game:i' });
    await notifier.send({ ...notice, userId: 'lee', email: true });
    expect(mail).toHaveLength(2);
    expect(mail[0]).toMatchObject({ to: 'kim@example.com', subject: 'Your move · Geo Chess' });
    expect(mail[0]!.text).toContain('http://localhost:3000/c/x?game=g');
  });

  it('pushes to every subscribed browser instead, and forgets subscriptions the browser dropped', async () => {
    const keys = webpush.generateVAPIDKeys();
    const env = loadEnv({ NODE_ENV: 'test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey });
    await database.db.insert(pushSubscriptions).values([
      { endpoint: `${FCM}-1`, userId: 'kim', p256dh: 'p', auth: 'a' },
      { endpoint: `${FCM}-2`, userId: 'kim', p256dh: 'p', auth: 'a' },
    ]);
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith('-2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return { statusCode: 201, body: '', headers: {} };
    });
    const notifier = createNotifier({ db: database.db, env, mailer, log });
    await notifier.send({ ...notice, email: true });

    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0]![1]))).toEqual({
      title: 'Your move',
      body: 'Bo moved.',
      url: '/c/x?game=g',
      tag: 'game:g',
    });
    expect(mail).toHaveLength(0);
    const left = await database.db.select().from(pushSubscriptions);
    expect(left.map((s) => s.endpoint)).toEqual([`${FCM}-1`]);
  });
});

describe('push subscriptions', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server.close());

  it('accept known push services only', async () => {
    const ann = await signIn(server.app, 'Ann');
    const keys = { p256dh: 'p', auth: 'a' };
    expect((await ann.get('/api/push/key')).body).toEqual({ publicKey: null });
    expect((await ann.post('/api/push/subscribe', { endpoint: 'https://internal.example/hook', keys })).status).toBe(
      400,
    );
    expect((await ann.post('/api/push/subscribe', { endpoint: 'http://fcm.googleapis.com/x', keys })).status).toBe(400);
    expect((await ann.post('/api/push/subscribe', { endpoint: FCM, keys })).status).toBe(200);
    expect((await ann.post('/api/push/subscribe', { endpoint: FCM, keys })).status).toBe(200);
    const stored = await server.app.ctx.db.select().from(pushSubscriptions);
    expect(stored).toMatchObject([{ endpoint: FCM, userId: 'dev_ann' }]);
    await ann.post('/api/push/unsubscribe', { endpoint: FCM });
    expect(await server.app.ctx.db.select().from(pushSubscriptions)).toEqual([]);
  });
});
