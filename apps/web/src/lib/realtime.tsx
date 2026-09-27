'use client';

import type { ServerMessage } from '@empire/rules';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { keys, newerGame, toBoardGame, type BoardGame } from './queries';

type Listener = (message: ServerMessage) => void;

interface Realtime {
  connected: boolean;
  subscribe(listener: Listener): () => void;
}

const RealtimeContext = createContext<Realtime>({ connected: false, subscribe: () => () => {} });

function socketUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  // In development the game server runs beside the web app on port 4000; in production a
  // reverse proxy serves both from one origin.
  return process.env.NODE_ENV === 'development'
    ? `${protocol}://${location.hostname}:4000/ws`
    : `${protocol}://${location.host}/ws`;
}

/**
 * Keeps one WebSocket open while signed in. Server pushes invalidate the affected queries, so
 * screens refetch fresh state; components can also listen for messages directly.
 */
export function RealtimeProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [realtime] = useState<Omit<Realtime, 'connected'>>(() => ({
    subscribe(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  }));

  useEffect(() => {
    if (!userId) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'game.update') {
        // Boards apply moves directly; war events that change the campaign arrive separately.
        const incoming = toBoardGame(message.game);
        queryClient.setQueryData<BoardGame>(keys.game(message.game.id), (current) => newerGame(current, incoming));
      } else if (message.type !== 'hello') {
        // While draft-list edits are in flight, a refetch would briefly undo them on screen; the
        // last edit refetches when it lands.
        if (queryClient.isMutating({ mutationKey: keys.draftList(message.campaignId) }) === 0) {
          void queryClient.invalidateQueries({ queryKey: keys.campaign(message.campaignId) });
        }
        void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      }
      for (const listener of listeners.current) listener(message);
    };

    const connect = () => {
      clearTimeout(retryTimer);
      const ws = new WebSocket(socketUrl());
      socket = ws;
      ws.onmessage = onMessage;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        // Catch up on anything missed while disconnected.
        void queryClient.invalidateQueries({ queryKey: ['campaign'] });
        void queryClient.invalidateQueries({ queryKey: keys.campaigns });
        void queryClient.invalidateQueries({ queryKey: ['game'] });
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        setConnected(false);
        if (!disposed) retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };

    // Phones drop sockets in the background; reconnect as soon as the app is visible again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || socket?.readyState === WebSocket.OPEN) return;
      if (socket?.readyState === WebSocket.CONNECTING) return;
      attempt = 0;
      connect();
    };

    connect();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      const ws = socket;
      socket = null;
      ws?.close();
      setConnected(false);
    };
  }, [userId, queryClient]);

  return <RealtimeContext.Provider value={{ ...realtime, connected }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): Realtime {
  return useContext(RealtimeContext);
}

/** Calls `listener` for every server message while mounted. */
export function useServerMessages(listener: Listener): void {
  const { subscribe } = useRealtime();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe((message) => latest.current(message)), [subscribe]);
}
