import type { ServerMessage } from '@empire/rules';
import type { WebSocket } from 'ws';

const HEARTBEAT_MS = 30_000;
/** How often round-trip times are sampled, for lag compensation in live games. */
const PROBE_MS = 5_000;

/**
 * Open WebSocket connections by user. Campaign updates go to every connection of every member,
 * so players hear about their turn wherever they are in the app.
 */
export class Hub {
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly pingSentAt = new WeakMap<WebSocket, number>();
  /** Smoothed round-trip time per connection, in milliseconds. */
  private readonly rtt = new WeakMap<WebSocket, number>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly probeTimer: NodeJS.Timeout;

  constructor() {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref();
    this.probeTimer = setInterval(() => this.probe(), PROBE_MS);
    this.probeTimer.unref();
  }

  add(userId: string, socket: WebSocket): void {
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(socket);
    this.alive.add(socket);
    socket.on('pong', () => {
      this.alive.add(socket);
      const sentAt = this.pingSentAt.get(socket);
      if (sentAt === undefined) return;
      const sample = Date.now() - sentAt;
      const previous = this.rtt.get(socket);
      this.rtt.set(socket, previous === undefined ? sample : previous * 0.7 + sample * 0.3);
    });
    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0) this.byUser.delete(userId);
    });
    this.ping(socket);
  }

  send(userIds: Iterable<string>, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const userId of new Set(userIds)) {
      for (const socket of this.byUser.get(userId) ?? []) {
        if (socket.readyState === socket.OPEN) socket.send(data);
      }
    }
  }

  /** The best smoothed round-trip time among a user's connections, or 0 if unknown. */
  latency(userId: string): number {
    let best: number | undefined;
    for (const socket of this.byUser.get(userId) ?? []) {
      const rtt = this.rtt.get(socket);
      if (rtt !== undefined && (best === undefined || rtt < best)) best = rtt;
    }
    return best ?? 0;
  }

  close(): void {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.probeTimer);
    for (const set of this.byUser.values()) for (const socket of set) socket.terminate();
    this.byUser.clear();
  }

  private ping(socket: WebSocket): void {
    if (socket.readyState !== socket.OPEN) return;
    this.pingSentAt.set(socket, Date.now());
    socket.ping();
  }

  private probe(): void {
    for (const set of this.byUser.values()) for (const socket of set) this.ping(socket);
  }

  /** Drops connections that missed every ping since the previous heartbeat (e.g. a phone that went to sleep). */
  private heartbeat(): void {
    for (const set of this.byUser.values()) {
      for (const socket of set) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        this.ping(socket);
      }
    }
  }
}
