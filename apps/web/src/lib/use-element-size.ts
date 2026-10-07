'use client';

import { useCallback, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * A callback ref and the size of the element it's attached to, kept current as it resizes. `initial`
 * stands in until the first measurement.
 */
export function useElementSize(initial: () => Size): [(el: HTMLElement | null) => (() => void) | undefined, Size] {
  const [size, setSize] = useState(initial);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry!.contentRect.width);
      const height = Math.round(entry!.contentRect.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
