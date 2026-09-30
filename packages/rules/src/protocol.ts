/** Shapes exchanged between the web client and the game server. */
import type { Clocks, Color, GameEndReason, GameResult, TimeControl } from './chess';
import type { CampaignRules } from './config';
import type { TerritoryId } from './dataset';
import type { AccordStatus } from './diplomacy';
import type { AutodraftFallback } from './draft';
import type { Opening } from './openings';
import type { MissionSpec, SecretMissionSpec } from './victory/catalog';
import type { Evaluation } from './victory/evaluate';
import type { EffortEstimate } from './victory/generate';
import type { PeaceTerms, Transfer, Truce, WarCounter, WarOutcome } from './war';

/**
 * - `lobby`: players join and the host sets the rules.
 * - `draft`: players claim countries in turn.
 * - `selection`: Objectives campaigns only: each player chooses a secret mission before round 1.
 * - `active`: at war, round by round.
 * - `finished`: someone reached the victory points needed; nothing more can change.
 */
export type CampaignStatus = 'lobby' | 'draft' | 'selection' | 'active' | 'finished';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  lichessUsername: string | null;
  /** Whether the player can sign in with their email and a password. */
  hasPassword: boolean;
}

export interface MeResponse {
  user: SessionUser | null;
  /** Which sign-in methods this server offers. */
  auth: { devLogin: boolean; email: boolean; lichess: boolean };
}

