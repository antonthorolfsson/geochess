'use client';

import { indexDataset, type Dataset, type DatasetIndex, type GameView } from '@empire/rules';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Topology } from 'topojson-specification';
import { ApiError, api } from './api';

export const keys = {
  me: ['me'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaign', id] as const,
  invite: (code: string) => ['invite', code] as const,
  mapData: (version: string) => ['map-data', version] as const,
  /** Mutation key for saving a draft list, so bursts of edits can be told apart from other changes. */
  draftList: (campaignId: string) => ['draft-list', campaignId] as const,
  game: (gameId: string) => ['game', gameId] as const,
};

/** Don't retry answers the server meant, like 404 or 403. */
const retryServerErrors = (count: number, err: unknown) =>
  count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500);

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 5 * 60_000 });
}

export function useCampaigns(enabled: boolean) {
  return useQuery({ queryKey: keys.campaigns, queryFn: api.campaigns, enabled });
}

export function useCampaign(id: string) {
  return useQuery({ queryKey: keys.campaign(id), queryFn: () => api.campaign(id), retry: retryServerErrors });
}

/** A game as the board shows it: the server's view, and when it arrived, for running the clocks. */
export type BoardGame = GameView & { receivedAt: number };

export const toBoardGame = (game: GameView): BoardGame => ({ ...game, receivedAt: Date.now() });

/** The newer of two states of the same game, by the server's clock when it sent each. */
export function newerGame(current: BoardGame | undefined, incoming: BoardGame): BoardGame {
  if (!current) return incoming;
  return Date.parse(incoming.serverNow) >= Date.parse(current.serverNow) ? incoming : current;
}

/** A war game, kept current by `game.update` messages rather than refetching. */
export function useGame(gameId: string | null) {
  return useQuery({
    queryKey: keys.game(gameId ?? ''),
    enabled: Boolean(gameId),
    queryFn: async () => toBoardGame(await api.game(gameId!)),
    retry: retryServerErrors,
    staleTime: Infinity,
  });
}

/** Several games at once, e.g. to find the ones waiting for my move. */
export function useGames(gameIds: readonly string[]) {
  return useQueries({
    queries: gameIds.map((id) => ({
      queryKey: keys.game(id),
      queryFn: async () => toBoardGame(await api.game(id)),
      retry: retryServerErrors,
      staleTime: Infinity,
    })),
  });
}

export function useInvite(code: string) {
  return useQuery({ queryKey: keys.invite(code), queryFn: () => api.invite(code), retry: retryServerErrors });
}

export interface MapData {
  dataset: Dataset;
  idx: DatasetIndex;
  topo: Topology;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return (await res.json()) as T;
}

/** Country data and map shapes for a dataset version. Versions never change, so cache forever. */
export function useMapData(version: string | undefined) {
  return useQuery({
    queryKey: keys.mapData(version ?? ''),
    enabled: Boolean(version),
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<MapData> => {
      const [dataset, topo] = await Promise.all([
        fetchJson<Dataset>(`/datasets/${version}/territories.json`),
        fetchJson<Topology>(`/datasets/${version}/map.topo.json`),
      ]);
      return { dataset, idx: indexDataset(dataset), topo };
    },
  });
}
