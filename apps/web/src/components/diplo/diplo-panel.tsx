'use client';

import type { TerritoryId } from '@empire/rules';
import type { CampaignModel } from '@/lib/campaign';
import { useChatSummary } from '@/lib/chat';
import { playerName } from '@/lib/wars';
import { SegmentTabs } from '../ui';
import { AccordsView } from './accords-view';
import { ConversationThread, Conversations } from './conversations';
import { DispatchFeed } from './feed';

export type DiploView = 'dispatches' | 'messages' | 'accords';

/** Unread private messages, and unread messages in the campaign channel. */
export function useUnread(campaignId: string): { direct: number; channel: number } {
  const summary = useChatSummary(campaignId);
  return {
    direct: summary.data?.conversations.reduce((sum, c) => sum + c.unread, 0) ?? 0,
    channel: summary.data?.channelUnread ?? 0,
  };
}

/**
 * Diplomacy: the dispatches timeline with the campaign channel, private messages, and accords.
 * Fills its column; each view scrolls on its own so message boxes stay pinned at the bottom.
 */
export function DiploPanel({
  model,
  view,
  onView,
  chatWith,
  onOpenChat,
  onCloseChat,
  focusAccordId,
  spotlight,
  onSelect,
  onOpenWar,
  active = true,
}: {
  model: CampaignModel;
  view: DiploView;
  onView(view: DiploView): void;
  /** The player whose private conversation is open. */
  chatWith: string | null;
  onOpenChat(userId: string): void;
  onCloseChat(): void;
  focusAccordId: string | null;
  /** A proposal to call out, with a new nonce each time. */
  spotlight?: { id: string; nonce: number } | null;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
  /**
   * On screen. The panel can stay mounted while hidden (another section or tab is up, or its drawer
   * is closed), and only marks messages read while it's showing.
   */
  active?: boolean;
}) {
  const unread = useUnread(model.campaign.id);
  const proposals = model.proposalsToMe;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SegmentTabs
        label="Diplomacy"
        value={view}
        onChange={onView}
        tabs={[
          { id: 'dispatches', label: 'Dispatches', badge: unread.channel },
          { id: 'messages', label: 'Messages', badge: unread.direct, alert: true },
          { id: 'accords', label: 'Accords', badge: proposals.length, alert: true },
        ]}
      />
      {proposals.length > 0 && view !== 'accords' && (
        <button
          type="button"
          onClick={() => onView('accords')}
          className="flex min-h-11 shrink-0 items-center gap-2 border-b border-amber/50 bg-amber/10 px-4 text-left text-[0.95rem] text-amber"
        >
          <span className="min-w-0 flex-1 truncate">
            {proposals.length === 1
              ? `${playerName(model, proposals[0]!.proposerId)} proposes an accord.`
              : `${proposals.length} accords proposed to you.`}
          </span>
          <span className="shrink-0 font-bold tracking-wider uppercase">Answer</span>
        </button>
      )}
      <div className="min-h-0 flex-1">
        {view === 'dispatches' && (
          <DispatchFeed model={model} onSelect={onSelect} onOpenWar={onOpenWar} active={active} />
        )}
        {view === 'messages' &&
          (chatWith ? (
            <ConversationThread key={chatWith} model={model} peerId={chatWith} onBack={onCloseChat} active={active} />
          ) : (
            <Conversations model={model} onOpen={onOpenChat} />
          ))}
        {view === 'accords' && (
          <AccordsView model={model} focusId={focusAccordId} spotlight={spotlight} onOpenChat={onOpenChat} />
        )}
      </div>
    </div>
  );
}