export type CampaignEvent =
  | { type: 'campaign.created'; payload: { name: string } }
  | { type: 'member.joined'; payload: { userId: string; name: string } }
  | { type: 'member.left'; payload: { userId: string; name: string; kicked: boolean } }
  | { type: 'draft.started'; payload: { order: string[] } }
  | { type: 'draft.pick'; payload: { userId: string; territoryId: TerritoryId; pickNumber: number; auto: boolean } }
  | { type: 'draft.completed'; payload: Record<string, never> }
  /**
   * The host closed the draft early and the remaining `picks` were made automatically, in draft
   * order. (Campaigns from before auto-drafting left `unclaimed` countries unclaimed.)
   */
  | {
      type: 'draft.ended';
      payload: { unclaimed: number; autoPicked?: number; picks?: { userId: string; territoryId: TerritoryId }[] };
    }
  /** A round started. `order` is who takes their turn when, in campaigns that declare war in turns. */
  | { type: 'round.started'; payload: { round: number; order?: string[] } }
  /**
   * A player passed: they're done declaring war and fortifying for the round. `auto` when their
   * time ran out; the host passing a turn for them is logged with the host as the actor.
   */
  | { type: 'turn.passed'; payload: { userId: string; auto: boolean } }
  /** Everyone has passed or has nothing left to do: declaring is over for the round. */
  | { type: 'turns.ended'; payload: { round: number } }
  | {
      type: 'war.declared';
      payload: {
        warId: string;
        attackerId: string;
        defenderId: string;
        targetId: TerritoryId;
        launchId: TerritoryId;
        stake: TerritoryId[];
        /** Countries set aside to meet a raise. */
        reserves?: TerritoryId[];
      };
    }
  /** The attacker called off a declaration before the defender answered. */
  | { type: 'war.recalled'; payload: { warId: string } }
  /** The defender's answer. `auto` when their time ran out and the war went ahead as declared. */
  | {
      type: 'war.response';
      payload: {
        warId: string;
        response: WarResponse['response'];
        counter: WarCounter | null;
        auto: boolean;
      };
    }
  /**
   * The attacker's answer to a counter-offer. `auto` when their time ran out; `fromReserves` when
   * the reserves set aside at the declaration met a raise at once.
   */
  | {
      type: 'war.reply';
      payload: {
        warId: string;
        reply: WarReply['reply'];
        stake?: TerritoryId[];
        auto: boolean;
        fromReserves?: boolean;
      };
    }
  | {
      type: 'war.started';
      payload: { warId: string; gameId: string; armageddon: boolean; whiteId: string; blackId: string };
    }
  | {
      type: 'war.resolved';
      payload: {
        warId: string;
        outcome: WarOutcome;
        /** The deciding game's result, for wars settled over the board. */
        result?: GameResult;
        reason?: GameEndReason;
        transfers: Transfer[];
        /** Tokens paid as tribute. */
        tokens?: number;
        /** The peace terms the two agreed, for a war they settled. */
        terms?: PeaceTerms;
      };
    }
  /** A player spent a war token fortifying a country: war on it needs a raised stake until `untilRound` starts. */
  | { type: 'country.fortified'; payload: { userId: string; territoryId: TerritoryId; untilRound: number } }
  /**
   * Two players signed an accord: neither may declare war on the other until `endsRound` starts.
   * `renews` is the accord it replaced, when they renewed one already in force.
   */
  | {
      type: 'accord.signed';
      payload: {
        accordId: string;
        proposerId: string;
        recipientId: string;
        rounds: number;
        endsRound: number;
        terms: string | null;
        renews: string | null;
      };
    }
  /** An accord was renounced before it ran its course. */
  | { type: 'accord.broken'; payload: { accordId: string; breakerId: string; partnerId: string } }
  /** An accord ran its course. */
  | { type: 'accord.kept'; payload: { accordId: string; players: [string, string] } }
  | {
      type: 'reputation.changed';
      payload: {
        userId: string;
        delta: number;
        /** Reputation after the change. */
        reputation: number;
        /** `accord-kept` is from before reputation was paid by the round: +5 when an accord ran its course. */
        reason: 'accord-broken' | 'accord-kept';
        accordId: string;
      };
    }
  /**
   * A round started, and the accords that held through the whole round before it paid both
   * partners. One entry per player who gained, with their reputation after it.
   */
  | {
      type: 'reputation.earned';
      payload: { heldRound: number; gains: { userId: string; delta: number; reputation: number }[] };
    }
  /** The draft ended in an Objectives campaign: secret missions were dealt, to be chosen by `deadline`. */
  | { type: 'missions.dealt'; payload: { deadline: string } }
  /**
   * A secret mission became public: its player came within one step of it (`near`), completed it
   * (`claim`), or the campaign ended (`final`). Carries the mission's exact requirements.
   */
  | {
      type: 'mission.revealed';
      payload: { userId: string; mission: SecretMissionSpec; reason: 'near' | 'claim' | 'final' };
    }
  /** A player completed a territorial mission and must now hold it through the response window. */
  | {
      type: 'claim.started';
      payload: {
        claimId: number;
        userId: string;
        missionKey: string;
        kind: MissionSpec['kind'];
        eligibleRound: number;
      };
    }
  /** The claimed position was lost before it scored. The points are still there to win. */
  | {
      type: 'claim.interrupted';
      payload: { claimId: number; userId: string; missionKey: string; kind: MissionSpec['kind'] };
    }
  /** Points awarded for a mission, for good. `total` is the player's points after it. */
  | {
      type: 'mission.awarded';
      payload: { userId: string; missionKey: string; kind: MissionSpec['kind']; points: number; total: number };
    }
  /**
   * The campaign is won (by several players when they tie) and over: by reaching the points to win,
   * or with `seasonEnd`, on points (then value) when the last round ended.
   */
  | { type: 'campaign.won'; payload: { winners: string[]; points: Record<string, number>; seasonEnd?: boolean } };

export type CampaignEventType = CampaignEvent['type'];

export type EventView = CampaignEvent & {
  id: number;
  round: number;
  actorId: string | null;
  createdAt: string;
};

export interface MemberView {
  userId: string;
  name: string;
  lichessUsername: string | null;
  color: number;
  autodraft: boolean;
  /** War tokens: one declaration each. Public, like the map. */
  tokens: number;
  /** Public standing for keeping accords: starts at 100, falls when an accord is broken. */
  reputation: number;
  joinedAt: string;
}

export interface DraftView {
  /** First-round pick order. */
  order: string[];
  pickIndex: number;
  totalPicks: number;
  /** One-based draft round of the next pick. */
  round: number;
  /** Who picks next, or null once the draft is over. */
  currentPicker: string | null;
}

