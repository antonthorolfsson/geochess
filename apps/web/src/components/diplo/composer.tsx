'use client';

import { MESSAGE_MAX } from '@empire/rules';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useMediaQuery } from '@/lib/use-media-query';

/** Tallest the message box grows before it scrolls, in pixels. */
const MAX_HEIGHT = 160;

/**
 * Messages being written, by `draftKey`, kept in memory until sent: one survives its box closing
 * (another view, tab or layout, or the drawer it's in folding away) and is there when it opens again.
 */
const drafts = new Map<string, string>();

/**
 * A message box pinned under a conversation. Enter sends on a keyboard (Shift+Enter for a new
 * line); on touch screens Enter makes a new line and the button sends. `draftKey` names the
 * conversation, and the player writing in it, for keeping what's been written so far.
 */
export function Composer({
  draftKey,
  placeholder,
  onSend,
}: {
  draftKey: string;
  placeholder: string;
  onSend(body: string): Promise<unknown>;
}) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');
  useEffect(() => {
    if (text) drafts.set(draftKey, text);
    else drafts.delete(draftKey);
  }, [draftKey, text]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const touch = useMediaQuery('(pointer: coarse)');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, MAX_HEIGHT)}px`;
  }, [text]);

  const send = async () => {
    const body = text.trim();
    if (!body || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSend(body);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
      ref.current?.focus();
    }
  };

  return (
    <form
      className="shrink-0 border-t border-line bg-gunmetal p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {error && (
        <p className="mb-1.5 text-sm text-[#f19a92]" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input resize-none py-2.5 leading-snug"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary shrink-0" disabled={pending || text.trim() === ''}>
          Send
        </button>
      </div>
      {text.length > MESSAGE_MAX - 100 && (
        <p className="mt-1 text-right text-xs text-muted tabular-nums">
          {text.length} / {MESSAGE_MAX}
        </p>
      )}
    </form>
  );
}
