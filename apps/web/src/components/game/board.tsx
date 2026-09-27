'use client';

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { useEffect, useRef } from 'react';

/**
 * Lichess's chessground board. `config` is applied whenever it changes; with `playPremove`, a
 * move queued while the opponent was thinking is played as soon as the new position arrives.
 */
export function Board({ config, playPremove = false }: { config: Config; playPremove?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const latest = useRef(config);
  useEffect(() => {
    latest.current = config;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cg = Chessground(el, latest.current);
    api.current = cg;
    // The board measures itself; panels can change size without the window resizing.
    const observer = new ResizeObserver(() => cg.redrawAll());
    observer.observe(el);
    return () => {
      observer.disconnect();
      cg.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    cg.set(config);
    if (playPremove) cg.playPremove();
  }, [config, playPremove]);

  return <div ref={ref} className="board-theme cg-wrap size-full" />;
}
