'use client';

import type { AccordTally, CountryChange, TerritoryId, WarRecord, WarTally } from '@empire/rules';
import Link from 'next/link';
import { useState } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { playerName } from '@/lib/wars';
import { ValueBadge } from '../ui';

/** Rows of the record; the rarer outcomes only show once they've happened. */
const OUTCOMES: { key: keyof WarTally; label: string; always?: boolean }[] = [
  { key: 'won', label: 'Won', always: true },
  { key: 'drawn', label: 'Drawn', always: true },
  { key: 'lost', label: 'Lost', always: true },
  { key: 'tribute', label: 'Settled by tribute' },
  { key: 'settled', label: 'Ended by peace terms' },
  { key: 'withdrawn', label: 'Called off' },
  { key: 'cancelled', label: 'Cut short by the end' },
  { key: 'underway', label: 'Underway' },
];

const totalOf = (t: WarTally) => OUTCOMES.reduce((sum, { key }) => sum + t[key], 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Wars from both sides, the countries they moved, and accords kept and broken. */
export function WarRecordView({
  model,
  record,
  accords,
  reputation,
  onShowCountry,
}: {
  model: CampaignModel;
  record: WarRecord;
  accords: AccordTally;
  reputation: number;
  onShowCountry(id: TerritoryId): void;
}) {
  const fought = totalOf(record.attacking) + totalOf(record.defending);
  return (
    <div className="space-y-5">
      {fought === 0 ? (
        <p className="text-[0.95rem] text-muted">No wars yet.</p>
      ) : (
        <table className="w-full text-[0.95rem] tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Outcome
              </th>
              <th scope="col" className="label pb-1 text-right">
                Attacking
              </th>
              <th scope="col" className="label pb-1 pl-4 text-right">
                Defending
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {OUTCOMES.map(({ key, label, always }) =>
              !always && record.attacking[key] + record.defending[key] === 0 ? null : (
                <tr key={key}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {label}
                  </th>
                  <td className="py-1.5 text-right">{record.attacking[key]}</td>
                  <td className="py-1.5 pl-4 text-right">{record.defending[key]}</td>
                </tr>
              ),
            )}
            <tr className="font-semibold">
              <th scope="row" className="py-1.5 text-left">
                Wars
              </th>
              <td className="py-1.5 text-right">{totalOf(record.attacking)}</td>
              <td className="py-1.5 pl-4 text-right">{totalOf(record.defending)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {(record.tokensTaken > 0 || record.tokensPaid > 0) && (
        <p className="text-[0.95rem] text-muted">
          War tokens as tribute or in peace terms: {record.tokensTaken} taken, {record.tokensPaid} paid.
        </p>
      )}

      <Changes
        model={model}
        title="Countries won"
        changes={record.gained}
        direction="from"
        onShowCountry={onShowCountry}
      />
      <Changes
        model={model}
        title="Countries lost"
        changes={record.lost}
        direction="to"
        onShowCountry={onShowCountry}
      />

      <div>
        <h3 className="label mb-2">Accords</h3>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
          {(
            [
              ['Reputation', reputation],
              ['Signed', accords.signed],
              ['In force', accords.inForce],
              ['Kept', accords.kept],
              ['Broken', accords.broken],
              ['Betrayed', accords.betrayed],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="min-w-0">
              <dt className="label" title={label === 'Betrayed' ? 'Accords the partner renounced' : undefined}>
                {label}
              </dt>
              <dd className="text-lg font-semibold">{n}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const SHORT_LIST = 6;

function Changes({
  model,
  title,
  changes,
  direction,
  onShowCountry,
}: {
  model: CampaignModel;
  title: string;
  changes: CountryChange[];
  direction: 'from' | 'to';
  onShowCountry(id: TerritoryId): void;
}) {
  const [all, setAll] = useState(false);
  if (changes.length === 0) return null;
  const newest = [...changes].reverse();
  const shown = all ? newest : newest.slice(0, SHORT_LIST);
  const value = changes.reduce((sum, c) => sum + (model.idx.byId.get(c.territoryId)?.value ?? 0), 0);
  return (
    <div>
      <h3 className="label mb-2">
        {title} · {plural(changes.length, 'country', 'countries')}, worth {value}
      </h3>
      <ul className="divide-y divide-line rounded-[3px] border border-line">
        {shown.map((c) => {
          const t = model.idx.byId.get(c.territoryId);
          return (
            <li key={`${c.warId}-${c.territoryId}`} className="flex min-h-11 items-center gap-3 px-3 py-1">
              <button
                type="button"
                onClick={() => onShowCountry(c.territoryId)}
                className="min-w-0 truncate text-left font-semibold underline decoration-line-strong underline-offset-2 hover:decoration-paper"
              >
                {t?.name ?? c.territoryId}
              </button>
              {t && <ValueBadge value={t.value} />}
              <span className="min-w-0 flex-1 truncate text-sm text-muted">
                {direction} {playerName(model, c.otherId)} · round {c.round}
                {c.via === 'tribute' ? ' · tribute' : c.via === 'peace' ? ' · peace terms' : ''}
              </span>
              <Link
                href={`/c/${model.campaign.id}?war=${c.warId}`}
                className="shrink-0 text-sm text-muted underline decoration-line-strong underline-offset-2 hover:text-paper"
              >
                War
              </Link>
            </li>
          );
        })}
      </ul>
      {changes.length > SHORT_LIST && (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${changes.length}`}
        </button>
      )}
    </div>
  );
}
