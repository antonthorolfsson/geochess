/**
 * A campaign as each bot sees it. `loadSnapshot` reads everything in one consistent read; then
 * `botState` builds one bot's view in the simulator's terms, holding only what that player may
 * see: its own secret mission, options, peace offers and accord proposals, and nobody else's until
 * the rules make them public (a revealed secret, a signed accord, the terms of a settled war).
 */
import {
  EMPTY_HISTORY,
  SECRET_MISSION_KEY,
  parseRules,
  type AccordStatus,
  type DatasetIndex,
  type MissionHistory,
  type MissionSpec,
  type TerritoryId,
} from '@empire/rules';
import {
  liveState,
  type Award,
  type Claim,
  type SimAccord,
  type SimPlayer,
  type SimState,
  type SimWar,
} from '@empire/sim/live';
import { and, asc, eq, gte, max, ne, or } from 'drizzle-orm';
import type { CampaignRow, MemberRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { accords, campaigns, events, holdings, members, peaceOffers, wars } from '../db/schema';
import { turnState } from '../wars/turns';
import {
  loadAwards,
  loadHistory,
  loadPendingClaims,
  loadPlayers,
  publicSlots,
  type AwardRow,
  type ClaimRow,
  type MissionPlayerRow,
} from '../victory/state';
import type { PeaceOfferRow, WarRow } from '../wars/board';

type HoldingRow = Pick<typeof holdings.$inferSelect, 'territoryId' | 'ownerId' | 'acquiredRound' | 'fortifiedUntil'>;
type AccordRow = typeof accords.$inferSelect;

export interface Snapshot {
  /** With its rules normalized. */
  campaign: CampaignRow;
  members: MemberRow[];
  holdings: HoldingRow[];
  /** Unresolved wars, and those resolved in the last few rounds (truces, recent withdrawals). */
  wars: WarRow[];
  accords: AccordRow[];
  /** Peace offers waiting for an answer. */
  peace: PeaceOfferRow[];
  players: MissionPlayerRow[];
  claims: ClaimRow[];
  awards: AwardRow[];
  history: MissionHistory;
  /** The campaign's latest event id. */
  seq: number;
}

/** How far back resolved wars matter to a bot: truces, and a raise it withdrew from lately. */
const RECENT_ROUNDS = 2;

/** The campaign as a whole, or null if it has gone or has no bots. */
export async function loadSnapshot(ctx: AppContext, campaignId: string): Promise<Snapshot | null> {
  return ctx.db.transaction(
    async (tx) => {
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      if (!row) return null;
      const memberRows = await tx
        .select()
        .from(members)
        .where(eq(members.campaignId, campaignId))
        .orderBy(asc(members.joinedAt));
      if (!memberRows.some((m) => m.botLevel !== null)) return null;
      const campaign = { ...row, rules: parseRules(row.rules) };
      const since = campaign.round - Math.max(campaign.rules.war.truceRounds, RECENT_ROUNDS);
      const [latest] = await tx
        .select({ seq: max(events.id) })
        .from(events)
        .where(eq(events.campaignId, campaignId));
      return {
        campaign,
        members: memberRows,
        holdings: await tx
          .select({
            territoryId: holdings.territoryId,
            ownerId: holdings.ownerId,
            acquiredRound: holdings.acquiredRound,
            fortifiedUntil: holdings.fortifiedUntil,
          })
          .from(holdings)
          .where(eq(holdings.campaignId, campaignId)),
        wars: await tx
          .select()
          .from(wars)
          .where(and(eq(wars.campaignId, campaignId), or(ne(wars.status, 'resolved'), gte(wars.resolvedRound, since)))),
        accords: await tx.select().from(accords).where(eq(accords.campaignId, campaignId)),
        peace: await tx
          .select()
          .from(peaceOffers)
          .where(and(eq(peaceOffers.campaignId, campaignId), eq(peaceOffers.status, 'proposed'))),
        players: await loadPlayers(tx, campaignId),
        claims: await loadPendingClaims(tx, campaignId),
        awards: await loadAwards(tx, campaignId),
        history: await loadHistory(tx, campaignId),
        seq: latest?.seq ?? 0,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export const botsIn = (snap: Pick<Snapshot, 'members'>): MemberRow[] => snap.members.filter((m) => m.botLevel !== null);

/** Accord statuses only the two players know about. */
const PRIVATE_ACCORDS = new Set<AccordStatus>(['proposed', 'declined', 'withdrawn', 'lapsed']);

const revealed = (p: MissionPlayerRow | undefined) => p?.revealedAt != null;

/** The campaign as the bot `botId` sees it. `seed` seeds its random choices for this decision. */
export function botState(ctx: AppContext, snap: Snapshot, botId: string, seed: number): SimState {
  const { campaign } = snap;
  const round = campaign.round;
  const mission = new Map(snap.players.map((p) => [p.userId, p]));
  const holders = new Set(snap.holdings.map((h) => h.ownerId));
  const order = campaign.draftOrder ?? snap.members.map((m) => m.userId);

  const players: SimPlayer[] = snap.members.map((m) => {
    const mp = mission.get(m.userId);
    const own = m.userId === botId;
    return {
      id: m.userId,
      seat: Math.max(0, order.indexOf(m.userId)),
      // Strategy assumes an even game against anyone: the level only changes the chess.
      elo: 1500,
      tokens: m.tokens,
      reputation: m.reputation,
      baseline: new Set(mp?.baseline ?? []),
      options: own ? (mp?.options ?? []) : [],
      secret: own || revealed(mp) ? (mp?.secret ?? null) : null,
      forced: false,
      revealedRound: revealed(mp) ? (mp!.revealedRound ?? round) : null,
      eliminatedRound: campaign.status === 'active' && !holders.has(m.userId) ? round : null,
    };
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  const wars: SimWar[] = snap.wars.map((w) => ({
    id: w.id,
    attackerId: w.attackerId,
    defenderId: w.defenderId,
    targetId: w.targetId,
    launchId: w.launchId,
    stake: w.stake,
    reserves: w.reserves,
    status: w.status,
    counter: w.counter,
    redirectedFrom: w.redirectedFrom,
    declaredRound: w.declaredRound,
    declaredSeq: 0,
    dueRound: round,
    outcome: w.outcome,
    resolvedRound: w.resolvedRound,
    seq: null,
    transfers: [],
    endReason: null,
    armageddon: false,
    response: null,
    reply: null,
  }));

  const party = (a: { proposerId: string; recipientId: string }) => a.proposerId === botId || a.recipientId === botId;
  const accordList: SimAccord[] = snap.accords
    .filter((a) => !PRIVATE_ACCORDS.has(a.status) || party(a))
    .map((a) => ({
      id: a.id,
      proposerId: a.proposerId,
      recipientId: a.recipientId,
      status: a.status,
      endsRound: a.endsRound,
      endedRound: a.endedRound,
      brokenBy: a.brokenBy,
      rounds: a.rounds,
      signedRound: a.signedRound,
      renews: a.renews,
    }));

  // A pending claim names its mission; a secret one only counts once it's public (or the bot's own).
  const publicSpecs = new Map(publicSlots(campaign.rules).map((slot) => [slot.key, slot.spec]));
  const specOf = (userId: string, key: string): MissionSpec | null =>
    key === SECRET_MISSION_KEY ? (byId.get(userId)?.secret ?? null) : (publicSpecs.get(key) ?? null);
  const claims: Claim[] = snap.claims.flatMap((c) => {
    const spec = specOf(c.userId, c.missionKey);
    if (!spec) return [];
    return [
      {
        userId: c.userId,
        missionKey: c.missionKey,
        kind: spec.kind,
        startedRound: c.startedRound,
        status: 'pending',
        endedRound: null,
        blockedBy: c.blockedBy,
      },
    ];
  });
  const awards: Award[] = snap.awards.map((a) => ({
    userId: a.userId,
    missionKey: a.missionKey,
    kind: a.kind as MissionSpec['kind'],
    scope: a.missionKey === SECRET_MISSION_KEY ? 'secret' : 'public',
    points: a.points,
    round: a.round,
    seq: 0,
    claimStartedRound: null,
  }));

  return liveState({
    rules: campaign.rules,
    idx: ctx.datasets.get(campaign.datasetVersion),
    seed,
    status: campaign.status,
    round,
    seq: snap.seq,
    players,
    order,
    holdings: new Map(
      snap.holdings.map((h) => [
        h.territoryId,
        { ownerId: h.ownerId, acquiredRound: h.acquiredRound, fortifiedUntil: h.fortifiedUntil },
      ]),
    ),
    wars,
    peaceOffers: snap.peace.filter(party).map((o) => ({
      id: o.id,
      warId: o.warId,
      proposerId: o.proposerId,
      recipientId: o.recipientId,
      terms: o.terms,
      status: o.status,
    })),
    accords: accordList,
    history: snap.history,
    claims,
    awards,
    turns: turnState(campaign),
  });
}

/** The draft as a bot sees it when its pick comes up: the map so far and the public missions. */
export function draftState(
  idx: DatasetIndex,
  campaign: CampaignRow,
  memberRows: readonly MemberRow[],
  owners: ReadonlyMap<TerritoryId, string>,
  seed: number,
): SimState {
  const order = campaign.draftOrder ?? memberRows.map((m) => m.userId);
  return liveState({
    rules: campaign.rules,
    idx,
    seed,
    status: 'draft',
    round: 0,
    seq: 0,
    players: memberRows.map((m) => ({
      id: m.userId,
      seat: Math.max(0, order.indexOf(m.userId)),
      elo: 1500,
      tokens: m.tokens,
      reputation: m.reputation,
      baseline: new Set(),
      options: [],
      secret: null,
      forced: false,
      revealedRound: null,
      eliminatedRound: null,
    })),
    order,
    holdings: new Map([...owners].map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
    wars: [],
    peaceOffers: [],
    accords: [],
    history: EMPTY_HISTORY,
    claims: [],
    awards: [],
    turns: null,
  });
}
