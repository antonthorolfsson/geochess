/**
 * The simulator's bots, for real campaigns: the game server's bot players make every decision
 * here (apps/server/src/bots/). The server builds each bot's view of its campaign as a `SimState`
 * holding only what that player can see, asks for one decision at a time, and carries it out
 * through the same services a person's requests go to.
 */
import {
  legalPicks,
  missionRules,
  type CampaignRules,
  type DatasetIndex,
  type Holding,
  type MissionHistory,
  type SecretOption,
  type TerritoryId,
  type TurnState,
  type UserId,
} from '@empire/rules';
import type { Answer, Bots } from './bots';
import { DEFAULT_KNOBS, knobsFor, type BotKnobs } from './bots/knobs';
import {
  PROPOSED_ACCORD_ROUNDS,
  accepts,
  appetites,
  breaksAccord,
  proposalPartner,
  standardBots,
} from './bots/standard';
import { DEFAULT_CHESS } from './engine/chess';
import { emptyStats } from './engine/state';
import type { Award, Claim, SimAccord, SimConfig, SimPeaceOffer, SimPlayer, SimState, SimWar } from './engine/types';
import type { Declaration, Reply, Response } from './engine/wars';
import { streams } from './random';

export { DEFAULT_KNOBS, PROPOSED_ACCORD_ROUNDS };
export type { Answer, Award, BotKnobs, Claim, Declaration, Reply, Response };
export type { SimAccord, SimPeaceOffer, SimPlayer, SimState, SimWar };

/** A campaign as one player sees it, in the simulator's terms. */
export interface LiveCampaign {
  rules: CampaignRules;
  idx: DatasetIndex;
  /** Seeds the bots' random choices (noise in the draft, whether to raise or propose). */
  seed: number;
  status: SimState['status'];
  round: number;
  /** The latest event id: a hypothetical war comes after it. */
  seq: number;
  players: SimPlayer[];
  /** The draft order. */
  order: UserId[];
  holdings: Map<TerritoryId, Holding>;
  wars: SimWar[];
  peaceOffers: SimPeaceOffer[];
  accords: SimAccord[];
  history: MissionHistory;
  /** Pending claims. */
  claims: Claim[];
  awards: Award[];
  /** Declaring in turns this round, or null where anyone declares whenever they like. */
  turns: TurnState | null;
}

export function liveState(c: LiveCampaign): SimState {
  const cfg: SimConfig = {
    scenario: 'live',
    players: c.players.length,
    draftMode: c.rules.draft.mode,
    publics: 'default',
    pace: c.rules.war.pace,
    latency: [1],
    waves: 1,
    mode: 'normal',
    roundCap: Infinity,
    missionVersion: c.rules.victory.version,
    dataset: c.idx.dataset.version,
    lastRound: c.rules.victory.lastRound ?? null,
    war: {},
    chess: DEFAULT_CHESS,
    elo: { kind: 'equal' },
    bots: knobsFor(DEFAULT_KNOBS, c.idx.dataset.version),
    variant: null,
    debug: false,
    trace: false,
  };
  const points = new Map(c.players.map((p) => [p.id, 0]));
  for (const a of c.awards) points.set(a.userId, (points.get(a.userId) ?? 0) + a.points);
  return {
    cfg,
    rules: c.rules,
    mr: missionRules(c.rules.victory.version),
    idx: c.idx,
    rng: streams(c.seed),
    seed: c.seed,
    players: c.players,
    byId: new Map(c.players.map((p) => [p.id, p])),
    order: c.order,
    round: c.round,
    status: c.status,
    holdings: c.holdings,
    wars: c.wars,
    peaceOffers: c.peaceOffers,
    accords: c.accords,
    history: {
      wars: [...c.history.wars],
      accords: c.history.accords.map((a) => ({ ...a })),
      roundStarts: [...c.history.roundStarts],
      awards: [...c.history.awards],
    },
    seq: c.seq,
    publicSpecs: c.rules.victory.mode === 'objectives' ? c.rules.victory.publicMissions : [],
    claims: new Map(c.claims.map((claim) => [`${claim.userId}\n${claim.missionKey}`, claim])),
    claimLog: [...c.claims],
    awards: c.awards,
    points,
    winners: [],
    finishedRound: null,
    draftComplete: [],
    stats: emptyStats(),
    accordStats: { proposed: 0, signed: 0, renewed: 0, broken: 0, kept: 0 },
    tokensWasted: 0,
    timeline: [],
    firstToWinRound: null,
    endedByLimit: false,
    nextId: 1,
    log: [],
    actions: [],
    turns: c.turns,
  };
}

