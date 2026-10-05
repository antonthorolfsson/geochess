'use client';

import { TITLES, type TitleKind, type TitleView } from '@empire/rules';
import { createContext, useContext } from 'react';

/**
 * Who holds each title in the campaign on screen (mission rules version 5 on), so every player's
 * name can carry the tokens of the titles they hold (`PlayerName`). Empty outside a campaign.
 */
const TitlesContext = createContext<readonly TitleView[]>([]);

export const TitlesProvider = TitlesContext.Provider;

/** The titles a player holds, in the catalog's order. */
export function useTitlesOf(userId: string | undefined): TitleKind[] {
  const titles = useContext(TitlesContext);
  return userId ? titles.filter((t) => t.holderId === userId).map((t) => t.kind) : [];
}

/** A title's token: a gold coin, named for screen readers and on hover. */
export function TitleToken({ kind, size = 18, label = true }: { kind: TitleKind; size?: number; label?: boolean }) {
  const { name } = TITLES[kind];
  return (
    <img
      src={`/titles/${kind}.webp`}
      width={size}
      height={size}
      alt={label ? name : ''}
      title={label ? name : undefined}
      className="shrink-0 drop-shadow-[0_1px_1px_rgb(0_0_0/0.5)]"
      style={{ width: size, height: size }}
    />
  );
}

/** The tokens of the titles a player holds: overlapping like a stack of coins when small, side by side when large. */
export function TitleTokens({ titles, size = 18 }: { titles: readonly TitleKind[]; size?: number }) {
  if (titles.length === 0) return null;
  const overlap = size <= 18 ? Math.round(size * 0.3) : 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center ${overlap ? '' : 'gap-0.5'}`}
      role="list"
      aria-label="Titles held"
    >
      {titles.map((kind, i) => (
        <span
          key={kind}
          role="listitem"
          className="inline-flex rounded-full"
          style={i > 0 && overlap ? { marginLeft: -overlap } : undefined}
        >
          <TitleToken kind={kind} size={size} />
        </span>
      ))}
    </span>
  );
}
