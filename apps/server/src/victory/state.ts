import {
  missionRules,
  publicMissionKey,
  SECRET_MISSION_KEY,
  type AccordSpan,
  type AwardMark,
  type CampaignEvent,
  type MissionHistory,
  type CampaignRules,
  type MissionSpec,
  type MissionWar,
  type MissionWorld,
  type OpenWar,
  type RoundStart,
  type TerritoryId,
} from '@empire/rules';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { CampaignRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { events, holdings, missionAwards, missionClaims, missionPlayers, wars } from '../db/schema';

export type MissionPlayerRow = typeof missionPlayers.$inferSelect;
export type ClaimRow = typeof missionClaims.$inferSelect;
export type AwardRow = typeof missionAwards.$inferSelect;

/** A mission as a player plays it: a public one (by slot) or their secret one. */
export interface MissionSlot {
  key: string;
  scope: 'public' | 'secret';
  points: number;
  spec: MissionSpec;
}

export function publicSlots(rules: CampaignRules): MissionSlot[] {
  const points = missionRules(rules.victory.version).points.public;
  return rules.victory.publicMissions.map((spec, slot) => ({
    key: publicMissionKey(slot),
    scope: 'public',
    points,
    spec,
  }));
}

export function secretSlot(rules: CampaignRules, player: Pick<MissionPlayerRow, 'secret'>): MissionSlot | null {
  if (!player.secret) return null;
  const points = missionRules(rules.victory.version).points.secret;
  return { key: SECRET_MISSION_KEY, scope: 'secret', points, spec: player.secret };
}

/** Everything a player can score: the public missions and their own secret one. */
export function missionsFor(rules: CampaignRules, player: Pick<MissionPlayerRow, 'secret'>): MissionSlot[] {
  const secret = secretSlot(rules, player);
  return secret ? [...publicSlots(rules), secret] : publicSlots(rules);
}

type ResolvedPayload = Extract<CampaignEvent, { type: 'war.resolved' }>['payload'];
type SignedPayload = Extract<CampaignEvent, { type: 'accord.signed' }>['payload'];
type BrokenPayload = Extract<CampaignEvent, { type: 'accord.broken' }>['payload'];
type AwardedPayload = Extract<CampaignEvent, { type: 'mission.awarded' }>['payload'];
type TitlePayload = Extract<CampaignEvent, { type: 'title.changed' }>['payload'];

const HISTORY_EVENTS = [
  'war.declared',
  'war.resolved',
  'accord.signed',
  'accord.broken',
  'accord.kept',
  'round.started',
  'mission.awarded',
  'title.changed',
];

/**
 * The history the battle and accord missions count, read from the event log in order (event ids
 * give the exact order of wars, accords, round starts and awards).
 */
export async function loadHistory(db: Tx | Db, campaignId: string): Promise<MissionHistory> {
  const eventRows = await db
    .select({ id: events.id, type: events.type, payload: events.payload })
    .from(events)
    .where(and(eq(events.campaignId, campaignId), inArray(events.type, HISTORY_EVENTS)))
    .orderBy(asc(events.id));
  const warRows = await db
    .select({
      id: wars.id,
      attackerId: wars.attackerId,
      defenderId: wars.defenderId,
      launchId: wars.launchId,
      targetId: wars.targetId,
      outcome: wars.outcome,
      declaredRound: wars.declaredRound,
      resolvedRound: wars.resolvedRound,
    })
    .from(wars)
    .where(and(eq(wars.campaignId, campaignId), eq(wars.status, 'resolved')));
  const warById = new Map(warRows.map((w) => [w.id, w]));

  const history: { wars: MissionWar[]; accords: AccordSpan[]; roundStarts: RoundStart[]; awards: AwardMark[] } = {
    wars: [],
    accords: [],
    roundStarts: [],
    awards: [],
  };
  const declaredAt = new Map<string, number>();
  const spans = new Map<string, AccordSpan>();
  for (const e of eventRows) {
    switch (e.type) {
      case 'war.declared':
        declaredAt.set((e.payload as { warId: string }).warId, e.id);
        break;
      case 'war.resolved': {
        const p = e.payload as ResolvedPayload;
        const war = warById.get(p.warId);
        // One entry per war: an Armageddon tiebreak is part of the war it settles.
        if (!war || !war.outcome || history.wars.some((w) => w.id === war.id)) break;
        history.wars.push({
          id: war.id,
          attackerId: war.attackerId,
          defenderId: war.defenderId,
          launchId: war.launchId,
          targetId: war.targetId,
          outcome: war.outcome,
          transfers: p.transfers,
          declaredRound: war.declaredRound,
          round: war.resolvedRound ?? 0,
          declaredSeq: declaredAt.get(war.id) ?? 0,
          seq: e.id,
          endReason: p.reason ?? null,
        });
        break;
      }
      case 'accord.signed': {
        const p = e.payload as SignedPayload;
        if (p.renews) {
          const renewed = spans.get(p.renews);
          if (renewed && renewed.to === null) renewed.to = e.id;
        }
        const span: AccordSpan = {
          id: p.accordId,
          players: [p.proposerId, p.recipientId],
          from: e.id,
          to: null,
          brokenBy: null,
        };
        spans.set(p.accordId, span);
        history.accords.push(span);
        break;
      }
      case 'accord.broken': {
        const p = e.payload as BrokenPayload;
        const span = spans.get(p.accordId);
        if (span && span.to === null) Object.assign(span, { to: e.id, brokenBy: p.breakerId });
        break;
      }
      case 'accord.kept': {
        const span = spans.get((e.payload as { accordId: string }).accordId);
        if (span && span.to === null) span.to = e.id;
        break;
      }
      case 'round.started':
        history.roundStarts.push({ round: (e.payload as { round: number }).round, seq: e.id });
        break;
      case 'mission.awarded': {
        const p = e.payload as AwardedPayload;
        history.awards.push({ userId: p.userId, points: p.points, seq: e.id });
        break;
      }
      // A title's points go with it: minus for who lost it, plus for who took it.
      case 'title.changed': {
        const p = e.payload as TitlePayload;
        if (p.from) history.awards.push({ userId: p.from, points: -p.points, seq: e.id });
        if (p.to) history.awards.push({ userId: p.to, points: p.points, seq: e.id });
        break;
      }
    }
  }
  return history;
}

/** The mission world of a campaign: who holds what, each player's baseline, and its history. */
export async function loadWorld(
  ctx: AppContext,
  db: Tx | Db,
  campaign: CampaignRow,
  memberIds: readonly string[],
  players: readonly MissionPlayerRow[],
): Promise<MissionWorld> {
  const holdingRows = await db
    .select({ territoryId: holdings.territoryId, ownerId: holdings.ownerId })
    .from(holdings)
    .where(eq(holdings.campaignId, campaign.id));
  const baseline = new Map(players.map((p) => [p.userId, new Set<TerritoryId>(p.baseline)]));
  return {
    idx: ctx.datasets.get(campaign.datasetVersion),
    players: [...memberIds].sort(),
    owners: new Map(holdingRows.map((h) => [h.territoryId, h.ownerId])),
    baseline,
    history: await loadHistory(db, campaign.id),
  };
}

export async function loadPlayers(db: Tx | Db, campaignId: string): Promise<MissionPlayerRow[]> {
  const rows = await db.select().from(missionPlayers).where(eq(missionPlayers.campaignId, campaignId));
  return rows.sort((a, b) => (a.userId < b.userId ? -1 : 1));
}

export async function loadAwards(db: Tx | Db, campaignId: string): Promise<AwardRow[]> {
  return db.select().from(missionAwards).where(eq(missionAwards.campaignId, campaignId)).orderBy(asc(missionAwards.id));
}

export async function loadPendingClaims(db: Tx | Db, campaignId: string): Promise<ClaimRow[]> {
  return db
    .select()
    .from(missionClaims)
    .where(and(eq(missionClaims.campaignId, campaignId), eq(missionClaims.status, 'pending')))
    .orderBy(asc(missionClaims.id));
}

/** Unresolved wars as the claim blockers see them. */
export async function loadOpenWars(db: Tx | Db, campaignId: string): Promise<OpenWar[]> {
  const rows = await db
    .select()
    .from(wars)
    .where(and(eq(wars.campaignId, campaignId), ne(wars.status, 'resolved')));
  return rows.map((w) => ({
    id: w.id,
    attackerId: w.attackerId,
    defenderId: w.defenderId,
    targetId: w.targetId,
    launchId: w.launchId,
    stake: w.stake,
    status: w.status,
    counter: w.counter,
    reserves: w.reserves,
  }));
}

/**
 * Where each unresolved war's declaration falls in the campaign's history (its `war.declared`
 * event id), by war id: what Kingslayer reads to know who led when a war was declared.
 */
export async function loadDeclarations(
  db: Tx | Db,
  campaignId: string,
  warIds: readonly string[],
): Promise<Record<string, number>> {
  if (warIds.length === 0) return {};
  const open = new Set(warIds);
  const rows = await db
    .select({ id: events.id, payload: events.payload })
    .from(events)
    .where(and(eq(events.campaignId, campaignId), eq(events.type, 'war.declared')));
  const out: Record<string, number> = {};
  for (const e of rows) {
    const warId = (e.payload as { warId: string }).warId;
    if (open.has(warId)) out[warId] = e.id;
  }
  return out;
}

/** Each player's points: the award ledger, and the titles they hold now (mission rules version 5 on). */
export function pointsOf(
  awards: readonly Pick<AwardRow, 'userId' | 'points'>[],
  memberIds: readonly string[],
  campaign?: Pick<CampaignRow, 'rules' | 'titles'>,
) {
  const points = new Map(memberIds.map((id) => [id, 0]));
  for (const a of awards) points.set(a.userId, (points.get(a.userId) ?? 0) + a.points);
  const per = campaign ? (missionRules(campaign.rules.victory.version).titles?.points ?? 0) : 0;
  if (per > 0) {
    for (const holder of Object.values(campaign!.titles)) {
      if (holder && points.has(holder)) points.set(holder, points.get(holder)! + per);
    }
  }
  return points;
}