/** Every decision a bot makes, one at a time, on a state built for it. */
export interface LiveBots {
  /** Its pick when its turn in the draft comes, or null with nothing left to claim. */
  draftPick(s: SimState, userId: UserId): TerritoryId | null;
  chooseSecret(s: SimState, player: SimPlayer): SecretOption | null;
  /** Its answer to a declaration against it, possibly peace terms first. */
  respond(s: SimState, war: SimWar): Answer;
  reply(s: SimState, war: SimWar): Reply;
  answerPeace(s: SimState, war: SimWar, offer: SimPeaceOffer): boolean;
  /** A country to fortify at the start of a round, or null. */
  fortify(s: SimState, player: SimPlayer): TerritoryId | null;
  declare(s: SimState, player: SimPlayer): Declaration | null;
  /** The first accord in force it breaks now, if any (war rounds only). */
  renounce(s: SimState, player: SimPlayer): SimAccord | null;
  /** The neighbour it proposes an accord to this round, if any (`PROPOSED_ACCORD_ROUNDS` long). */
  propose(s: SimState, player: SimPlayer, blocked: (partnerId: UserId) => boolean): UserId | null;
  /** Whether it signs this proposal to it. */
  accept(s: SimState, accord: SimAccord): boolean;
}

export function liveBots(base: BotKnobs = DEFAULT_KNOBS): LiveBots {
  // Each campaign's bots play with the knobs scaled to its dataset's values.
  const byDataset = new Map<string, { knobs: BotKnobs; bots: Bots }>();
  const at = (s: SimState) => {
    const version = s.idx.dataset.version;
    let entry = byDataset.get(version);
    if (!entry) {
      const knobs = knobsFor(base, version);
      entry = { knobs, bots: standardBots(knobs) };
      byDataset.set(version, entry);
    }
    return entry;
  };
  return {
    draftPick(s, userId) {
      const owners = new Map([...s.holdings].map(([id, h]) => [id, h.ownerId]));
      const legal = legalPicks(s.idx, s.rules, owners, userId);
      return legal.length > 0 ? at(s).bots.draftPick(s, userId, legal) : null;
    },
    chooseSecret: (s, player) => at(s).bots.chooseSecret(s, player, player.options),
    respond: (s, war) => at(s).bots.respond(s, war),
    reply: (s, war) => at(s).bots.reply(s, war),
    answerPeace: (s, war, offer) => at(s).bots.answerPeace(s, war, offer),
    fortify: (s, player) => at(s).bots.fortify(s, player),
    declare: (s, player) => at(s).bots.declare(s, player, 0),
    renounce(s, player) {
      const { knobs } = at(s);
      if (!knobs.accords || s.round < 1) return null;
      const appetiteOf = appetites(s, knobs);
      const mine = s.accords.filter(
        (a) => a.status === 'active' && (a.proposerId === player.id || a.recipientId === player.id),
      );
      return mine.find((a) => breaksAccord(s, knobs, player.id, a, appetiteOf)) ?? null;
    },
    propose(s, player, blocked) {
      const { knobs } = at(s);
      return knobs.accords ? proposalPartner(s, knobs, player.id, appetites(s, knobs), blocked) : null;
    },
    accept(s, accord) {
      const { knobs } = at(s);
      if (!knobs.accords) return false;
      return accepts(s, knobs, accord.recipientId, accord.proposerId, appetites(s, knobs)(accord.recipientId));
    },
  };
}
