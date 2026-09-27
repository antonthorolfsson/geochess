import type { FeedItem, FeedPage, MessageView } from '@empire/rules';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { chatKeys, conversationMessages, feedItems, upsertConversation, upsertFeedItems } from './chat';

const message = (id: number, over: Partial<MessageView> = {}): MessageView => ({
  id,
  authorId: 'bo',
  recipientId: null,
  body: `Message ${id}`,
  removed: null,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
  ...over,
});
const item = (id: number): FeedItem => ({ kind: 'message', message: message(id) });
const ids = (items: FeedItem[]) => items.map((i) => (i.kind === 'message' ? i.message.id : -i.event.id));
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Starts loading the feed with a response the test releases. */
function loadFeed(queryClient: QueryClient) {
  let release!: (page: FeedPage) => void;
  const done = queryClient.fetchInfiniteQuery({
    queryKey: chatKeys.feed('c1', 'all'),
    queryFn: () => new Promise<FeedPage>((resolve) => (release = resolve)),
    initialPageParam: undefined as string | undefined,
    staleTime: 0,
  });
  return { release: (page: FeedPage) => release(page), done };
}

describe('live chat updates', () => {
  it('add new messages to the feeds they belong in, once each', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatKeys.feed('c1', 'all'), { pages: [{ items: [item(1)], next: null }], pageParams: [] });
    queryClient.setQueryData(chatKeys.feed('c1', 'wars'), { pages: [{ items: [], next: null }], pageParams: [] });
    upsertFeedItems(queryClient, 'c1', [item(2)]);
    upsertFeedItems(queryClient, 'c1', [item(2)]);
    expect(ids(feedItems(queryClient.getQueryData(chatKeys.feed('c1', 'all'))))).toEqual([1, 2]);
    expect(feedItems(queryClient.getQueryData(chatKeys.feed('c1', 'wars')))).toEqual([]);
  });

  it('survive a feed fetch that was already underway', async () => {
    const queryClient = new QueryClient();
    const first = loadFeed(queryClient);
    upsertFeedItems(queryClient, 'c1', [item(2)]);
    first.release({ items: [item(1)], next: null });
    await first.done;
    await settle();
    expect(ids(feedItems(queryClient.getQueryData(chatKeys.feed('c1', 'all'))))).toEqual([1, 2]);

    // A refetch that started before message 3 was sent comes back without it.
    const again = loadFeed(queryClient);
    upsertFeedItems(queryClient, 'c1', [item(3)]);
    again.release({ items: [item(2), item(1)], next: null });
    await again.done;
    await settle();
    expect(ids(feedItems(queryClient.getQueryData(chatKeys.feed('c1', 'all'))))).toEqual([1, 2, 3]);
  });

  it('put private messages in the right conversation, and replace removed ones', () => {
    const queryClient = new QueryClient();
    const key = chatKeys.conversation('c1', 'bo');
    queryClient.setQueryData(key, {
      pages: [{ messages: [message(1, { recipientId: 'ann' })], next: null }],
      pageParams: [],
    });
    upsertConversation(queryClient, 'c1', 'ann', message(2, { authorId: 'ann', recipientId: 'bo' }));
    upsertConversation(queryClient, 'c1', 'ann', message(1, { recipientId: 'ann', body: null, removed: 'author' }));
    const thread = conversationMessages(queryClient.getQueryData(key));
    expect(thread.map((m) => [m.id, m.body])).toEqual([
      [1, null],
      [2, 'Message 2'],
    ]);
  });
});