export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  round: number;
  hostId: string;
  rules: CampaignRules;
  datasetVersion: string;
  inviteCode: string;
  createdAt: string;
  members: MemberView[];
  /** Owner of every claimed territory. */
  holdings: Record<TerritoryId, string>;
  draft: DraftView | null;
  /** The viewer's own draft list, in order. Private: other players never see it. */
  myDraftList: TerritoryId[];
  /** What the viewer's auto-draft does once their list runs out. Private, like the list. */
  myAutodraftFallback: AutodraftFallback;
  /** The most recent events, oldest first. */
  events: EventView[];
  /** Unresolved wars, then recently resolved ones, newest first. */
  wars: WarView[];
  truces: Truce[];
  /** The round each country last changed hands in a war or tribute; drafted countries are absent. */
  acquired: Record<TerritoryId, number>;
  /** Countries fortified now, with the round at whose start each fortification ends. */
  fortified: Record<TerritoryId, number>;
  /**
   * Accords in force and recently ended ones (public), plus the viewer's own proposals, which only
   * the two players see.
   */
  accords: AccordView[];
  /**
   * Declaring in turns this round: null in campaigns where anyone declares whenever they like, and
   * until the campaign's first round starts.
   */
  turns: TurnsView | null;
  /** Victory missions and points, in Objectives campaigns; null in open-ended ones. Public. */
  victory: VictoryView | null;
  /** The viewer's own secret mission (or options to choose from). Private: nobody else sees it. */
  mySecret: MySecretView | null;
}

/** Declaring in turns during the current round. */
export interface TurnsView {
  /** The round's order. */
  order: string[];
  /** Whose turn it is to declare war or fortify, or null once declaring is over for the round. */
  current: string | null;
  /** When the current turn passes, if its player hasn't acted. */
  deadline: string | null;
  /** Players done declaring for the round. */
  passed: string[];
}

/** Passing a turn: your own, or (the host) the player whose turn it is. */
export interface PassTurnInput {
  userId: string;
}

/** A mission a campaign plays with: public ones are keyed by slot (`p0`…), a secret one `secret`. */
export interface MissionView {
  key: string;
  scope: 'public' | 'secret';
  points: number;
  spec: MissionSpec;
}

/**
 * A claim on a territorial mission: from the moment it's complete until it scores or the position
 * is lost. It can score from `eligibleRound` on, once `eligibleAt` has passed and no war could
 * still break it.
 */
export interface ClaimView {
  id: number;
  userId: string;
  missionKey: string;
  status: 'pending' | 'awarded' | 'interrupted' | 'cancelled';
  startedRound: number;
  startedAt: string;
  eligibleRound: number;
  /** When the minimum holding time is up; set when the round after the claim's starts. */
  eligibleAt: string | null;
  /** Unresolved wars (by id) that could still break the position. */
  blockedBy: string[];
}

export interface AwardView {
  userId: string;
  missionKey: string;
  kind: MissionSpec['kind'];
  points: number;
  round: number;
  awardedAt: string;
}

export interface RevealedSecretView {
  mission: MissionView;
  revealedRound: number;
  revealedAt: string;
  reason: 'near' | 'claim' | 'final';
}

export interface VictoryPlayerView {
  userId: string;
  points: number;
  awards: AwardView[];
  /** While secret missions are being chosen: whether this player has one. */
  ready: boolean;
  /** Their secret mission, once revealed. Until then nobody else learns anything about it. */
  secret: RevealedSecretView | null;
  /**
   * Where they stand on each public mission (and a revealed secret), by mission key. Empty until
   * the war begins.
   */
  progress: Record<string, Evaluation>;
}

export interface VictoryResultView {
  winners: string[];
  round: number;
  finishedAt: string;
  /**
   * Nobody reached the points to win: the season's last round ended and the most points (then the
   * most valuable empire) won. Unset in results stored before seasons existed.
   */
  seasonEnd?: boolean;
  /** Every player, most points first. Secret missions are all revealed here, done or not. */
  standings: {
    userId: string;
    points: number;
    value: number;
    countries: number;
    awards: AwardView[];
    secret: { mission: MissionView; completed: boolean } | null;
  }[];
  /** The map when the campaign ended. */
  holdings: Record<TerritoryId, string>;
}

export interface VictoryView {
  /** The mission rules version the campaign plays by. */
  version: number;
  pointsToWin: number;
  publicPoints: number;
  secretPoints: number;
  /** The least time a claim is held after the next round starts. */
  holdMs: number;
  /** The season's last round, after which the most points win; null if the campaign plays on. */
  lastRound: number | null;
  publicMissions: MissionView[];
  players: VictoryPlayerView[];
  /** Claims waiting to score. */
  claims: ClaimView[];
  /** While secret missions are being chosen. */
  selection: {
    deadline: string | null;
    /** Players no secret option fitted: the host decides whether to go on without one. */
    unresolved: string[];
  } | null;
  result: VictoryResultView | null;
}

