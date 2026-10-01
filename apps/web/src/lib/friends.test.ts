import type { CampaignSummary, FriendView } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import { friendGroups, seatsNote, togetherText } from './friends';

const friend = (userId: string, campaignIds: string[]): FriendView => ({
  userId,
  name: userId.toUpperCase(),
  lichessUsername: null,
  campaignIds,
});

const campaign = (id: string, day: number): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  status: 'active',
  round: 1,
  hostId: 'me',
  memberCount: 3,
  maxPlayers: 8,
  myColor: 0,
  currentPicker: null,
  attention: 0,
  unread: 0,
  createdAt: new Date(Date.UTC(2026, 8, day)).toISOString(),
});

describe('friend groups', () => {
  it('offers the friends of each campaign, newest first, once per group', () => {
    const friends = [friend('ann', ['c1', 'c2', 'c3']), friend('bo', ['c2', 'c3']), friend('cy', ['c1'])];
    const campaigns = [campaign('c1', 1), campaign('c3', 3), campaign('c2', 2), campaign('solo', 4)];
    expect(friendGroups(friends, campaigns)).toEqual([
      { campaignId: 'c3', name: 'Campaign c3', userIds: ['ann', 'bo'] },
      { campaignId: 'c1', name: 'Campaign c1', userIds: ['ann', 'cy'] },
    ]);
    expect(friendGroups(friends, campaigns, 1).map((g) => g.campaignId)).toEqual(['c3']);
    expect(friendGroups([], campaigns)).toEqual([]);
  });
});

describe('seats', () => {
  it('says who gets a seat when more friends are invited than seats are free', () => {
    expect(seatsNote(3, 3)).toBeNull();
    expect(seatsNote(5, 3)).toBe('5 friends for 3 free seats: the first 3 to join get them.');
    expect(seatsNote(2, 1)).toBe('2 friends for 1 free seat: the first to join gets it.');
    expect(seatsNote(1, 0)).toBe('Every seat is taken: raise the player limit to make room.');
  });

  it('counts campaigns played together', () => {
    expect(togetherText(friend('ann', []))).toBe('Not in a campaign together yet');
    expect(togetherText(friend('ann', ['c1']))).toBe('1 campaign together');
    expect(togetherText(friend('ann', ['c1', 'c2']))).toBe('2 campaigns together');
  });
});
