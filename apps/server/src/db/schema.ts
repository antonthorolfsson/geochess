import {
  AUTODRAFT_FALLBACKS,
  type CampaignRules,
  type Clocks,
  type GameEndReason,
  type TimeControl,
  type WarCounter,
} from '@empire/rules';
import {
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
  lichessId: text('lichess_id').unique(),
  lichessUsername: text('lichess_username'),
  createdAt: createdAt(),
});

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

export const CAMPAIGN_STATUSES = ['lobby', 'draft', 'active', 'finished'] as const;
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
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    uniqueIndex('members_campaign_color').on(t.campaignId, t.color),
    index('members_user').on(t.userId),
  ],
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
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.territoryId] }), index('holdings_owner').on(t.campaignId, t.ownerId)],
);

export const WAR_STATUSES = ['declared', 'countered', 'ready', 'playing', 'resolved'] as const;
export const WAR_OUTCOMES = ['attacker', 'defender', 'held', 'tribute', 'withdrawn'] as const;

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

export const GAME_STATUSES = ['waiting', 'playing', 'finished'] as const;
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
    /** When play starts; live games open with a countdown. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** The clock reference: the start of play, then each move. */
    lastMoveAt: timestamp('last_move_at', { withTimezone: true }),
    /** When the side to move loses on time. */
    deadline: timestamp('deadline', { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('games_war').on(t.warId), index('games_deadline').on(t.status, t.deadline)],
);

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
