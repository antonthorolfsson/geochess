'use client';

import { useEffect } from 'react';

/** Pages that render once their data arrives miss the browser's own jump to the address's #section. */
export function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
}
