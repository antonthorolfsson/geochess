'use client';

import { useEffect } from 'react';

/**
 * Keeps the page title while mounted. Next adds its own title element when the route changes
 * (ahead of the old one), so the title is set again whenever the head changes.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
