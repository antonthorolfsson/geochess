'use client';

import { DEFAULT_BOT_LEVEL, botLevel, type MemberView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { BotLevelSelect } from './bot-level-select';

/** A change to who plays an empire, with the campaign read again after. */
function useSeatChange(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) }),
  });
}

/** For a player whose empire a bot is playing: say so, and let them take it back. */
export function StandInBanner({ model }: { model: CampaignModel }) {
  const { me, campaign } = model;
  const change = useSeatChange(campaign.id);
  if (!me.bot?.standIn) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber/40 bg-amber/10 px-3 py-2" role="status">
      <p className="min-w-0 flex-1 text-[0.95rem]">
        A level {me.bot.level} bot is playing your empire while you’re away. You can still read everything and chat.
        {change.error && <span className="block text-sm text-[#ef7b72]">{errorMessage(change.error)}</span>}
      </p>
      <button
        type="button"
        className="btn btn-amber btn-sm shrink-0"
        disabled={change.isPending}
        onClick={() => change.mutate(() => api.takeBack(campaign.id, me.userId))}
      >
        Take it back
      </button>
    </div>
  );
}

/**
 * On a player's empire page, for the host: hand the empire to a bot when the player has gone
 * quiet, or hand it back. Nothing for anyone else, the host's own empire, or a bot of its own.
 */
export function StandInControls({ model, member }: { model: CampaignModel; member: MemberView }) {
  const { campaign, isHost, me } = model;
  const [level, setLevel] = useState(DEFAULT_BOT_LEVEL);
  const change = useSeatChange(campaign.id);
  const underway = campaign.status === 'draft' || campaign.status === 'selection' || campaign.status === 'active';
  if (!isHost || member.userId === me.userId || (member.bot && !member.bot.standIn)) return null;
  const error = change.error && <p className="mt-2 text-sm text-[#ef7b72]">{errorMessage(change.error)}</p>;
  if (member.bot) {
    return (
      <section className="max-w-md rounded-[3px] border border-line p-3">
        <p className="mb-2 text-[0.95rem]">
          A level {member.bot.level} bot ({botLevel(member.bot.level).name.toLowerCase()}) is playing this empire for{' '}
          {member.name}.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={change.isPending}
          onClick={() => change.mutate(() => api.takeBack(campaign.id, member.userId))}
        >
          Hand back to {member.name}
        </button>
        {error}
      </section>
    );
  }
  if (!underway) return null;
  return (
    <section className="max-w-md rounded-[3px] border border-line p-3">
      <h2 className="mb-1 font-semibold">If {member.name} has gone quiet</h2>
      <p className="mb-2 text-sm text-muted">
        A bot can play this empire, answering wars and moving in its games, until {member.name} takes it back or you
        hand it back.
      </p>
      <BotLevelSelect label="Level of the bot" value={level} onChange={setLevel} />
      <button
        type="button"
        className="btn btn-ghost w-full"
        disabled={change.isPending}
        onClick={() => {
          if (confirm(`Hand ${member.name}’s empire to a level ${level} bot?`)) {
            change.mutate(() => api.standIn(campaign.id, member.userId, { level }));
          }
        }}
      >
        Hand to a bot
      </button>
      {error}
    </section>
  );
}
