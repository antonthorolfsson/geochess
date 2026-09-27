'use client';

import {
  FEED_FILTERS,
  feedShows,
  type EventView,
  type FeedFilter,
  type FeedItem,
  type FeedPage,
  type MessageView,
  type MessagesPage,
} from '@empire/rules';
import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from './api';

export const chatKeys = {
  feed: (campaignId: string, filter: FeedFilter) => ['feed', campaignId, filter] as const,
  conversation: (campaignId: string, peerId: string) => ['conversation', campaignId, peerId] as const,
  summary: (campaignId: string) => ['chat', campaignId] as const,
};

type FeedData = InfiniteData<FeedPage, string | undefined>;
type ConversationData = InfiniteData<MessagesPage, number | undefined>;

export const feedItemKey = (item: FeedItem) => (item.kind === 'event' ? `e${item.event.id}` : `m${item.message.id}`);
const itemTime = (item: FeedItem) => Date.parse(item.kind === 'event' ? item.event.createdAt : item.message.createdAt);

/** Newest first, as the server sends them; at the same instant a message follows the dispatch it answers. */
function newestFirst(a: FeedItem, b: FeedItem): number {
  const kind = (i: FeedItem) => (i.kind === 'event' ? 0 : 1);
  const id = (i: FeedItem) => (i.kind === 'event' ? i.event.id : i.message.id);
  return itemTime(b) - itemTime(a) || kind(b) - kind(a) || id(b) - id(a);
}

/** The feed, oldest first for reading, without the duplicates live updates can leave across pages. */
export function feedItems(data: { pages: FeedPage[] } | undefined): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      const key = feedItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.sort(newestFirst).reverse();
}

/** A private conversation, oldest first. */
export function conversationMessages(data: { pages: MessagesPage[] } | undefined): MessageView[] {
  const byId = new Map<number, MessageView>();
  for (const page of data?.pages ?? []) for (const m of page.messages) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Writes a live update into a cached list, and again once a fetch of that list in flight settles:
 * an infinite query's fetch replaces the cache with pages built from what it held when the fetch
 * began, which would drop the update. Updates are idempotent, so applying one twice is harmless.
 */
function applyLive<T>(queryClient: QueryClient, queryKey: QueryKey, update: (data: T | undefined) => T | undefined) {
  queryClient.setQueryData<T>(queryKey, update);
  const cache = queryClient.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  if (query?.state.fetchStatus !== 'fetching') return;
  const unsubscribe = cache.subscribe((event) => {
    if (event.query !== query) return;
    if (event.type !== 'removed' && query.state.fetchStatus === 'fetching') return;
    unsubscribe();
    if (event.type !== 'removed') queryClient.setQueryData<T>(queryKey, update);
  });
}

/** Adds new items to the cached feeds they belong in, or updates ones already there. */
export function upsertFeedItems(queryClient: QueryClient, campaignId: string, items: FeedItem[]): void {
  for (const filter of FEED_FILTERS) {
    const matching = items.filter((item) => feedShows(filter, item));
    if (matching.length === 0) continue;
    applyLive<FeedData>(queryClient, chatKeys.feed(campaignId, filter), (data) => {
      if (!data || data.pages.length === 0) return data;
      const incoming = new Map(matching.map((item) => [feedItemKey(item), item]));
      const pages = data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => {
          const key = feedItemKey(item);
          const update = incoming.get(key);
          if (!update) return item;
          incoming.delete(key);
          return update;
        }),
      }));
      if (incoming.size > 0)
        pages[0] = { ...pages[0]!, items: [...incoming.values(), ...pages[0]!.items].sort(newestFirst) };
      return { ...data, pages };
    });
  }
}

export const eventItems = (events: EventView[]): FeedItem[] => events.map((event) => ({ kind: 'event', event }));

/** Adds a private message to its cached conversation, or updates it there. */
export function upsertConversation(
  queryClient: QueryClient,
  campaignId: string,
  me: string,
  message: MessageView,
): void {
  if (message.recipientId === null) return;
  const peerId = message.authorId === me ? message.recipientId : message.authorId;
  applyLive<ConversationData>(queryClient, chatKeys.conversation(campaignId, peerId), (data) => {
    if (!data || data.pages.length === 0) return data;
    let found = false;
    const pages = data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((m) => {
        if (m.id !== message.id) return m;
        found = true;
        return message;
      }),
    }));
    if (!found) pages[0] = { ...pages[0]!, messages: [message, ...pages[0]!.messages] };
    return { ...data, pages };
  });
}

/** A chat message arrived or changed: update the feed, the conversation and the unread counts. */
export function applyChatMessage(queryClient: QueryClient, campaignId: string, me: string, message: MessageView): void {
  if (message.recipientId === null) upsertFeedItems(queryClient, campaignId, [{ kind: 'message', message }]);
  else upsertConversation(queryClient, campaignId, me, message);
  void queryClient.invalidateQueries({ queryKey: chatKeys.summary(campaignId) });
}

export function useFeed(campaignId: string, filter: FeedFilter) {
  return useInfiniteQuery({
    queryKey: chatKeys.feed(campaignId, filter),
    queryFn: ({ pageParam }) => api.feed(campaignId, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    // Kept current by live updates; refetched when the connection comes back.
    staleTime: Infinity,
  });
}

export function useConversation(campaignId: string, peerId: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.conversation(campaignId, peerId),
    queryFn: ({ pageParam }) => api.conversation(campaignId, peerId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: Infinity,
  });
}

export function useChatSummary(campaignId: string) {
  return useQuery({ queryKey: chatKeys.summary(campaignId), queryFn: () => api.chatSummary(campaignId) });
}

/**
 * Marks a conversation read up to `newestId` while it's on screen and has unread messages. The
 * server tells the player's other devices, so their badges clear too.
 */
export function useMarkRead(
  campaignId: string,
  peerId: string | null,
  newestId: number | null,
  unread: number,
  active: boolean,
): void {
  const marked = useRef({ key: '', id: 0 });
  useEffect(() => {
    const key = `${campaignId}\n${peerId ?? ''}`;
    if (marked.current.key !== key) marked.current = { key, id: 0 };
    if (!active || newestId === null || unread === 0 || newestId <= marked.current.id) return;
    const mark = () => {
      if (document.visibilityState !== 'visible' || newestId <= marked.current.id) return;
      marked.current = { key, id: newestId };
      void api.markRead(campaignId, peerId, newestId).catch(() => {
        marked.current = { key, id: 0 };
      });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [campaignId, peerId, newestId, unread, active]);
}