export interface SecretOptionView {
  id: string;
  /** 1 is the best fit, assigned if no choice is made in time. */
  rank: number;
  spec: SecretMissionSpec;
  estimate: EffortEstimate;
}

export interface MySecretView {
  /** The options to choose from, until one is chosen. Never shown again after. */
  options: SecretOptionView[] | null;
  mission: MissionView | null;
  /** Assigned automatically because time ran out. */
  auto: boolean;
  /** Nothing fitted and the host went on without a secret mission for this player. */
  none: boolean;
  revealed: boolean;
  /** Where the player stands on it, once the war has begun. */
  progress: Evaluation | null;
}

export interface AccordView {
  id: string;
  proposerId: string;
  recipientId: string;
  status: AccordStatus;
  /** The length the proposer chose. */
  rounds: number;
  /** Free text both players agreed to. Public once signed; the game doesn't enforce it. */
  terms: string | null;
  proposedRound: number;
  proposedAt: string;
  /** While proposed: when the proposal lapses without an answer. */
  respondBy: string | null;
  signedRound: number | null;
  signedAt: string | null;
  /** Once signed: the accord holds until this round starts. */
  endsRound: number | null;
  /** When it ended: kept, broken, renewed, or (for proposals) declined, withdrawn or lapsed. */
  endedRound: number | null;
  endedAt: string | null;
  brokenBy: string | null;
  /** The accord this one replaced, when the partners renewed. */
  renews: string | null;
}

export interface ProposeAccordInput {
  partnerId: string;
  rounds: number;
  terms?: string | null;
}

/** A chat message in the campaign channel or a private conversation. */
export interface MessageView {
  id: number;
  authorId: string;
  /** Null in the campaign channel; the other player in a private conversation. */
  recipientId: string | null;
  /** Null once deleted by its author or removed by the host. */
  body: string | null;
  removed: 'author' | 'host' | null;
  createdAt: string;
}

export interface SendMessageInput {
  body: string;
  /** The other player, for a private message; omitted or null for the campaign channel. */
  to?: string | null;
}

/**
 * The activity feed: dispatches (the event log) and the campaign channel in one timeline.
 * - `wars`: war dispatches and round starts.
 * - `accords`: accords and reputation.
 * - `chat`: the campaign channel.
 */
export const FEED_FILTERS = ['all', 'wars', 'accords', 'chat'] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export type FeedItem = { kind: 'event'; event: EventView } | { kind: 'message'; message: MessageView };

export interface FeedPage {
  /** Newest first. */
  items: FeedItem[];
  /** Pass as `before` to load older items; null once the start is reached. */
  next: string | null;
}

export interface MessagesPage {
  /** Newest first. */
  messages: MessageView[];
  /** Pass as `before` to load older messages; null once the start is reached. */
  next: number | null;
}

/** Unread messages for the viewer: the campaign channel, and each private conversation. */
export interface ChatSummary {
  channelUnread: number;
  /** One per other player the viewer has exchanged private messages with. */
  conversations: { userId: string; unread: number; last: MessageView }[];
}

/**
 * - `declared`: waiting for the defender (the attacker may still call it off, where the rules allow).
 * - `countered`: the defender raised, redirected or offered tribute; waiting for the attacker.
 * - `ready`: accepted, and a live game is waiting for both players to finish other games.
 * - `playing`: the game is on.
 * - `resolved`: over; see `outcome`.
 */
export type WarStatus = 'declared' | 'countered' | 'ready' | 'playing' | 'resolved';

export interface WarView {
  id: string;
  attackerId: string;
  defenderId: string;
  targetId: TerritoryId;
  /** The launching country, which is also the first country of the stake. */
  launchId: TerritoryId;
  stake: TerritoryId[];
  /** The original target, if the defender redirected the war and the attacker accepted. */
  redirectedFrom: TerritoryId | null;
  status: WarStatus;
  /** The defender's counter-offer while the attacker decides, and after, as history. */
  counter: WarCounter | null;
  outcome: WarOutcome | null;
  declaredRound: number;
  resolvedRound: number | null;
  /** When whoever must answer next (the defender, or the attacker after a counter) runs out of time. */
  respondBy: string | null;
  declaredAt: string;
  resolvedAt: string | null;
  games: GameSummary[];
  /** Countries the attacker set aside at the declaration to meet a raise. Public, like the stake. */
  reserves: TerritoryId[];
  /**
   * Peace offers in this war that the viewer made or received, newest first. Private: only the two
   * players ever see them, and nobody else learns one was made.
   */
  peace: PeaceOfferView[];
}

