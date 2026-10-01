import {
  ACCORD_STATUSES,
  AUTODRAFT_FALLBACKS,
  REPUTATION_START,
  type CampaignRules,
  type Clocks,
  type GameEndReason,
  type LichessRatings,
  type PeaceOfferStatus,
  type PeaceTerms,
  type PlayerRating,
  type ResultReport,
  type SecretMissionSpec,
  type SecretOption,
  type TimeControl,
  type VictoryResultView,
  type WarCounter,
} from '@empire/rules';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  /** An scrypt hash with its parameters (`auth/passwords.ts`); null until the player sets one. */
  passwordHash: text('password_hash'),
  lichessId: text('lichess_id').unique(),
  lichessUsername: text('lichess_username'),
  /** The player's Lichess ratings as last read from Lichess (at sign-in, or refreshed), for handicaps. */
  lichessRatings: jsonb('lichess_ratings').$type<LichessRatings>(),
  lichessRatingsAt: timestamp('lichess_ratings_at', { withTimezone: true }),
  /** The code of the player's friend link (`/friend/<code>`), made the first time they look at their friends. */
  friendCode: text('friend_code').unique(),
  createdAt: createdAt(),
});

/**
 * Friendships, one row each way: people who drafted a campaign together, or one opened the other's
 * friend link. Removing a friend deletes both rows. Bots are never anyone's friend.
 */
export const friends = pgTable(
  'friends',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendId: text('friend_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendId] })],
);

/** Only a hash of the session token is stored; the token itself lives in the user's cookie. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

/** Browsers a player has allowed to show notifications (web push). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    endpoint: text('endpoint').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_user').on(t.userId)],
);

/** Single-use email sign-in links. */
export const loginTokens = pgTable('login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const CAMPAIGN_STATUSES = ['lobby', 'draft', 'selection', 'active', 'finished'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hostId: text('host_id')
    .notNull()
    .references(() => users.id),
  rules: jsonb('rules').$type<CampaignRules>().notNull(),
  /** The dataset snapshot this campaign plays on. */
  datasetVersion: text('dataset_version').notNull(),
  status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('lobby'),
  round: integer('round').notNull().default(0),
  inviteCode: text('invite_code').notNull().unique(),
  /** First-round pick order, set when the draft starts. */
  draftOrder: jsonb('draft_order').$type<string[]>(),
  /** Index of the next draft pick. */
  pickIndex: integer('pick_index').notNull().default(0),
  createdAt: createdAt(),
  draftStartedAt: timestamp('draft_started_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** When the current round started (from victory missions on; claims time their holding from it). */
  roundStartedAt: timestamp('round_started_at', { withTimezone: true }),
  /** While secret missions are being chosen: when unchosen ones are assigned. */
  selectionDeadline: timestamp('selection_deadline', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /**
   * Declaring in turns, where the rules have it: the current round's order (null: no turns this
   * round), who has passed, whose turn it is (null with an order: declaring is over for the round)
   * and when that turn passes on its own.
   */
  turnOrder: jsonb('turn_order').$type<string[]>(),
  turnPassed: jsonb('turn_passed').$type<string[]>().notNull().default([]),
  turnUserId: text('turn_user_id'),
  turnDeadline: timestamp('turn_deadline', { withTimezone: true }),
});

export const members = pgTable(
  'members',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Index into EMPIRE_COLORS; the hatching pattern is paired with it. */
    color: integer('color').notNull(),
    /** Let the server make this player's draft picks. */
    autodraft: boolean('autodraft').notNull().default(false),
    /** Countries this player wants next, in order; automatic picks work through it. Private. */
    draftList: jsonb('draft_list').$type<string[]>().notNull().default([]),
    /** What auto-draft does once nothing on the list can be claimed: keep picking, or wait. */
    autodraftFallback: text('autodraft_fallback', { enum: AUTODRAFT_FALLBACKS }).notNull().default('best'),
    /** War tokens: one declaration each. */
    tokens: integer('tokens').notNull().default(0),
    /** Public standing for keeping accords. */
    reputation: integer('reputation').notNull().default(REPUTATION_START),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** A bot player's chess level (1 to 8); null for people. Bots' user ids start `bot_`. */
    botLevel: integer('bot_level'),
    /** The last round a bot has done its round's diplomacy and fortifying for. */
    botRound: integer('bot_round'),
    /** The rating a player without an established Lichess rating gives themselves in the lobby. */
    claimedRating: integer('claimed_rating'),
    /** The rating this player's games are handicapped by, frozen when the draft starts; null: unrated. */
    rating: jsonb('rating').$type<PlayerRating>(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    uniqueIndex('members_campaign_color').on(t.campaignId, t.color),
    index('members_user').on(t.userId),
  ],
);

/**
 * A friend invited to a campaign's lobby, until they join (by the invitation or the link), decline,
 * or the inviter or host calls it off. The draft starting closes every invitation.
 */
export const invitations = pgTable(
  'invitations',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] }), index('invitations_user').on(t.userId)],
);

