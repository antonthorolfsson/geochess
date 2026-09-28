'use client';

import { useEffect, useRef } from 'react';
import { useCampaignRoom } from '../campaign/room-context';
import { RulesGuide } from './rules-guide';

/** How to play, with this campaign's settings, over the campaign screen. */
export function CampaignRulesScreen() {
  const { model } = useCampaignRoom();
  const { campaign } = model;
  // The button that opened the page is now out of reach under it, so focus starts on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const host = model.membersById.get(campaign.hostId)?.name ?? 'The host';
  const settingsNote =
    campaign.status === 'lobby'
      ? `${host} picks these in the lobby and can change them until the draft starts.`
      : `${host} picked these in the lobby, and they're locked for the whole campaign.`;
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 pt-5 pb-10 lg:px-8">
      <header>
        <div className="label">Rules · {campaign.name}</div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-stencil text-[2rem] leading-tight tracking-wide focus:outline-none"
        >
          How to play
        </h1>
        <p className="text-[0.95rem] text-muted">
          Each round step by step, with the settings this campaign plays with.
        </p>
      </header>
      <RulesGuide variant="campaign" rules={campaign.rules} settingsNote={settingsNote} />
    </article>
  );
}
