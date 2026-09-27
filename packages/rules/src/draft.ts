import type { CampaignRules } from './config';
import type { TerritoryId } from './dataset';
import { bordersAny, type DatasetIndex } from './graph';

export type UserId = string;

/** Current owner of each claimed territory. */
export type Owners = ReadonlyMap<TerritoryId, UserId>;

export interface DraftSnapshot {
  /** Player order for the first round. The snake draft reverses it every other round. */
  order: readonly UserId[];
  /** Zero-based index of the next pick. */
  pickIndex: number;
  owners: Owners;
}

/** A full-map draft: it ends when every territory has been claimed. */
export function totalDraftPicks(idx: DatasetIndex): number {
  return idx.ids.length;
}

export function isDraftComplete(idx: DatasetIndex, pickIndex: number): boolean {
  return pickIndex >= totalDraftPicks(idx);
}

/** Who makes pick number `pickIndex` in a snake draft: A B C, C B A, A B C, ... */
export function pickerAt(order: readonly UserId[], pickIndex: number): UserId {
  const n = order.length;
  if (n === 0) throw new Error('Draft order is empty');
  const round = Math.floor(pickIndex / n);
  const pos = pickIndex % n;
  return order[round % 2 === 0 ? pos : n - 1 - pos]!;
}

/** One-based draft round that pick `pickIndex` belongs to. */
export function draftRoundOf(pickIndex: number, players: number): number {
  return Math.floor(pickIndex / players) + 1;
}

/** The pickers for the next `count` picks, starting at `pickIndex`, stopping when the draft ends. */
export function upcomingPickers(
  order: readonly UserId[],
  pickIndex: number,
  count: number,
  totalPicks: number,
): UserId[] {
  const out: UserId[] = [];
  for (let i = pickIndex; i < Math.min(pickIndex + count, totalPicks); i++) out.push(pickerAt(order, i));
  return out;
}

/** How many picks until it is `userId`'s turn (0 = their turn now), or null if they have no picks left. */
export function picksUntilTurn(
  order: readonly UserId[],
  pickIndex: number,
  totalPicks: number,
  userId: UserId,
): number | null {
  for (let i = pickIndex; i < totalPicks; i++) if (pickerAt(order, i) === userId) return i - pickIndex;
  return null;
}

export function holdingsOf(owners: Owners, userId: UserId): Set<TerritoryId> {
  const out = new Set<TerritoryId>();
  for (const [id, owner] of owners) if (owner === userId) out.add(id);
  return out;
}

/** Territories `userId` may claim when it is their turn. */
export function legalPicks(idx: DatasetIndex, rules: CampaignRules, owners: Owners, userId: UserId): TerritoryId[] {
  const free = idx.ids.filter((id) => !owners.has(id));
  if (rules.draft.mode === 'free') return free;
  const mine = holdingsOf(owners, userId);
  if (mine.size === 0) return free;
  const bordering = free.filter((id) => bordersAny(idx, id, mine));
  return bordering.length > 0 ? bordering : free;
}

export type PickRejection =
  'draft-complete' | 'not-your-turn' | 'unknown-territory' | 'already-claimed' | 'not-bordering';

export const PICK_REJECTION_MESSAGES: Record<PickRejection, string> = {
  'draft-complete': 'The draft is over.',
  'not-your-turn': "It's not your pick.",
  'unknown-territory': 'That country is not on this map.',
  'already-claimed': 'That country has already been claimed.',
  'not-bordering': 'You must claim a country bordering your empire.',
};

/** Why `userId` may not claim `territoryId` right now, or null if the pick is legal. */
export function checkPick(
  idx: DatasetIndex,
  rules: CampaignRules,
  draft: DraftSnapshot,
  userId: UserId,
  territoryId: TerritoryId,
): PickRejection | null {
  if (isDraftComplete(idx, draft.pickIndex)) return 'draft-complete';
  if (pickerAt(draft.order, draft.pickIndex) !== userId) return 'not-your-turn';
  if (!idx.byId.has(territoryId)) return 'unknown-territory';
  if (draft.owners.has(territoryId)) return 'already-claimed';
  if (!legalPicks(idx, rules, draft.owners, userId).includes(territoryId)) return 'not-bordering';
  return null;
}