/**
 * - `proposed`: waiting for the other player.
 * - `accepted`: the war ended on these terms.
 * - `declined`: turned down, or passed over by a move in the war's game.
 * - `withdrawn`: taken back, or replaced by a newer offer from the same player.
 * - `lapsed`: unanswered in time, or the war ended first.
 */
export type PeaceOfferStatus = 'proposed' | 'accepted' | 'declined' | 'withdrawn' | 'lapsed';

export interface PeaceOfferView {
  id: string;
  warId: string;
  proposerId: string;
  recipientId: string;
  terms: PeaceTerms;
  status: PeaceOfferStatus;
  createdAt: string;
  /** While proposed: when the offer lapses. */
  respondBy: string | null;
  endedAt: string | null;
}

export interface ProposePeaceInput {
  terms: PeaceTerms;
}

/** What the defender can do with a declaration. A matched raise names the country put into the war. */
export type WarResponse =
  | { response: 'accept' }
  | { response: 'raise'; territoryId?: TerritoryId }
  | { response: 'redirect'; targetId: TerritoryId }
  | { response: 'tribute'; territoryId?: TerritoryId; tokens?: number };

/**
 * The attacker's answer to a counter-offer: `accept` a raise (with the raised stake), a redirect
 * or a tribute; `withdraw` from a raise or redirect (losing the token); `refuse` a tribute and fight.
 */
export type WarReply = { reply: 'accept'; stake?: TerritoryId[] } | { reply: 'withdraw' } | { reply: 'refuse' };

export interface DeclareWarInput {
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: TerritoryId[];
  /** Countries set aside to meet a raise at once, without waiting for the attacker's reply. */
  reserves?: TerritoryId[];
}

/**
 * - `waiting`: a live game queued until both players are free.
 * - `playing`: underway (live games open with a short countdown, see `startsAt`).
 * - `finished`: see `result` and `reason`.
 * - `cancelled`: the campaign ended first. The moves stand; there is no result.
 */
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'cancelled';

export interface GameSummary {
  id: string;
  /** An Armageddon tiebreak after a drawn first game: colors swapped, and Black wins a draw. */
  armageddon: boolean;
  whiteId: string;
  blackId: string;
  status: GameStatus;
  result: GameResult | null;
  reason: GameEndReason | null;
}

export interface GameView extends GameSummary {
  warId: string;
  campaignId: string;
  timeControl: TimeControl;
  /** Moves in UCI, castling as the king's two-square move. */
  moves: string[];
  /** Live games: time left on each clock at `serverNow`, the side to move still running. */
  clocks: Clocks | null;
  /** When play starts. Live games open with a short countdown so both players can get to the board. */
  startsAt: string | null;
  /** When the side to move loses on time. */
  deadline: string | null;
  /** A standing draw offer, by player id. */
  drawOfferBy: string | null;
  serverNow: string;
}

/**
 * Statistics for every empire in a campaign, derived from its history on each request. Everything
 * here is public within the campaign: holdings, wars, games and signed accords.
 */
export interface CampaignStats {
  history: HistoryView;
  /** One per member. */
  empires: EmpireRecordView[];
  /** How each held country came to its current owner. */
  acquisitions: Record<TerritoryId, Acquisition>;
}

/**
 * Empire sizes over the campaign. Round 0 is the end of the draft (or now, while it runs); each
 * later point is the end of a round, the last one being now. Until round 1 starts, round 0 is the
 * only point.
 */
export interface HistoryView {
  points: HistoryPoint[];
  /** Wars that moved territory, oldest first. */
  wars: HistoryWar[];
}

export interface HistoryPoint {
  round: number;
  /** Game value each player held, by player id. */
  value: Record<string, number>;
  /** Countries each player held, by player id. */
  countries: Record<string, number>;
}

export interface HistoryWar {
  warId: string;
  /** The round it resolved in. */
  round: number;
  attackerId: string;
  defenderId: string;
  outcome: WarOutcome;
  transfers: Transfer[];
}

