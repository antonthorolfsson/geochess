import type {
  AccordRecord,
  AccordSpan,
  AwardMark,
  CampaignRules,
  DatasetIndex,
  GameEndReason,
  Holding,
  MissionRules,
  MissionSpec,
  MissionWar,
  PeaceTerms,
  PublicMissionKind,
  PublicMissionSpec,
  RoundStart,
  SecretMissionSpec,
  SecretOption,
  TerritoryId,
  Transfer,
  TurnState,
  UserId,
  WarCounter,
  WarOutcome,
  WarStatus,
} from '@empire/rules';
import type { BotKnobs } from '../bots/knobs';
import type { Streams } from '../random';
import type { Variant } from '../variants';
import type { TitleStat } from './titles';
import type { Reply, Response } from './wars';

/** How chess games are decided: the model standing in for the players at the board. */
export interface ChessModel {
  /** Chance a game is drawn, before any Armageddon. */
  drawRate: number;
  /** What playing White is worth, in Elo. */
  whiteElo: number;
  /** What 1% more clock time than the opponent is worth, in Elo. */
  eloPerTimePct: number;
  /** How decisive games end: shares of checkmate and timeout (the rest resign). */
  mateShare: number;
  timeoutShare: number;
  /**
   * Once a Checkmate Artist is revealed, the share of their would-be mates the opponent turns into
   * a resignation instead.
   */
  mateDenial: number;
}

export type EloSetup = { kind: 'equal' } | { kind: 'spread'; sd: number } | { kind: 'star'; bonus: number };

/** Everything a simulated campaign is set up with. */
export interface SimConfig {
  scenario: string;
  players: number;
  draftMode: 'contiguous' | 'free';
  /** The public missions: the default set, a random draw, or these kinds. */
  publics: 'default' | 'random' | readonly PublicMissionKind[];
  pace: 'live' | 'correspondence';
  /** Chance a war stays open 0, 1, 2… rounds past the one it's declared in. */
  latency: readonly number[];
  /**
   * Declaration waves a round: each wave declares, answers and fights what's due. With turns, the
   * first wave's turns are the round's only declarations; later waves answer and fight.
   */
  waves: number;
  /** `normal` ends at the points to win; `horizon` never ends early, to measure the missions alone. */
  mode: 'normal' | 'horizon';
  /** The last round played: a stall in normal mode. */
  roundCap: number;
  /** The mission rules version the campaign plays (the game's current one by default). */
  missionVersion: number;
  /** The dataset version played (null: the latest). */
  dataset: string | null;
  /**
   * The season's last round, after which the most points (then value) win, as the host sets it; null
   * plays on to the points to win. Ignored in horizon mode.
   */
  lastRound: number | null;
  /**
   * Host war settings over a new campaign's (draws, stake floor, the raise and the other answers,
   * truces, tokens).
   */
  war: Partial<CampaignRules['war']>;
  chess: ChessModel;
  elo: EloSetup;
  bots: BotKnobs;
  variant: Variant | null;
  /** Re-check the invariants after every change (slow; for tests). */
  debug: boolean;
  /** Keep a readable log of what happened. */
  trace: boolean;
}

export interface SimPlayer {
  id: UserId;
  /** Place in the draft order, 0 first. */
  seat: number;
  elo: number;
  tokens: number;
  reputation: number;
  baseline: Set<TerritoryId>;
  options: SecretOption[];
  secret: SecretMissionSpec | null;
  /** Assigned by a forced-assignment scenario rather than chosen from the options. */
  forced: boolean;
  revealedRound: number | null;
  eliminatedRound: number | null;
}

export interface SimWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: TerritoryId[];
  /** Countries set aside at the declaration to meet a raise. */
  reserves: TerritoryId[];
  status: WarStatus;
  counter: WarCounter | null;
  redirectedFrom: TerritoryId | null;
  declaredRound: number;
  declaredSeq: number;
  /** The round its game ends in (latency). */
  dueRound: number;
  outcome: WarOutcome | null;
  resolvedRound: number | null;
  seq: number | null;
  transfers: Transfer[];
  endReason: GameEndReason | null;
  armageddon: boolean;
  /** The defender's answer and the attacker's reply, for the record (`peace`: settled before an answer). */
  response: 'accept' | 'raise' | 'redirect' | 'tribute-country' | 'tribute-tokens' | 'peace' | null;
  reply: 'accept' | 'raise' | 'withdraw' | 'refuse' | null;
}

/** Terms offered to end a war, answered at once (the answer window is shorter than a round). */
export interface SimPeaceOffer {
  id: string;
  warId: string;
  proposerId: UserId;
  recipientId: UserId;
  terms: PeaceTerms;
  status: 'proposed' | 'accepted' | 'declined' | 'withdrawn' | 'lapsed';
}

export interface SimAccord extends AccordRecord {
  rounds: number;
  signedRound: number | null;
  renews: string | null;
}

export interface MissionSlot {
  key: string;
  scope: 'public' | 'secret';
  points: number;
  spec: MissionSpec;
}

