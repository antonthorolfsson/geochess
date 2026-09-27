import type { UserId } from './draft';
import type { CampaignStatus, FeedFilter, FeedItem } from './protocol';

/** Accord lengths a proposer can choose, in rounds. */
export const ACCORD_MIN_ROUNDS = 1;
export const ACCORD_MAX_ROUNDS = 10;
export const ACCORD_DEFAULT_ROUNDS = 3;
/** Longest free-text terms an accord can carry. Terms are public and not enforced. */
export const ACCORD_TERMS_MAX = 280;

/** Every player's reputation when a campaign starts. */
export const REPUTATION_START = 100;
/** Reputation lost for renouncing an accord before it runs its course. */
export const REPUTATION_BROKEN = -20;
/** Reputation each partner gains when an accord runs its course. */
export const REPUTATION_KEPT = 5;

/** Longest chat message, in characters. */
export const MESSAGE_MAX = 1000;

/**
 * - `proposed`: waiting for the recipient's answer. Private to the two players.
 * - `declined`, `withdrawn`, `lapsed` (no answer in time): a proposal that came to nothing. Private.
 * - `active`: signed and in force. Public from here on.
 * - `kept`: ran its course.
 * - `broken`: renounced by `brokenBy`.
 * - `renewed`: replaced by a new accord between the same partners.
 */
export const ACCORD_STATUSES = [
  'proposed',
  'declined',
  'withdrawn',
  'lapsed',
  'active',
  'kept',
  'broken',
  'renewed',
] as const;
export type AccordStatus = (typeof ACCORD_STATUSES)[number];

/** An accord as stored (a server row or a client view), as far as the rules are concerned. */
export interface AccordRecord {
  id: string;
  proposerId: UserId;
  recipientId: UserId;
  status: AccordStatus;
  /** Once signed: the accord holds until this round starts. */
  endsRound: number | null;
  /** The round it was renounced in, for broken accords. */
  endedRound: number | null;
  brokenBy: UserId | null;
}

/** An accord in force: neither partner may declare war on the other until `endsRound` starts. */
export interface Accord {
  id: string;
  players: readonly [UserId, UserId];
  endsRound: number;
}

/** A renounced accord: the breaker can't declare war on the former partner until `untilRound` starts. */
export interface Renunciation {
  breakerId: UserId;
  partnerId: UserId;
  untilRound: number;
}

/** The round an accord signed in `round` for `rounds` rounds ends: it holds until that round starts. */
export const accordEndsRound = (round: number, rounds: number) => round + rounds;

/** The accords in force in `round`. */
export function accordsInForce(records: readonly AccordRecord[], round: number): Accord[] {
  return records.flatMap((a) =>
    a.status === 'active' && a.endsRound !== null && round < a.endsRound
      ? [{ id: a.id, players: [a.proposerId, a.recipientId] as const, endsRound: a.endsRound }]
      : [],
  );
}

/** Accords renounced recently enough that the breaker still can't declare war on the former partner. */
export function renunciationsFrom(records: readonly AccordRecord[], round: number): Renunciation[] {
  return records.flatMap((a) => {
    if (a.status !== 'broken' || a.brokenBy === null || a.endedRound === null) return [];
    const untilRound = a.endedRound + 1;
    if (round >= untilRound) return [];
    const partnerId = a.brokenBy === a.proposerId ? a.recipientId : a.proposerId;
    return [{ breakerId: a.brokenBy, partnerId, untilRound }];
  });
}

/** The accord in force between two players, if any. */
export function accordBetween(
  board: { round: number; accords: readonly Accord[] },
  a: UserId,
  b: UserId,
): Accord | undefined {
  return board.accords.find((x) => board.round < x.endsRound && x.players.includes(a) && x.players.includes(b));
}

/** Why `attackerId` must wait before declaring war on `defenderId`: they renounced an accord with them. */
export function renunciationAgainst(
  board: { round: number; renunciations: readonly Renunciation[] },
  attackerId: UserId,
  defenderId: UserId,
): Renunciation | undefined {
  return board.renunciations.find(
    (r) => board.round < r.untilRound && r.breakerId === attackerId && r.partnerId === defenderId,
  );
}

/** The other player in an accord. */
export const partnerIn = (accord: Pick<AccordRecord, 'proposerId' | 'recipientId'>, userId: UserId): UserId =>
  accord.proposerId === userId ? accord.recipientId : accord.proposerId;

/** Whether `userId` is one of the accord's two players. */
export const isPartyTo = (accord: Pick<AccordRecord, 'proposerId' | 'recipientId'>, userId: UserId): boolean =>
  accord.proposerId === userId || accord.recipientId === userId;

export type ProposalRejection = 'closed' | 'self' | 'not-member' | 'bad-length' | 'pending' | 'terms-too-long';

export const PROPOSAL_REJECTION_MESSAGES: Record<ProposalRejection, string> = {
  closed: 'Accords can be signed once the draft begins, until the campaign ends.',
  self: 'You cannot sign an accord with yourself.',
  'not-member': 'That player is not in this campaign.',
  'bad-length': `Accords last from ${ACCORD_MIN_ROUNDS} to ${ACCORD_MAX_ROUNDS} rounds.`,
  pending: 'There is already a proposal between you two waiting for an answer.',
  'terms-too-long': `Terms can be at most ${ACCORD_TERMS_MAX} characters.`,
};

/** Whether accords can be proposed and signed: from the draft on, until the campaign ends. */
export const diplomacyOpen = (status: CampaignStatus) => status === 'draft' || status === 'active';

/**
 * Why `proposerId` can't propose an accord to `partnerId`, or null if they can. An accord already
 * in force between them is no obstacle: signing a new one renews it.
 */
export function checkProposal(
  campaign: {
    status: CampaignStatus;
    memberIds: readonly UserId[];
    /** Accords as stored; only pending proposals matter here. */
    accords: readonly Pick<AccordRecord, 'proposerId' | 'recipientId' | 'status'>[];
  },
  proposerId: UserId,
  partnerId: UserId,
  rounds: number,
  terms: string | null = null,
): ProposalRejection | null {
  if (!diplomacyOpen(campaign.status)) return 'closed';
  if (proposerId === partnerId) return 'self';
  if (!campaign.memberIds.includes(partnerId)) return 'not-member';
  if (!Number.isInteger(rounds) || rounds < ACCORD_MIN_ROUNDS || rounds > ACCORD_MAX_ROUNDS) return 'bad-length';
  if ((terms?.length ?? 0) > ACCORD_TERMS_MAX) return 'terms-too-long';
  const pending = campaign.accords.some(
    (a) => a.status === 'proposed' && isPartyTo(a, proposerId) && isPartyTo(a, partnerId),
  );
  if (pending) return 'pending';
  return null;
}

/** Trims free text and turns an empty string into null. */
export function cleanText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** The conversation a chat message belongs to: the campaign channel, or a pair of players. */
export function conversationKey(a: UserId, b: UserId | null): string {
  return b === null ? 'channel' : [a, b].sort().join(':');
}

/**
 * Whether an item belongs in the feed under `filter`. Private messages never do. The server
 * applies the same rule when it pages through the feed.
 */
export function feedShows(filter: FeedFilter, item: FeedItem): boolean {
  if (item.kind === 'message') return item.message.recipientId === null && (filter === 'all' || filter === 'chat');
  const type = item.event.type;
  switch (filter) {
    case 'all':
      return true;
    case 'wars':
      return type.startsWith('war.') || type === 'round.started';
    case 'accords':
      return type.startsWith('accord.') || type === 'reputation.changed';
    case 'chat':
      return false;
  }
}