/** Drafted (with the zero-based pick number, when known), or won in a war, as tribute or by peace terms. */
export type Acquisition =
  | { via: 'draft'; pick: number | null }
  | { via: 'war' | 'tribute' | 'peace'; warId: string; round: number; from: string };

export interface EmpireRecordView {
  userId: string;
  wars: WarRecord;
  accords: AccordTally;
  chess: ChessProfile;
}

/** Wars from one side, by how they ended. */
export interface WarTally {
  won: number;
  lost: number;
  /** Drawn, so the defender held. */
  drawn: number;
  /** Settled by tribute: taken when attacking, paid when defending. */
  tribute: number;
  /** Ended by peace terms the two agreed. */
  settled: number;
  /** Called off by the attacker (or their silence). */
  withdrawn: number;
  /** Cut short when the campaign ended: neither won nor lost. */
  cancelled: number;
  underway: number;
}

export interface WarRecord {
  attacking: WarTally;
  defending: WarTally;
  /** War tokens taken and paid as tribute or in peace terms. */
  tokensTaken: number;
  tokensPaid: number;
  /** Countries won and lost in wars, tribute and peace terms, oldest first. */
  gained: CountryChange[];
  lost: CountryChange[];
}

export interface CountryChange {
  territoryId: TerritoryId;
  warId: string;
  round: number;
  /** Who it came from (gained) or went to (lost). */
  otherId: string;
  via: 'war' | 'tribute' | 'peace';
}

/** Signed accords only: proposals stay private to their two players. */
export interface AccordTally {
  signed: number;
  kept: number;
  /** Renounced by this player. */
  broken: number;
  /** Renounced by the partner. */
  betrayed: number;
  inForce: number;
}

export interface ResultTally {
  won: number;
  drawn: number;
  lost: number;
}

export type PlayerResult = keyof ResultTally;

/** A player's games in the campaign. Results are the games' own, so a drawn Armageddon is a draw. */
export interface ChessProfile {
  /** Finished games. */
  played: number;
  /** Games being played now. */
  underway: number;
  asWhite: ResultTally;
  asBlack: ResultTally;
  /** How finished games ended, from this player's side. */
  endings: Partial<Record<GameEndReason, ResultTally>>;
  /** Average length of finished games, in moves. */
  averageMoves: number | null;
  /** Opening families played, most played first. */
  openings: OpeningStat[];
  /** Finished games, most recent first. */
  games: GameLine[];
}

export interface OpeningStat extends ResultTally {
  /** The opening family, e.g. "Sicilian Defense". */
  family: string;
  /** The side this player had. */
  color: Color;
  games: number;
}

export interface GameLine {
  gameId: string;
  warId: string;
  opponentId: string;
  color: Color;
  armageddon: boolean;
  result: PlayerResult;
  reason: GameEndReason | null;
  moves: number;
  opening: Opening | null;
  finishedAt: string | null;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  round: number;
  hostId: string;
  memberCount: number;
  maxPlayers: number;
  myColor: number;
  currentPicker: string | null;
  /**
   * Wars, peace offers and accord proposals waiting for the viewer's answer, plus games waiting for
   * their move and their turn to declare.
   */
  attention: number;
  /** Private messages the viewer hasn't read. */
  unread: number;
  createdAt: string;
}

export interface InvitePreview {
  campaign: {
    id: string;
    name: string;
    hostName: string;
    status: CampaignStatus;
    memberCount: number;
    maxPlayers: number;
  };
  isMember: boolean;
}

export interface ApiError {
  error: { message: string; code?: string };
}

export type ServerMessage =
  | { type: 'hello'; userId: string }
  /** New events in a campaign the user belongs to. */
  | { type: 'campaign.events'; campaignId: string; events: EventView[] }
  /** Campaign state changed without a logged event (settings, colors). */
  | { type: 'campaign.changed'; campaignId: string }
  | { type: 'campaign.deleted'; campaignId: string }
  /** A game's new state after a move, draw offer or result; boards apply it without refetching. */
  | { type: 'game.update'; campaignId: string; game: GameView }
  /**
   * A new chat message, or one that was deleted or removed. Channel messages go to every member,
   * private ones to their two players.
   */
  | { type: 'chat.message'; campaignId: string; message: MessageView }
  /** The player read a conversation (on any device), so unread counts changed. */
  | { type: 'chat.read'; campaignId: string };
