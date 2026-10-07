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

/**
 * Matches Tailwind's `lg` breakpoint, where the campaign screen leaves the phone layout (tabs along the
 * bottom) for columns beside the map. How many columns fit is `roomLayout`'s call.
 */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
