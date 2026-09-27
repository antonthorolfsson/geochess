'use client';

import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Matches Tailwind's `lg` breakpoint, where the campaign screen switches to three columns. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
