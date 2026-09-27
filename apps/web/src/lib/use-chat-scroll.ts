'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/** How close to the bottom counts as reading the newest messages. */
const NEAR_BOTTOM_PX = 96;

/**
 * Scrolling for a chat list with the newest entry at the bottom: it opens at the bottom, follows new
 * entries while the reader is there, and holds its place when older entries load above. A new
 * `listKey` (another filter or conversation) starts over at the bottom.
 */
export function useChatScroll(firstKey: string | null, lastKey: string | null, listKey = '') {
  const ref = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const previous = useRef<{ list: string; first: string | null; last: string | null; height: number } | null>(null);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = previous.current?.list === listKey ? previous.current : null;
    if (before && before.last === lastKey && before.first !== firstKey) {
      // Older entries arrived above: keep what the reader was looking at in place.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (!before || atBottom.current) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
    previous.current = { list: listKey, first: firstKey, last: lastKey, height: el.scrollHeight };
  }, [firstKey, lastKey, listKey]);

  /** After sending: jump to the newest entry. */
  const toBottom = useCallback(() => {
    atBottom.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return { ref, onScroll, toBottom };
}