/**
 * The pick auto-draft makes: the most valuable legal country, preferring ones that border the
 * player's empire, then larger populations, then alphabetical id. Deterministic.
 */
export function suggestPick(
  idx: DatasetIndex,
  rules: CampaignRules,
  owners: Owners,
  userId: UserId,
): TerritoryId | null {
  const mine = holdingsOf(owners, userId);
  let best: { id: TerritoryId; key: [number, number, number] } | null = null;
  for (const id of legalPicks(idx, rules, owners, userId)) {
    const t = idx.byId.get(id)!;
    const key: [number, number, number] = [t.value, bordersAny(idx, id, mine) ? 1 : 0, t.stats.population ?? 0];
    if (!best || compareKeys(key, best.key) > 0 || (compareKeys(key, best.key) === 0 && id < best.id)) {
      best = { id, key };
    }
  }
  return best?.id ?? null;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** The most countries a player can line up on their draft list. */
export const DRAFT_LIST_LIMIT = 100;

/**
 * What auto-draft does once nothing on a player's draft list can be claimed:
 * - `best`: keep picking, taking the `suggestPick` choice.
 * - `wait`: stop and leave the pick to the player.
 */
export const AUTODRAFT_FALLBACKS = ['best', 'wait'] as const;
export type AutodraftFallback = (typeof AUTODRAFT_FALLBACKS)[number];

/**
 * The pick made on a player's behalf (auto-draft, "pick for me", or the host picking for them):
 * the first country on their draft list they may claim now, skipping ones already claimed or not
 * yet bordering their empire. If nothing on the list can be claimed, the `suggestPick` choice, or
 * null with the `wait` fallback.
 */
export function autoPick(
  idx: DatasetIndex,
  rules: CampaignRules,
  owners: Owners,
  userId: UserId,
  draftList: readonly TerritoryId[],
  fallback: AutodraftFallback = 'best',
): TerritoryId | null {
  const legal = new Set(legalPicks(idx, rules, owners, userId));
  const listed = draftList.find((id) => legal.has(id));
  if (listed) return listed;
  return fallback === 'best' ? suggestPick(idx, rules, owners, userId) : null;
}

/**
 * - `next`: what an automatic pick would take now.
 * - `available`: claimable, further down the list.
 * - `not-bordering`: free, but contiguous drafting rules it out for now.
 * - `claimed`: taken by someone.
 */
export type DraftListStatus = 'next' | 'available' | 'not-bordering' | 'claimed';

/** Where each country on a draft list stands right now. */
export function draftListStatus(
  idx: DatasetIndex,
  rules: CampaignRules,
  owners: Owners,
  userId: UserId,
  draftList: readonly TerritoryId[],
): { id: TerritoryId; status: DraftListStatus }[] {
  const legal = new Set(legalPicks(idx, rules, owners, userId));
  let nextFound = false;
  return draftList.map((id) => {
    if (owners.has(id)) return { id, status: 'claimed' };
    if (!legal.has(id)) return { id, status: 'not-bordering' };
    if (nextFound) return { id, status: 'available' };
    nextFound = true;
    return { id, status: 'next' };
  });
}

/** A draft list without unknown, repeated or already-claimed countries, capped at the limit. */
export function normalizeDraftList(idx: DatasetIndex, owners: Owners, ids: readonly string[]): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (const id of ids) {
    if (out.length === DRAFT_LIST_LIMIT) break;
    if (idx.byId.has(id) && !owners.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Fisher–Yates shuffle with an injectable random source (server passes a crypto-backed one). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
