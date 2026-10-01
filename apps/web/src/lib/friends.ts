import type { CampaignSummary, FriendView } from '@empire/rules';

/** Friends to pick at once: the ones from one of the player's campaigns. */
export interface FriendGroup {
  campaignId: string;
  name: string;
  userIds: string[];
}

/**
 * The player's campaigns with friends in them, newest first, as groups to invite again. A campaign
 * with the same friends as a newer one is left out.
 */
export function friendGroups(
  friends: readonly FriendView[],
  campaigns: readonly CampaignSummary[],
  limit = 4,
): FriendGroup[] {
  const groups: FriendGroup[] = [];
  const seen = new Set<string>();
  const newestFirst = [...campaigns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const c of newestFirst) {
    if (groups.length === limit) break;
    const userIds = friends.filter((f) => f.campaignIds.includes(c.id)).map((f) => f.userId);
    const key = [...userIds].sort().join('\n');
    if (userIds.length === 0 || seen.has(key)) continue;
    seen.add(key);
    groups.push({ campaignId: c.id, name: c.name, userIds });
  }
  return groups;
}

/** A word on seats, when more friends are invited than there are seats free for them. */
export function seatsNote(invited: number, free: number): string | null {
  if (invited <= free) return null;
  if (free <= 0) return 'Every seat is taken: raise the player limit to make room.';
  const first = free === 1 ? 'the first to join gets it' : `the first ${free} to join get them`;
  return `${invited} friends for ${free} free ${free === 1 ? 'seat' : 'seats'}: ${first}.`;
}

/** "3 campaigns together", or how they became friends when they haven't played. */
export function togetherText(friend: FriendView): string {
  const n = friend.campaignIds.length;
  if (n === 0) return 'Not in a campaign together yet';
  return `${n} ${n === 1 ? 'campaign' : 'campaigns'} together`;
}
