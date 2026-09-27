/** Shapes exchanged between the web client and the game server. */
import type { Clocks, GameEndReason, GameResult, TimeControl } from './chess';
import type { CampaignRules } from './config';
import type { TerritoryId } from './dataset';
import type { AutodraftFallback } from './draft';
import type { Transfer, Truce, WarCounter, WarOutcome } from './war';

export type CampaignStatus = 'lobby' | 'draft' | 'active' | 'finished';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  lichessUsername: string | null;
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
  | { type: 'round.started'; payload: { round: number } }
  | {
      type: 'war.declared';
      payload: {
        warId: string;
        attackerId: string;
        defenderId: string;
        targetId: TerritoryId;
        launchId: TerritoryId;
        stake: TerritoryId[];
      };
    }
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
  /** The attacker's answer to a counter-offer. `auto` when their time ran out. */
  | {
      type: 'war.reply';
      payload: { warId: string; reply: WarReply['reply']; stake?: TerritoryId[]; auto: boolean };
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
      };
    };

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
}

/**
 * - `declared`: waiting for the defender.
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
}

/** What the defender can do with a declaration. */
export type WarResponse =
  | { response: 'accept' }
  | { response: 'raise' }
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
}

/**
 * - `waiting`: a live game queued until both players are free.
 * - `playing`: underway (live games open with a short countdown, see `startsAt`).
 * - `finished`: see `result` and `reason`.
 */
export type GameStatus = 'waiting' | 'playing' | 'finished';

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
  /** Wars waiting for the viewer's answer, plus games waiting for the viewer's move. */
  attention: number;
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
  | { type: 'game.update'; campaignId: string; game: GameView };
