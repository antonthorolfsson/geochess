'use client';

import type { AutodraftFallback, CampaignView, DraftListStatus, TerritoryId } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { Notice, Toggle, ValueBadge } from '../ui';

/**
 * Edits the player's draft list. Changes show at once and save in order in the background; the
 * server drops anything already claimed.
 */
export function useDraftListEditor(model: CampaignModel) {
  const campaignId = model.campaign.id;
  const list = model.draftList.map((entry) => entry.id);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationKey: keys.draftList(campaignId),
    scope: { id: `draft-list-${campaignId}` },
    mutationFn: (next: TerritoryId[]) => api.setDraftList(campaignId, next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: keys.campaign(campaignId) });
      queryClient.setQueryData<CampaignView>(keys.campaign(campaignId), (old) => old && { ...old, myDraftList: next });
    },
    onSettled: () => {
      // Resync once the last of a burst of edits has landed.
      if (queryClient.isMutating({ mutationKey: keys.draftList(campaignId) }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
      }
    },
  });

  return {
    list,
    error: save.error,
    has: (id: TerritoryId) => list.includes(id),
    position: (id: TerritoryId) => list.indexOf(id) + 1,
    add: (id: TerritoryId) => save.mutate([...list.filter((x) => x !== id), id]),
    remove: (id: TerritoryId) => save.mutate(list.filter((x) => x !== id)),
    move: (id: TerritoryId, by: number) => {
      const from = list.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= list.length) return;
      const next = [...list];
      next.splice(to, 0, ...next.splice(from, 1));
      save.mutate(next);
    },
  };
}

const STATUS_NOTE: Partial<Record<DraftListStatus, { text: string; className: string }>> = {
  next: { text: 'Next', className: 'text-amber' },
  'not-bordering': { text: 'Not bordering yet', className: 'text-muted' },
  claimed: { text: 'Claimed', className: 'text-faint line-through' },
};

const FALLBACK_OPTIONS: { value: AutodraftFallback; label: string }[] = [
  { value: 'best', label: 'Keep picking: the most valuable country I can claim' },
  { value: 'wait', label: 'Stop and wait for me to pick' },
];

/** The draft list and the auto-draft settings that work through it. */
export function DraftListSection({ model, onSelect }: { model: CampaignModel; onSelect(id: TerritoryId): void }) {
  const editor = useDraftListEditor(model);
  const queryClient = useQueryClient();
  const settings = useMutation({
    mutationFn: (input: { autodraft?: boolean; autodraftFallback?: AutodraftFallback }) =>
      api.updateMembership(model.campaign.id, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });
  const fallbackGroup = useId();
  const error = settings.error ?? editor.error;

  return (
    <section className="space-y-3">
      <Toggle
        checked={model.me.autodraft}
        disabled={settings.isPending}
        onChange={(on) => settings.mutate({ autodraft: on })}
        label="Auto-draft"
        description="Pick for me when it's my turn: the first country on my draft list I can claim, skipping any that are taken."
      />
      <div role="radiogroup" aria-labelledby={`${fallbackGroup}-label`} className="border-l-2 border-line pl-3">
        <div id={`${fallbackGroup}-label`} className="label">
          When my list runs out
        </div>
        {FALLBACK_OPTIONS.map((option) => (
          <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.95rem]">
            <input
              type="radio"
              name={fallbackGroup}
              className="size-4 shrink-0 accent-amber"
              checked={model.autodraftFallback === option.value}
              disabled={settings.isPending}
              onChange={() => settings.mutate({ autodraftFallback: option.value })}
            />
            {option.label}
          </label>
        ))}
      </div>
      <div>
        <h2 className="label mb-2">Draft list{model.draftList.length > 0 ? ` · ${model.draftList.length}` : ''}</h2>
        {model.draftList.length === 0 ? (
          <p className="rounded-[3px] border border-dashed border-line-strong p-3 text-[0.95rem] text-muted">
            Line up the countries you want next: select one on the map and choose “Add to draft list”. Only you can see
            your list.
          </p>
        ) : (
          <ol className="divide-y divide-line rounded-[3px] border border-line">
            {model.draftList.map(({ id, status }, i) => {
              const t = model.idx.byId.get(id);
              const note = STATUS_NOTE[status];
              return (
                <li key={id} className="flex min-h-11 items-center gap-1 pl-3">
                  <span className="w-5 shrink-0 text-sm text-faint tabular-nums">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    className="min-w-0 flex-1 truncate py-2 text-left hover:underline"
                  >
                    {t?.name ?? id}
                    {note && <span className={`ml-2 text-xs font-bold uppercase ${note.className}`}>{note.text}</span>}
                  </button>
                  <ValueBadge value={t?.value ?? 0} className="shrink-0" />
                  <ListButton label={`Move ${t?.name ?? id} up`} disabled={i === 0} onClick={() => editor.move(id, -1)}>
                    ↑
                  </ListButton>
                  <ListButton
                    label={`Move ${t?.name ?? id} down`}
                    disabled={i === model.draftList.length - 1}
                    onClick={() => editor.move(id, 1)}
                  >
                    ↓
                  </ListButton>
                  <ListButton label={`Remove ${t?.name ?? id}`} onClick={() => editor.remove(id)}>
                    ×
                  </ListButton>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </section>
  );
}

function ListButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center text-lg text-muted hover:text-paper disabled:opacity-25"
    >
      {children}
    </button>
  );
}

/** Adds the selected country to the draft list, or shows its place there. */
export function DraftListButton({ model, territoryId }: { model: CampaignModel; territoryId: TerritoryId }) {
  const editor = useDraftListEditor(model);
  const position = editor.position(territoryId);
  if (position === 0) {
    return (
      <button type="button" className="btn btn-ghost w-full" onClick={() => editor.add(territoryId)}>
        Add to draft list
      </button>
    );
  }
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-[3px] border border-line px-3">
      <span className="flex-1 text-[0.95rem]">
        <span className="font-bold text-amber tabular-nums">#{position}</span> on your draft list
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => editor.remove(territoryId)}>
        Remove
      </button>
    </div>
  );
}
