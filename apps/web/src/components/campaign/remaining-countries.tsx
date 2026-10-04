'use client';

import { legalPicks, type TerritoryId } from '@empire/rules';
import { useMemo, useState } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { ValueBadge } from '../ui';
import { useDraftListEditor } from './draft-list';

type Order = 'value' | 'name';

/**
 * Every country still to be drafted. Picking one flies the map to it and opens its panel, where it
 * can be claimed; "+" lines it up on the draft list.
 */
export function RemainingCountries({ model, onSelect }: { model: CampaignModel; onSelect(id: TerritoryId): void }) {
  const { idx, owners, campaign } = model;
  const editor = useDraftListEditor(model);
  const [order, setOrder] = useState<Order>('value');
  const [query, setQuery] = useState('');
  const [claimableOnly, setClaimableOnly] = useState(false);

  const free = useMemo(() => idx.ids.filter((id) => !owners.has(id)), [idx, owners]);
  // Whether or not it's the player's pick: what they could claim if it were.
  const claimable = useMemo(
    () => new Set(legalPicks(idx, campaign.rules, owners, model.me.userId)),
    [idx, campaign.rules, owners, model.me.userId],
  );
  const restricted = claimable.size < free.length;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return free
      .flatMap((id) => idx.byId.get(id) ?? [])
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .filter((t) => !(restricted && claimableOnly) || claimable.has(t.id))
      .sort((a, b) => (order === 'value' ? b.value - a.value : 0) || a.name.localeCompare(b.name));
  }, [free, idx, query, restricted, claimableOnly, claimable, order]);

  if (free.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 className="label">Countries left · {free.length}</h2>
        <div className="flex overflow-hidden rounded-[3px] border border-line" role="group" aria-label="Sort by">
          {(['value', 'name'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={order === o}
              onClick={() => setOrder(o)}
              className={`min-h-9 px-3 text-sm font-bold ${order === o ? 'bg-paper text-gunmetal' : 'text-muted hover:text-paper'}`}
            >
              {o === 'value' ? 'Value' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="sr-only">Filter the countries left</span>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {restricted && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.95rem]">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-amber"
            checked={claimableOnly}
            onChange={(e) => setClaimableOnly(e.target.checked)}
          />
          Only countries bordering my empire ({claimable.size})
        </label>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No country left matches.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-[3px] border border-line">
          {rows.map((t) => {
            const open = !restricted || claimable.has(t.id);
            const position = editor.position(t.id);
            return (
              <li key={t.id} className="flex min-h-11 items-center gap-2 pl-3">
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={`min-w-0 flex-1 py-1.5 text-left hover:underline ${open ? '' : 'text-muted'}`}
                >
                  <span className="block truncate">{t.name}</span>
                  <span className="block truncate text-xs text-faint">
                    {t.subregion}
                    {open ? '' : ' · not bordering yet'}
                  </span>
                </button>
                <ValueBadge value={t.value} className="shrink-0" />
                {position > 0 ? (
                  <span
                    className="flex size-11 shrink-0 items-center justify-center text-sm font-bold text-amber tabular-nums"
                    title={`#${position} on your draft list`}
                  >
                    #{position}
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Add ${t.name} to the draft list`}
                    title="Add to draft list"
                    onClick={() => editor.add(t.id)}
                    className="flex size-11 shrink-0 items-center justify-center text-lg text-muted hover:text-paper"
                  >
                    +
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
