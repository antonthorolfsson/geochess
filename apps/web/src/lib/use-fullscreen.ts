'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What fills the screen, if anything. The page lays it out over everything else; where the browser
 * allows it (not on iPhones), the browser's own full screen hides its bars too. Leaving the
 * browser's full screen (Escape, a swipe) leaves ours, and Escape leaves ours where there's no
 * browser full screen.
 */
export function useFullscreen<T extends string>() {
  const [mode, setMode] = useState<T | null>(null);
  // Whether we asked the browser for full screen, so we only leave what we entered.
  const requested = useRef(false);

  const exit = useCallback(() => {
    setMode(null);
    if (requested.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    requested.current = false;
  }, []);

  const enter = useCallback((next: T) => {
    setMode(next);
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      requested.current = true;
      void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        requested.current = false;
      });
    }
  }, []);

  useEffect(() => {
    if (mode === null) return;
    const onChange = () => {
      if (!document.fullscreenElement && requested.current) {
        requested.current = false;
        setMode(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement && !e.defaultPrevented) setMode(null);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  return { mode, enter, exit, setMode };
}
