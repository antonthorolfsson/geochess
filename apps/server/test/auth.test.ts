import type { ApiError, MeResponse } from '@empire/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, signIn, startTestServer, type Client, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

// Each request comes from its own address, so only the per-account limits come into play.
let address = 0;
const nextAddress = () => `10.0.${Math.floor(++address / 250)}.${address % 250}`;

async function post(url: string, payload: object) {
  const res = await server.app.inject({ method: 'POST', url, payload, remoteAddress: nextAddress() });
  const session = res.cookies.find((c) => c.name === 'ec_session');
  return {
    status: res.statusCode,
    body: res.json(),
    player: session ? client(server.app, `ec_session=${session.value}`) : null,
  };
}

/** Emails a link to `email`, returning the link. */
async function emailLink(email: string, reset?: boolean): Promise<URL> {
  const res = await post('/api/auth/email', { email, reset });
  expect(res.status).toBe(200);
  return new URL(res.body.devLink);
}

const openLink = (link: URL, password?: string) =>
  post('/api/auth/email/verify', { token: link.searchParams.get('token'), password });

async function signInByLink(email: string): Promise<Client> {
  const res = await openLink(await emailLink(email));
  expect(res.status).toBe(200);
  return res.player!;
}

const signInWithPassword = (email: string, password: string) => post('/api/auth/password', { email, password });

const me = async (player: Client) => (await player.get<MeResponse>('/api/me')).body.user;

describe('passwords', () => {
  it('sets a password after signing in by link, then signs in with it', async () => {
    const opened = await openLink(await emailLink('kim@example.com'));
    expect(opened.body).toEqual({ ok: true, hasPassword: false });
    const kim = opened.player!;
    expect(await me(kim)).toMatchObject({ email: 'kim@example.com', hasPassword: false });

    const short = await kim.put<ApiError>('/api/me/password', { password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toBe('password: Passwords need at least 8 characters.');
    expect((await kim.put('/api/me/password', { password: 'correct horse' })).status).toBe(200);
    const view = await kim.get<MeResponse>('/api/me');
    expect(view.body.user?.hasPassword).toBe(true);
    expect(JSON.stringify(view.body)).not.toContain('scrypt');

    const good = await signInWithPassword('Kim@Example.com', 'correct horse');
    expect(good.status).toBe(200);
    expect(await me(good.player!)).toMatchObject({ id: (await me(kim))!.id, email: 'kim@example.com' });

    // Every failure reads the same, whether or not the email has an account or a password.
    await signInByLink('lee@example.com');
    for (const [email, password] of [
      ['kim@example.com', 'wrong horse'],
      ['nobody@example.com', 'correct horse'],
      ['lee@example.com', 'correct horse'],
    ] as const) {
      const bad = await signInWithPassword(email, password);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toEqual({ message: 'Wrong email or password.', code: 'wrong-password' });
      expect(bad.player).toBeNull();
    }
  });

  it('needs the current password to change it, and signs out other devices', async () => {
    const laptop = await signInByLink('mo@example.com');
    await laptop.put('/api/me/password', { password: 'first password' });
    const phone = (await signInWithPassword('mo@example.com', 'first password')).player!;

    const missing = await laptop.put<ApiError>('/api/me/password', { password: 'second password' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Enter your current password.');
    const wrong = await laptop.put<ApiError>('/api/me/password', {
      password: 'second password',
      currentPassword: 'not it at all',
    });
    expect(wrong.body.error.message).toBe('Your current password is wrong.');
    const changed = await laptop.put('/api/me/password', {
      password: 'second password',
      currentPassword: 'first password',
    });
    expect(changed.status).toBe(200);

    expect(await me(phone)).toBeNull();
    expect(await me(laptop)).toMatchObject({ email: 'mo@example.com', hasPassword: true });
    expect((await signInWithPassword('mo@example.com', 'first password')).status).toBe(400);
    expect((await signInWithPassword('mo@example.com', 'second password')).status).toBe(200);
  });

  it('replaces a forgotten password from an emailed link', async () => {
    const laptop = await signInByLink('ivy@example.com');
    await laptop.put('/api/me/password', { password: 'forgotten one' });
    const phone = (await signInWithPassword('ivy@example.com', 'forgotten one')).player!;

    const link = await emailLink('ivy@example.com', true);
    expect(link.searchParams.get('reset')).toBe('1');
    expect(server.mail.at(-1)).toMatchObject({ to: 'ivy@example.com', subject: 'Choose a new Geo Chess password' });

    // A password that's too short is refused before the link is used up.
    expect((await openLink(link, 'short')).status).toBe(400);
    const opened = await openLink(link, 'remembered one');
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({ ok: true, hasPassword: true });

    expect(await me(phone)).toBeNull();
    expect(await me(laptop)).toBeNull();
    expect(await me(opened.player!)).toMatchObject({ email: 'ivy@example.com', hasPassword: true });
    expect((await signInWithPassword('ivy@example.com', 'forgotten one')).status).toBe(400);
    expect((await signInWithPassword('ivy@example.com', 'remembered one')).status).toBe(200);
    const again = await openLink(link, 'third time lucky');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('link-expired');
  });

  it('can set the password of a new account from its first link', async () => {
    const opened = await openLink(await emailLink('new.player@example.com', true), 'brand new one');
    expect(opened.body).toEqual({ ok: true, hasPassword: true });
    expect(await me(opened.player!)).toMatchObject({ name: 'New Player', hasPassword: true });
    expect((await signInWithPassword('new.player@example.com', 'brand new one')).status).toBe(200);
  });

  it('only gives passwords to accounts with an email', async () => {
    const ann = await signIn(server.app, 'Ann');
    expect(await me(ann)).toMatchObject({ email: null, hasPassword: false });
    const res = await ann.put<ApiError>('/api/me/password', { password: 'correct horse' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no-email');
  });

  it('limits password guesses for an account', async () => {
    const max = await signInByLink('max@example.com');
    await max.put('/api/me/password', { password: 'the real one' });
    for (let i = 0; i < 10; i++) expect((await signInWithPassword('max@example.com', `guess ${i}`)).status).toBe(400);
    const limited = await signInWithPassword('max@example.com', 'the real one');
    expect(limited.status).toBe(429);
    expect(limited.player).toBeNull();
  });
});