export interface Claim {
  userId: UserId;
  missionKey: string;
  kind: MissionSpec['kind'];
  startedRound: number;
  status: 'pending' | 'awarded' | 'interrupted' | 'cancelled';
  endedRound: number | null;
  blockedBy: string[];
}

export interface Award {
  userId: UserId;
  missionKey: string;
  kind: MissionSpec['kind'];
  scope: 'public' | 'secret';
  points: number;
  round: number;
  seq: number;
  /** The round its claim began, or null for a historic mission. */
  claimStartedRound: number | null;
}

export interface WarStats {
  declared: number;
  responses: Record<NonNullable<SimWar['response']>, number>;
  replies: Record<NonNullable<SimWar['reply']>, number>;
  outcomes: Record<WarOutcome, number>;
  /** Wars fought over the board (a game was played). */
  games: number;
  checkmates: number;
  armageddons: number;
  /** Value that changed hands in wars won by attackers, by defenders, and in tribute. */
  valueTaken: number;
  valueRepelled: number;
  valueTribute: number;
  /** Value peace terms handed the attacker, less what they handed the defender. */
  valueSettled: number;
  /** Raises met at once from the reserves set aside at the declaration. */
  fromReserves: number;
  /** Raises after the defender's first, by either side. */
  raisedAgain: number;
  /** Declarations the attacker called off before an answer. */
  recalled: number;
  /** Countries fortified. */
  fortified: number;
  /** Peace terms offered, and accepted. */
  peaceOffered: number;
  peaceAccepted: number;
}

/** What the players did, in order: enough to replay a campaign through the real server. */
export type SimAction =
  /** Every player has a secret mission: round 1 begins. */
  | { t: 'open' }
  | { t: 'round'; round: number }
  /** The host moves on from the last round: the season ends on points. */
  | { t: 'end' }
  | {
      t: 'declare';
      war: string;
      by: UserId;
      targetId: TerritoryId;
      launchId: TerritoryId;
      stake: TerritoryId[];
      reserves?: TerritoryId[];
    }
  | { t: 'respond'; war: string; response: Response }
  /** `by`: who answered (the attacker, or the defender answering the attacker's raise). */
  | { t: 'reply'; war: string; by: UserId; reply: Reply }
  | { t: 'recall'; war: string }
  | { t: 'fortify'; by: UserId; territoryId: TerritoryId }
  /** A player passes their turn: done declaring for the round. */
  | { t: 'pass'; by: UserId }
  | { t: 'peace'; war: string; offer: string; by: UserId; terms: PeaceTerms }
  /** `accord`: the accord the accepted terms signed, if they named one. */
  | { t: 'peace-answer'; war: string; offer: string; accept: boolean; accord?: string }
  | { t: 'game'; war: string; armageddon: boolean; winner: 'white' | 'black' | null; reason: GameEndReason }
  | { t: 'propose'; accord: string; by: UserId; to: UserId; rounds: number }
  | { t: 'answer'; accord: string; accept: boolean }
  | { t: 'renounce'; accord: string; by: UserId };

export interface SimState {
  cfg: SimConfig;
  rules: CampaignRules;
  mr: MissionRules;
  idx: DatasetIndex;
  rng: Streams;
  seed: number;
  players: SimPlayer[];
  byId: Map<UserId, SimPlayer>;
  /** Draft order (seat order). */
  order: UserId[];
  round: number;
  status: 'lobby' | 'draft' | 'selection' | 'active' | 'finished';
  holdings: Map<TerritoryId, Holding>;
  /** Declaring in turns this round, where the rules have it (the server's campaign row keeps it). */
  turns: TurnState | null;
  wars: SimWar[];
  peaceOffers: SimPeaceOffer[];
  accords: SimAccord[];
  history: {
    wars: MissionWar[];
    accords: AccordSpan[];
    roundStarts: RoundStart[];
    awards: AwardMark[];
  };
  seq: number;
  publicSpecs: PublicMissionSpec[];
  claims: Map<string, Claim>;
  claimLog: Claim[];
  awards: Award[];
  /** Mission points and title points (`Variant.titles`) together. */
  points: Map<UserId, number>;
  /** Who holds each title (`Variant.titles`), and how often one changed hands after round 1 began. */
  titles: Map<TitleStat, UserId | null>;
  titleMoves: number;
  /** The titles each player held when round 1 began. */
  titlesAtStart: Record<UserId, TitleStat[]> | null;
  winners: UserId[];
  finishedRound: number | null;
  /** Public missions each player had complete when the draft ended. */
  draftComplete: { userId: UserId; missionKey: string; kind: MissionSpec['kind'] }[];
  stats: WarStats;
  accordStats: { proposed: number; signed: number; renewed: number; broken: number; kept: number };
  tokensWasted: number;
  /** Each player's points and value at the end of each round (index = round). */
  timeline: { points: Record<UserId, number>; value: Record<UserId, number> }[];
  /** First round anyone reached the points to win (horizon mode keeps playing). */
  firstToWinRound: number | null;
  /** Won on points when the last round ended, rather than by reaching the points to win. */
  endedByLimit: boolean;
  nextId: number;
  log: string[];
  actions: SimAction[];
}
