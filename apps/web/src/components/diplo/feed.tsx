'use client';

import type { FeedFilter, FeedItem, MessageView, TerritoryId } from '@empire/rules';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { applyChatMessage, feedItemKey, feedItems, useChatSummary, useFeed, useMarkRead } from '@/lib/chat';
import { relativeTime } from '@/lib/format';
import { useChatScroll } from '@/lib/use-chat-scroll';
import { useNow } from '@/lib/use-now';
import { Notice, Spinner } from '../ui';
import { ChatLine, continuesGroup } from './chat-line';
import { Composer } from './composer';
import { DispatchLine, dispatchTone } from './dispatch-line';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wars', label: 'Wars' },
  { id: 'accords', label: 'Accords' },
  { id: 'chat', label: 'Chat' },
];

const TONE_BORDER = {
  war: 'border-grease/70',
  broken: 'border-grease',
  accord: 'border-paper/55',
  mission: 'border-amber/70',
  plain: 'border-line-strong',
} as const;

/**
 * The campaign's timeline: dispatches from the event log and the campaign channel, oldest at the
 * top and the newest by the message box, like a conversation.
 */
export function DispatchFeed({
  model,
  onSelect,
  onOpenWar,
}: {
  model: CampaignModel;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
}) {
  const campaignId = model.campaign.id;
  const [filter, setFilter] = useState<FeedFilter>('all');
  const feed = useFeed(campaignId, filter);
  const summary = useChatSummary(campaignId);
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const items = feedItems(feed.data);
  const scroll = useChatScroll(
    items[0] ? feedItemKey(items[0]) : null,
    items.length > 0 ? feedItemKey(items.at(-1)!) : null,
    filter,
  );
  const [removeError, setRemoveError] = useState<string | null>(null);

  const chatting = filter === 'all' || filter === 'chat';
  const newestMessage = items.findLast((i) => i.kind === 'message');
  useMarkRead(
    campaignId,
    null,
    newestMessage?.kind === 'message' ? newestMessage.message.id : null,
    summary.data?.channelUnread ?? 0,
    chatting,
  );

  const remove = async (message: MessageView) => {
    setRemoveError(null);
    try {
      applyChatMessage(queryClient, campaignId, model.me.userId, await api.removeMessage(campaignId, message.id));
    } catch (err) {
      setRemoveError(errorMessage(err));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`btn btn-sm min-h-9 border-line-strong ${filter === f.id ? 'bg-paper text-gunmetal' : 'text-muted'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {feed.hasNextPage && (
          <div className="py-2 text-center">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
            </button>
          </div>
        )}
        {feed.isPending ? (
          <div className="py-6 text-center">
            <Spinner label="Decoding dispatches" />
          </div>
        ) : feed.error ? (
          <Notice tone="error">{errorMessage(feed.error)}</Notice>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[0.95rem] text-muted">
            {filter === 'chat'
              ? 'No messages yet. Anything you write here goes to every player in the campaign.'
              : filter === 'accords'
                ? 'No accords signed yet.'
                : filter === 'wars'
                  ? 'No wars yet.'
                  : 'Nothing has happened yet.'}
          </p>
        ) : (
          <ol aria-label="Dispatches" aria-live="polite">
            {items.map((item, i) => (
              <li key={feedItemKey(item)}>
                <FeedEntry
                  model={model}
                  item={item}
                  previous={items[i - 1]}
                  now={now}
                  onSelect={onSelect}
                  onOpenWar={onOpenWar}
                  onRemove={remove}
                />
              </li>
            ))}
          </ol>
        )}
        {removeError && <Notice tone="error">{removeError}</Notice>}
      </div>

      {chatting && (
        <Composer
          placeholder="Message everyone"
          onSend={async (body) => {
            const message = await api.sendMessage(campaignId, { body });
            applyChatMessage(queryClient, campaignId, model.me.userId, message);
            scroll.toBottom();
          }}
        />
      )}
    </div>
  );
}

function FeedEntry({
  model,
  item,
  previous,
  now,
  onSelect,
  onOpenWar,
  onRemove,
}: {
  model: CampaignModel;
  item: FeedItem;
  previous: FeedItem | undefined;
  now: number;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
  onRemove(message: MessageView): void;
}) {
  if (item.kind === 'message') {
    const { message } = item;
    const canRemove = message.authorId === model.me.userId || model.isHost;
    return (
      <ChatLine
        model={model}
        message={message}
        grouped={previous?.kind === 'message' && continuesGroup(previous.message, message)}
        now={now}
        onRemove={canRemove ? () => onRemove(message) : undefined}
      />
    );
  }
  const { event } = item;
  return (
    <div className={`mt-2.5 border-l-2 py-0.5 pl-2.5 text-[0.95rem] ${TONE_BORDER[dispatchTone(event.type)]}`}>
      <DispatchLine event={event} model={model} onSelect={onSelect} onOpenWar={onOpenWar} />{' '}
      <time dateTime={event.createdAt} className="text-xs whitespace-nowrap text-faint tabular-nums">
        {relativeTime(event.createdAt, now)}
      </time>
    </div>
  );
}
