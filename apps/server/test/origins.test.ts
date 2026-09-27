import type { ServerMessage } from '@empire/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, tick, type TestServer } from './helpers';

// Production splits the hosts: the web app at geochess.xyz proxies /api to the game server at
// api.geochess.xyz, and browsers open their WebSocket to api.geochess.xyz directly.
const WEB = 'https://geochess.xyz';
const API_HOST = 'api.geochess.xyz';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer(undefined, { PUBLIC_URL: WEB, COOKIE_DOMAIN: 'geochess.xyz' });
});
afterAll(async () => {
  await server.close();
});

function signIn(name: string, origin = WEB) {
  return server.app.inject({
    method: 'POST',
    url: '/api/auth/dev',
    headers: { host: API_HOST, origin },
    payload: { name },
  });
}

async function sessionCookie(name: string): Promise<string> {
  const res = await signIn(name);
  return `ec_session=${res.cookies.find((c) => c.name === 'ec_session')!.value}`;
}

/** Opens a socket to the game server's own host and reports what it heard before it closed. */
async function openSocket(cookie: string, origin: string) {
  const messages: ServerMessage[] = [];
  let closeCode: number | null = null;
  const ws = await server.app.injectWS(
    '/ws',
    { headers: { cookie, host: API_HOST, origin } },
    {
      onInit(socket) {
        socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
        socket.on('close', (code) => (closeCode = code));
      },
    },
  );
  await tick();
  ws.terminate();
  return { messages, closeCode };
}

describe('web app and game server on different hosts', () => {
  it('accepts writes from the web app and shares the session with its subdomains', async () => {
    const res = await signIn('Ann');
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'ec_session')).toMatchObject({
      domain: 'geochess.xyz',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
  });

  it('still blocks writes from other sites', async () => {
    expect((await signIn('Mallory', 'https://evil.example')).statusCode).toBe(403);
    expect((await signIn('Mallory', 'http://geochess.xyz')).statusCode).toBe(403);
    expect((await signIn('Mallory', 'https://api.geochess.xyz.evil.example')).statusCode).toBe(403);
  });

  it("opens sockets from the web app's origin and refuses other sites", async () => {
    const cookie = await sessionCookie('Bo');
    const own = await openSocket(cookie, WEB);
    expect(own.messages[0]).toMatchObject({ type: 'hello', userId: 'dev_bo' });

    const foreign = await openSocket(cookie, 'https://evil.example');
    expect(foreign.messages).toEqual([]);
    expect(foreign.closeCode).toBe(4403);
  });

  it('signs out on every subdomain and keeps responses out of shared caches', async () => {
    const cookie = await sessionCookie('Cy');
    const out = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { host: API_HOST, origin: WEB, cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(out.headers['cache-control']).toBe('no-store');
    expect(out.cookies.find((c) => c.name === 'ec_session')).toMatchObject({
      domain: 'geochess.xyz',
      path: '/',
      value: '',
    });
  });
});
