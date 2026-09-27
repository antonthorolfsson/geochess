'use client';

import type { MessageView } from '@empire/rules';
import { useState } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { relativeTime } from '@/lib/format';
import { EmpireSwatch } from '../hatch';

/** Messages from the same player this close together share one heading. */
const GROUP_MS = 5 * 60_000;

/** Whether `message` continues the previous message's group (same author, soon after). */
export function continuesGroup(previous: MessageView | undefined, message: MessageView): boolean {
  return (
    previous !== undefined &&
    previous.authorId === message.authorId &&
    Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_MS
  );
}

/**
 * One chat message: the author's empire color and name, then the text. Tapping a message the
 * viewer may remove shows the button for it (hovering does too, with a mouse).
 */
export function ChatLine({
  model,
  message,
  grouped,
  now,
  onRemove,
}: {
  model: CampaignModel;
  message: MessageView;
  /** Continues the previous message's group, so the heading is left out. */
  grouped: boolean;
  now: number;
  /** Present when the viewer may delete or remove this message. */
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const author = model.membersById.get(message.authorId);
  const mine = message.authorId === model.me.userId;
  const removable = Boolean(onRemove) && message.removed === null;
  return (
    <div className={`group relative flex gap-2.5 ${grouped ? 'pt-0.5' : 'pt-2.5'}`}>
      <div className="w-4 shrink-0 pt-1">
        {!grouped &&
          (author ? (
            <EmpireSwatch color={author.color} size={16} />
          ) : (
            <span className="block size-4 rounded-[2px] border border-line-strong" aria-hidden="true" />
          ))}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{author?.name ?? 'A former player'}</span>
            {mine && <span className="text-xs font-bold tracking-widest text-muted uppercase">you</span>}
            <time dateTime={message.createdAt} className="shrink-0 text-xs text-faint tabular-nums">
              {relativeTime(message.createdAt, now)}
            </time>
          </div>
        )}
        {message.body === null ? (
          <p className="text-[0.95rem] text-faint italic">
            {message.removed === 'host' ? 'Removed by the host.' : 'Message deleted.'}
          </p>
        ) : (
          <p
            className={`text-[0.95rem] break-words whitespace-pre-wrap ${removable ? 'cursor-pointer' : ''}`}
            onClick={removable ? () => setOpen((v) => !v) : undefined}
          >
            {message.body}
          </p>
        )}
      </div>
      {removable && (
        <button
          type="button"
          className={`btn btn-ghost btn-sm absolute top-1 right-0 bg-gunmetal text-muted ${
            open
              ? ''
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100'
          }`}
          onClick={() => {
            if (confirm(mine ? 'Delete your message?' : 'Remove this message from the channel?')) onRemove!();
            setOpen(false);
          }}
        >
          {mine ? 'Delete' : 'Remove'}
        </button>
      )}
    </div>
  );
}
