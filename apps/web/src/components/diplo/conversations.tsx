'use client';

import type { MessageView } from '@empire/rules';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { applyChatMessage, conversationMessages, useChatSummary, useConversation, useMarkRead } from '@/lib/chat';
import { relativeTime } from '@/lib/format';
import { useChatScroll } from '@/lib/use-chat-scroll';
import { useNow } from '@/lib/use-now';
import { PlayerName } from '../campaign/player-name';
import { EmpireSwatch } from '../hatch';
import { Notice, Spinner } from '../ui';
import { ChatLine, continuesGroup } from './chat-line';
import { Composer } from './composer';

/** Every other player, with the latest private message and what's unread; the busiest first. */
export function Conversations({ model, onOpen }: { model: CampaignModel; onOpen(userId: string): void }) {
  const summary = useChatSummary(model.campaign.id);
  const now = useNow(30_000);
  const me = model.me.userId;
  const byUser = new Map(summary.data?.conversations.map((c) => [c.userId, c]));
  const rows = model.campaign.members
    .filter((m) => m.userId !== me)
    .map((member) => ({ member, conversation: byUser.get(member.userId) }))
    .sort(
      (a, b) =>
        (b.conversation?.last.id ?? 0) - (a.conversation?.last.id ?? 0) || a.member.name.localeCompare(b.member.name),
    );
  const preview = (last: MessageView) => {
    const text = last.body ?? (last.removed === 'host' ? 'Removed by the host.' : 'Message deleted.');
    return last.authorId === me ? `You: ${text}` : text;
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <p className="text-sm text-muted">Private messages. Only you and the other player can read them.</p>
      {rows.length === 0 ? (
        <p className="text-[0.95rem] text-muted">Nobody else has joined yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[3px] border border-line">
          {rows.map(({ member, conversation }) => (
            <li key={member.userId}>
              <button
                type="button"
                onClick={() => onOpen(member.userId)}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised"
              >
                <EmpireSwatch color={member.color} size={18} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{member.name}</span>
                  <span className={`block truncate text-sm ${conversation?.unread ? 'text-paper' : 'text-muted'}`}>
                    {conversation ? preview(conversation.last) : 'No messages yet'}
                  </span>
                </span>
                {conversation?.unread ? (
                  <span
                    className="min-w-6 rounded-full bg-amber px-1.5 text-center text-sm leading-6 font-bold text-gunmetal tabular-nums"
                    aria-label={`${conversation.unread} unread`}
                  >
                    {conversation.unread}
                  </span>
                ) : conversation ? (
                  <time dateTime={conversation.last.createdAt} className="shrink-0 text-xs text-faint tabular-nums">
                    {relativeTime(conversation.last.createdAt, now)}
                  </time>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A private conversation with one player, newest at the bottom by the message box. */
export function ConversationThread({
  model,
  peerId,
  onBack,
}: {
  model: CampaignModel;
  peerId: string;
  onBack(): void;
}) {
  const campaignId = model.campaign.id;
  const conversation = useConversation(campaignId, peerId);
  const summary = useChatSummary(campaignId);
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const messages = conversationMessages(conversation.data);
  const peer = model.membersById.get(peerId);
  const scroll = useChatScroll(
    messages[0] ? String(messages[0].id) : null,
    messages.length > 0 ? String(messages.at(-1)!.id) : null,
  );
  const unread = summary.data?.conversations.find((c) => c.userId === peerId)?.unread ?? 0;
  useMarkRead(campaignId, peerId, messages.at(-1)?.id ?? null, unread, true);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
      <header className="flex shrink-0 items-center gap-1 border-b border-line py-1 pr-3 pl-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="All conversations"
          className="flex size-11 shrink-0 items-center justify-center text-xl text-muted hover:text-paper"
        >
          ←
        </button>
        <PlayerName member={peer} />
      </header>

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {conversation.hasNextPage && (
          <div className="py-2 text-center">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={conversation.isFetchingNextPage}
              onClick={() => void conversation.fetchNextPage()}
            >
              {conversation.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
            </button>
          </div>
        )}
        {conversation.isPending ? (
          <div className="py-6 text-center">
            <Spinner label="Opening the line" />
          </div>
        ) : conversation.error ? (
          <Notice tone="error">{errorMessage(conversation.error)}</Notice>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[0.95rem] text-muted">
            Only you and {peer?.name ?? 'this player'} can read what you write here.
          </p>
        ) : (
          <ol aria-label={`Messages with ${peer?.name ?? 'this player'}`} aria-live="polite">
            {messages.map((message, i) => (
              <li key={message.id}>
                <ChatLine
                  model={model}
                  message={message}
                  grouped={continuesGroup(messages[i - 1], message)}
                  now={now}
                  onRemove={message.authorId === model.me.userId ? () => void remove(message) : undefined}
                />
              </li>
            ))}
          </ol>
        )}
        {removeError && <Notice tone="error">{removeError}</Notice>}
      </div>

      {peer ? (
        <Composer
          placeholder={`Message ${peer.name}`}
          onSend={async (body) => {
            const message = await api.sendMessage(campaignId, { body, to: peerId });
            applyChatMessage(queryClient, campaignId, model.me.userId, message);
            scroll.toBottom();
          }}
        />
      ) : (
        <p className="shrink-0 border-t border-line p-3 text-sm text-muted">This player has left the campaign.</p>
      )}
    </div>
  );
}
