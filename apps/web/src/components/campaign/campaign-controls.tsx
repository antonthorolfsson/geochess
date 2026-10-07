'use client';

import { FINISHED_CAMPAIGN_KEPT_DAYS, lastRoundOf } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { formatDay } from '@/lib/format';
import { keys } from '@/lib/queries';
import { seasonEndText, sentenceCase } from '@/lib/rules-text';
import { Notice } from '../ui';

/**
 * For the host once the draft has started (the lobby has its own): end an Objectives campaign now,
 * on points, or delete the campaign for everyone. In the last round, the war room's Next round
 * already ends it. Nothing for anyone else.
 */
export function CampaignControls({ model }: { model: CampaignModel }) {
  const { campaign, isHost } = model;
  const router = useRouter();
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => api.endCampaign(campaign.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCampaign(campaign.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push('/campaigns');
    },
  });
  if (!isHost || campaign.status === 'lobby') return null;

  const { rules, round, status } = campaign;
  const objectives = rules.victory.mode === 'objectives';
  const last = lastRoundOf(rules);
  const canEnd = status === 'active' && objectives && (last === null || round < last);
  const underway = model.activeWars.length;
  const calledOff =
    underway > 0
      ? ` ${underway} ${underway === 1 ? 'war still underway is' : 'wars still underway are'} called off.`
      : '';
  const finished = status === 'finished';
  const note = finished
    ? campaign.deleteAt
      ? `It is deleted for everyone on ${formatDay(campaign.deleteAt)}. You can delete it sooner.`
      : null
    : canEnd
      ? `Ending it now gives the victory as the last round would: ${seasonEndText(rules)}. Everyone sees the results for ${FINISHED_CAMPAIGN_KEPT_DAYS} days, then it is deleted.`
      : status === 'active' && !objectives
        ? 'An open-ended campaign plays on until you delete it.'
        : null;
  const error = end.error ?? remove.error;

  return (
    <section className="space-y-2 border-t border-line pt-4">
      <h2 className="label">Campaign</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {canEnd && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={end.isPending || remove.isPending}
            onClick={() => {
              const question = `End the campaign now, in round ${round}${last !== null ? ` of ${last}` : ''}? ${sentenceCase(
                seasonEndText(rules),
              )}.${calledOff}`;
              if (confirm(question)) end.mutate();
            }}
          >
            End the campaign
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={end.isPending || remove.isPending}
          onClick={() => {
            const question = finished
              ? 'Delete this campaign and its results for everyone now? This cannot be undone.'
              : `Delete this campaign for everyone? The map, wars, games and messages all go, and this cannot be undone.${
                  canEnd ? ' To finish it on points instead, end the campaign.' : ''
                }`;
            if (confirm(question)) remove.mutate();
          }}
        >
          Delete campaign
        </button>
      </div>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </section>
  );
}
