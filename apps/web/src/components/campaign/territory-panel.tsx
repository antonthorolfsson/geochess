'use client';

import { PICK_REJECTION_MESSAGES, type StatKey, type Territory, type TerritoryId } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { formatArea, formatCount, formatUsd } from '@/lib/format';
import { keys } from '@/lib/queries';
import { EmpireSwatch } from '../hatch';
import { Notice, ValueBadge } from '../ui';
import { WarAction } from './declare-war';
import { DraftListButton } from './draft-list';
import { PlayerName } from './player-name';
import { useEmpireHref } from './room-context';
import type { StakePreview } from './war-detail';

const STAT_ROWS: { key: StatKey; label: string; format(n: number | null): string }[] = [
  { key: 'population', label: 'Population', format: formatCount },
  { key: 'gdpNominalUsd', label: 'GDP', format: formatUsd },
  { key: 'gdpPppUsd', label: 'GDP (PPP)', format: formatUsd },
  { key: 'areaKm2', label: 'Area', format: formatArea },
  { key: 'militarySpendingUsd', label: 'Military spending', format: formatUsd },
  { key: 'armedForces', label: 'Armed forces', format: formatCount },
];

const KIND_LABEL: Record<Territory['kind'], string> = {
  country: 'Country',
  territory: 'Territory',
  region: 'Region',
};

export function TerritoryPanel({
  model,
  territoryId,
  onSelect,
  onClose,
  onOpenWar,
  onPreview,
}: {
  model: CampaignModel;
  territoryId: TerritoryId;
  onSelect(id: TerritoryId): void;
  onClose(): void;
  onOpenWar(warId: string): void;
  onPreview(preview: StakePreview | null): void;
}) {
  const queryClient = useQueryClient();
  const campaignId = model.campaign.id;
  const claim = useMutation({
    mutationFn: () => api.pick(campaignId, territoryId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
  });
  const { reset } = claim;
  useEffect(() => reset(), [territoryId, reset]);
  const empireHref = useEmpireHref(campaignId);

  const t = model.idx.byId.get(territoryId);
  if (!t) return null;
  const ownerId = model.owners.get(t.id);
  const owner = ownerId ? model.membersById.get(ownerId) : undefined;
  const neighbors = [...t.land.map((id) => ({ id, sea: false })), ...t.sea.map((id) => ({ id, sea: true }))].sort(
    (a, b) => nameOf(model, a.id).localeCompare(nameOf(model, b.id)),
  );

  return (
    <section aria-label={t.name} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="label">
              {KIND_LABEL[t.kind]} · {t.subregion}
            </div>
            <h2 className="text-[1.7rem] leading-tight font-bold">{t.name}</h2>
          </div>
          <div className="flex shrink-0 flex-col items-center">
            <span className="label">Value</span>
            <ValueBadge value={t.value} className="h-9 min-w-9 text-xl" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center text-2xl text-muted hover:text-paper"
          >
            ×
          </button>
        </header>

        <div>
          <div className="label mb-1">Held by</div>
          {owner ? (
            <PlayerName member={owner} you={owner.userId === model.me.userId} href={empireHref(owner.userId)} />
          ) : (
            <span className="inline-flex items-center gap-2 text-muted">
              <span className="size-4 rounded-[2px] border border-line-strong bg-olive" aria-hidden="true" />
              Unclaimed
            </span>
          )}
        </div>

        <DraftAction
          model={model}
          territory={t}
          claimed={Boolean(owner)}
          onClaim={() => claim.mutate()}
          pending={claim.isPending}
        />
        {claim.error && <Notice tone="error">{errorMessage(claim.error)}</Notice>}
        {model.draftListOpen && !owner && <DraftListButton model={model} territoryId={t.id} />}
        <WarAction model={model} territory={t} onOpenWar={onOpenWar} onPreview={onPreview} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {STAT_ROWS.map(({ key, label, format }) => {
            const meta = t.statMeta[key];
            return (
              <div key={key} className="min-w-0">
                <dt className="label">{label}</dt>
                <dd className="truncate text-lg font-semibold tabular-nums">
                  {format(t.stats[key])}
                  {meta.estimated && t.stats[key] !== null && (
                    <abbr
                      title={meta.source}
                      className="ml-1 align-super text-[0.7rem] font-bold text-amber no-underline"
                    >
                      est.
                    </abbr>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {(t.terrain.length > 0 || t.members.length > 0) && (
          <div className="space-y-2 text-[0.95rem]">
            {t.terrain.length > 0 && (
              <p>
                <span className="label mr-2">Terrain</span>
                {t.terrain.map((tag) => (tag === 'mountains' ? 'Mountains' : 'Island')).join(', ')}
              </p>
            )}
            {t.members.length > 0 && (
              <p>
                <span className="label mr-2">Includes</span>
                {t.members.map((m) => m.name).join(', ')}
              </p>
            )}
          </div>
        )}

        <div>
          <div className="label mb-2">Borders</div>
          <ul className="flex flex-wrap gap-1.5">
            {neighbors.map(({ id, sea }) => {
              const color = model.ownerColors.get(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border border-line-strong px-2 text-[0.95rem] hover:bg-raised"
                  >
                    {color !== undefined ? (
                      <EmpireSwatch color={color} size={12} />
                    ) : (
                      <span className="size-3 rounded-[2px] bg-olive" aria-hidden="true" />
                    )}
                    {nameOf(model, id)}
                    {sea && (
                      <span className="text-xs text-muted" title="Across a sea lane">
                        by sea
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function nameOf(model: CampaignModel, id: TerritoryId): string {
  return model.idx.byId.get(id)?.name ?? id;
}

function DraftAction({
  model,
  territory,
  claimed,
  onClaim,
  pending,
}: {
  model: CampaignModel;
  territory: Territory;
  claimed: boolean;
  onClaim(): void;
  pending: boolean;
}) {
  if (model.campaign.status !== 'draft' || claimed) return null;
  if (model.myTurn) {
    if (model.legal?.has(territory.id)) {
      return (
        <button type="button" className="btn btn-amber w-full" onClick={onClaim} disabled={pending}>
          {pending ? 'Claiming…' : `Claim ${territory.name}`}
        </button>
      );
    }
    return (
      <Notice tone="amber">{PICK_REJECTION_MESSAGES['not-bordering']} Highlighted countries are open to you.</Notice>
    );
  }
  const picker = model.currentPicker;
  const wait = model.picksUntilMine;
  return (
    <p className="text-[0.95rem] text-muted">
      {picker ? `${picker.name} is picking.` : ''}{' '}
      {wait === null ? 'You have no picks left.' : `You're up in ${wait} ${wait === 1 ? 'pick' : 'picks'}.`}
    </p>
  );
}
