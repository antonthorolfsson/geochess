import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { isPublicOrigin } from '../lib/http';

export function registerRealtimeRoutes(app: FastifyInstance, { hub, env }: AppContext): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    // Browsers attach cookies to cross-site WebSocket handshakes only in some cases; checking the
    // origin's hostname closes the door on cross-site socket hijacking either way. In production the
    // web app's origin (PUBLIC_URL) opens sockets straight to this server's own subdomain.
    const origin = req.headers.origin;
    if (origin && !isPublicOrigin(env, origin) && new URL(origin).hostname !== req.hostname) {
      socket.close(4403, 'forbidden origin');
      return;
    }
    if (!req.user) {
      socket.close(4401, 'unauthorized');
      return;
    }
    hub.add(req.user.id, socket);
    socket.send(JSON.stringify({ type: 'hello', userId: req.user.id }));
  });
}