export const holdings = pgTable(
  'holdings',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    territoryId: text('territory_id').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    acquiredRound: integer('acquired_round').notNull(),
    /** Draft pick number (zero-based), for territories claimed in the draft. */
    pickNumber: integer('pick_number'),
    /** Fortified by its owner until this round starts; cleared when the country changes hands. */
    fortifiedUntil: integer('fortified_until'),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.territoryId] }), index('holdings_owner').on(t.campaignId, t.ownerId)],
);

export const WAR_STATUSES = ['declared', 'countered', 'ready', 'playing', 'resolved'] as const;
export const WAR_OUTCOMES = ['attacker', 'defender', 'held', 'tribute', 'settled', 'withdrawn', 'cancelled'] as const;

export const wars = pgTable(
  'wars',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    attackerId: text('attacker_id')
      .notNull()
      .references(() => users.id),
    defenderId: text('defender_id')
      .notNull()
      .references(() => users.id),
    targetId: text('target_id').notNull(),
    launchId: text('launch_id').notNull(),
    /** The launching country first. */
    stake: jsonb('stake').$type<string[]>().notNull(),
    /** Countries the attacker set aside at the declaration to meet a raise. */
    reserves: jsonb('reserves').$type<string[]>().notNull().default([]),
    /** The original target, if the attacker accepted a redirect. */
    redirectedFrom: text('redirected_from'),
    status: text('status', { enum: WAR_STATUSES }).notNull(),
    counter: jsonb('counter').$type<WarCounter>(),
    outcome: text('outcome', { enum: WAR_OUTCOMES }),
    declaredRound: integer('declared_round').notNull(),
    resolvedRound: integer('resolved_round'),
    /** When whoever must answer next runs out of time. */
    respondBy: timestamp('respond_by', { withTimezone: true }),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('wars_campaign').on(t.campaignId, t.status), index('wars_respond_by').on(t.respondBy)],
);

export const GAME_STATUSES = ['waiting', 'playing', 'finished', 'cancelled'] as const;
export const GAME_RESULTS = ['1-0', '0-1', '1/2-1/2'] as const;

