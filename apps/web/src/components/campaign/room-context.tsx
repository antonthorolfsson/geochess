'use client';

import type { TerritoryId } from '@empire/rules';
import { useSearchParams } from 'next/navigation';
import { createContext, useContext } from 'react';
import type { CampaignModel } from '@/lib/campaign';

/** What pages opened over the campaign screen (an empire's statistics) can use from it. */
export interface CampaignRoom {
  model: CampaignModel;
  /** Closes the page and shows the country on the map. */
  showCountry(id: TerritoryId): void;
}

const RoomContext = createContext<CampaignRoom | null>(null);

export const CampaignRoomProvider = RoomContext.Provider;

export function useCampaignRoom(): CampaignRoom {
  const room = useContext(RoomContext);
  if (!room) throw new Error('useCampaignRoom() is only available inside a campaign.');
  return room;
}

/**
 * Links to empires' statistics pages. They keep the address's query, so a panel open underneath (a
 * war being answered, a conversation) stays as it was for the way back.
 */
export function useEmpireHref(campaignId: string): (userId: string) => string {
  const query = useSearchParams().toString();
  return (userId) => `/c/${campaignId}/empire/${userId}${query ? `?${query}` : ''}`;
}

/** The link to every empire compared, keeping the address's query like `useEmpireHref`. */
export function useCompareHref(campaignId: string): string {
  const query = useSearchParams().toString();
  return `/c/${campaignId}/compare${query ? `?${query}` : ''}`;
}
