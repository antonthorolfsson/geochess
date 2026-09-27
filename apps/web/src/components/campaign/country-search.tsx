'use client';

import type { DatasetIndex, Territory, TerritoryId } from '@empire/rules';
import { useId, useMemo, useState } from 'react';
import { svgId } from '../hatch';
import { ValueBadge } from '../ui';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

interface Match {
  territory: Territory;
  /** The bundled or merged entity that matched, e.g. "Barbados" inside the Windward Islands. */
  via: string | null;
}

function search(idx: DatasetIndex, query: string): Match[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const starts: Match[] = [];
  const contains: Match[] = [];
  for (const t of idx.dataset.territories) {
    const name = normalize(t.name);
    if (name.startsWith(q) || t.id.toLowerCase() === q) starts.push({ territory: t, via: null });
    else if (name.includes(q)) contains.push({ territory: t, via: null });
    else {
      const member = t.members.find((m) => normalize(m.name).includes(q));
      if (member) contains.push({ territory: t, via: member.name });
    }
  }
  return [...starts, ...contains].slice(0, 8);
}

/** Type-ahead country finder: the keyboard- and small-country-friendly way around the map. */
export function CountrySearch({ idx, onPick }: { idx: DatasetIndex; onPick(id: TerritoryId): void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = svgId(useId());
  const results = useMemo(() => search(idx, query), [idx, query]);
  const expanded = open && results.length > 0;

  const choose = (id: TerritoryId) => {
    onPick(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative w-full">
      <input
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-label="Find a country"
        placeholder="Find a country"
        className="input bg-panel/95 shadow-lg backdrop-blur"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!expanded) return;
          if (e.key === 'ArrowDown') setActive((i) => (i + 1) % results.length);
          else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + results.length) % results.length);
          else if (e.key === 'Enter') choose(results[active]!.territory.id);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-[3px] border border-line-strong bg-panel shadow-xl"
        >
          {results.map(({ territory: t, via }, i) => (
            <li
              key={t.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(t.id)}
              className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 ${i === active ? 'bg-raised' : ''}`}
            >
              <span className="flex-1 truncate">
                {t.name}
                {via && <span className="text-sm text-muted"> · includes {via}</span>}
              </span>
              <ValueBadge value={t.value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