export const games = pgTable(
  'games',
  {
    id: text('id').primaryKey(),
    warId: text('war_id')
      .notNull()
      .references(() => wars.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    armageddon: boolean('armageddon').notNull().default(false),
    whiteId: text('white_id')
      .notNull()
      .references(() => users.id),
    blackId: text('black_id')
      .notNull()
      .references(() => users.id),
    timeControl: jsonb('time_control').$type<TimeControl>().notNull(),
    /** UCI, castling as the king's two-square move. */
    moves: jsonb('moves').$type<string[]>().notNull().default([]),
    fen: text('fen').notNull(),
    /** Live games: time left on each clock as of `lastMoveAt`. */
    clocks: jsonb('clocks').$type<Clocks>(),
    status: text('status', { enum: GAME_STATUSES }).notNull(),
    result: text('result', { enum: GAME_RESULTS }),
    reason: text('reason').$type<GameEndReason>(),
    drawOfferBy: text('draw_offer_by'),
    /** A standing offer to play the game over the board. */
    otbOfferBy: text('otb_offer_by'),
    /** When the game moved over the board, to a real board: no moves or clocks here meanwhile. */
    overTheBoardAt: timestamp('over_the_board_at', { withTimezone: true }),
    /** Over the board: a result one player reported, waiting for the other's answer until `deadline`. */
    report: jsonb('report').$type<ResultReport>(),
    /** When play starts; live games open with a countdown. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** The clock reference: the start of play, then each move. Null while over the board, which stops the clocks. */
    lastMoveAt: timestamp('last_move_at', { withTimezone: true }),
    /** When the side to move loses on time; over the board, when an unanswered report stands. */
    deadline: timestamp('deadline', { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('games_war').on(t.warId), index('games_deadline').on(t.status, t.deadline)],
);

/**
 * Non-aggression accords between two players, from proposal to end. Proposals are private to the
 * two players; signed accords are public.
 */
export const accords = pgTable(
  'accords',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    proposerId: text('proposer_id')
      .notNull()
      .references(() => users.id),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ACCORD_STATUSES }).notNull(),
    /** The length the proposer chose. */
    rounds: integer('rounds').notNull(),
    terms: text('terms'),
    proposedRound: integer('proposed_round').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    /** While proposed: when the proposal lapses without an answer. */
    respondBy: timestamp('respond_by', { withTimezone: true }),
    signedRound: integer('signed_round'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** Once signed: the accord holds until this round starts. */
    endsRound: integer('ends_round'),
    endedRound: integer('ended_round'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    brokenBy: text('broken_by'),
    /** The accord this one replaced, when the partners renewed. */
    renews: text('renews'),
  },
  (t) => [index('accords_campaign').on(t.campaignId, t.status), index('accords_respond_by').on(t.respondBy)],
);

export const PEACE_OFFER_STATUSES = [
  'proposed',
  'accepted',
  'declined',
  'withdrawn',
  'lapsed',
] as const satisfies readonly PeaceOfferStatus[];

/**
 * Terms offered to end a war, from proposal to answer. Private to the war's two players until
 * accepted, when the war's resolution makes the terms public.
 */
export const peaceOffers = pgTable(
  'peace_offers',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    warId: text('war_id')
      .notNull()
      .references(() => wars.id, { onDelete: 'cascade' }),
    proposerId: text('proposer_id')
      .notNull()
      .references(() => users.id),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => users.id),
    terms: jsonb('terms').$type<PeaceTerms>().notNull(),
    status: text('status', { enum: PEACE_OFFER_STATUSES }).notNull(),
    createdAt: createdAt(),
    /** While proposed: when the offer lapses without an answer. */
    respondBy: timestamp('respond_by', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('peace_offers_war').on(t.warId, t.status),
    index('peace_offers_campaign').on(t.campaignId, t.status),
    index('peace_offers_respond_by').on(t.respondBy),
  ],
);

/** Chat: the campaign channel and private conversations between two players. */
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** `channel`, or the two players' ids in order, joined by a colon. */
    conversation: text('conversation').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    /** Null in the channel; the other player in a private conversation. */
    recipientId: text('recipient_id').references(() => users.id),
    /** Emptied when the message is deleted or removed. */
    body: text('body').notNull(),
    createdAt: createdAt(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    /** The author (deleted) or the host (removed). */
    removedBy: text('removed_by'),
  },
  (t) => [index('messages_conversation').on(t.campaignId, t.conversation, t.id)],
);

/** How far each player has read each conversation, for unread counts on every device. */
export const chatReads = pgTable(
  'chat_reads',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversation: text('conversation').notNull(),
    lastReadId: bigint('last_read_id', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId, t.conversation] })],
);

export const REVEAL_REASONS = ['near', 'claim', 'final'] as const;

/**
 * Victory missions, per player: their holdings when the draft finished (the baseline every
 * post-draft comparison uses) and their secret mission. The options, seed and chosen mission are
 * private to the player until the mission is revealed; discarded options never leave the server.
 */
export const missionPlayers = pgTable(
  'mission_players',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Countries held when the draft finished. */
    baseline: jsonb('baseline').$type<string[]>().notNull(),
    baselineValue: integer('baseline_value').notNull(),
    /** Server-private seed the secret options were drawn with. */
    seed: bigint('seed', { mode: 'number' }).notNull(),
    /** The secret options dealt, best fit first. Private. */
    options: jsonb('options').$type<SecretOption[]>().notNull(),
    /** The option chosen (or assigned); irrevocable. */
    secretId: text('secret_id'),
    secret: jsonb('secret').$type<SecretMissionSpec>(),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    /** Assigned automatically when time ran out. */
    autoAssigned: boolean('auto_assigned').notNull().default(false),
    /** No option fitted, and the host went on without a secret mission for this player. */
    noSecret: boolean('no_secret').notNull().default(false),
    /** Once revealed, the secret mission is public for good. */
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
    revealedRound: integer('revealed_round'),
    revealReason: text('reveal_reason', { enum: REVEAL_REASONS }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const CLAIM_STATUSES = ['pending', 'awarded', 'interrupted', 'cancelled'] as const;

/**
 * Claim episodes on territorial missions: from the moment a mission is complete until it scores,
 * the position is lost, or the campaign ends. A player has at most one pending claim per mission.
 */
export const missionClaims = pgTable(
  'mission_claims',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** `p0`…`p3` for public missions, `secret` for the player's secret mission. */
    missionKey: text('mission_key').notNull(),
    status: text('status', { enum: CLAIM_STATUSES }).notNull(),
    startedRound: integer('started_round').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** The first round it can score in. */
    eligibleRound: integer('eligible_round').notNull(),
    /** When the minimum holding time is up; set when the round after `startedRound` starts. */
    eligibleAt: timestamp('eligible_at', { withTimezone: true }),
    /** Whether a check has run since `eligibleAt` passed (so the scheduler looks once). */
    timeReached: boolean('time_reached').notNull().default(false),
    /** Unresolved wars that could still break the position. */
    blockedBy: jsonb('blocked_by').$type<string[]>().notNull().default([]),
    endedRound: integer('ended_round'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('mission_claims_campaign').on(t.campaignId, t.status),
    index('mission_claims_due').on(t.status, t.eligibleAt),
    uniqueIndex('mission_claims_one_pending')
      .on(t.campaignId, t.userId, t.missionKey)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Victory points, for good: each player scores each mission at most once. */
export const missionAwards = pgTable(
  'mission_awards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    missionKey: text('mission_key').notNull(),
    kind: text('kind').notNull(),
    points: integer('points').notNull(),
    round: integer('round').notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull(),
    claimId: bigint('claim_id', { mode: 'number' }),
  },
  (t) => [uniqueIndex('mission_awards_once').on(t.campaignId, t.userId, t.missionKey)],
);

/** How an Objectives campaign ended: written once, when someone reaches the points to win. */
export const campaignResults = pgTable('campaign_results', {
  campaignId: text('campaign_id')
    .primaryKey()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  winnerIds: jsonb('winner_ids').$type<string[]>().notNull(),
  round: integer('round').notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  /** Scores, missions (every secret one revealed) and the final map. */
  snapshot: jsonb('snapshot').$type<VictoryResultView>().notNull(),
});

/** Append-only campaign history. Feeds, graphs and timelapses are derived from it. */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    type: text('type').notNull(),
    actorId: text('actor_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('events_campaign').on(t.campaignId, t.id)],
);
