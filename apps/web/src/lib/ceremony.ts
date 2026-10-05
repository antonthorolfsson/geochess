import {
  SECRET_MISSION_KEY,
  TITLES,
  missionName,
  type EventView,
  type MissionKind,
  type MissionSpec,
  type TitleKind,
} from '@empire/rules';
import type { CampaignModel } from './campaign';

/**
 * Award ceremonies: the moments points move (a mission scored, a title changing hands) played out
 * for everyone in the campaign, from the events of the change that moved them.
 */

/** Everyone's points and who holds each title, as a ceremony's leaderboard shows them. */
export interface Standings {
  points: Record<string, number>;
  holders: Partial<Record<TitleKind, string | null>>;
}

/** A title passing from its holder (or nobody) to its new holder (or nobody). */
export interface TitleMove {
  title: TitleKind;
  from: string | null;
  to: string | null;
  points: number;
  /** The points of the players it passes between, after it. */
  after: Record<string, number>;
}

interface CeremonyBase {
  /** The first event behind it, which keys it. */
  id: number;
  before: Standings;
  after: Standings;
}

/** Points scored for a mission. */
export interface MissionCeremony extends CeremonyBase {
  kind: 'mission';
  userId: string;
  missionKey: string;
  missionKind: MissionKind;
  scope: 'public' | 'secret';
  /** The mission's requirements, where the viewer may see them; without them only its name shows. */
  spec: MissionSpec | null;
  points: number;
}

/** Titles changing hands in one change to the campaign, together. */
export interface TitlesCeremony extends CeremonyBase {
  kind: 'titles';
  moves: TitleMove[];
}

export type Ceremony = MissionCeremony | TitlesCeremony;

/** Everyone's standing as the campaign view has it. */
export function standingsOf(model: CampaignModel): Standings {
  const victory = model.campaign.victory;
  return {
    points: Object.fromEntries((victory?.players ?? []).map((p) => [p.userId, p.points])),
    holders: Object.fromEntries((victory?.titles ?? []).map((t) => [t.kind, t.holderId])),
  };
}

const copy = (s: Standings): Standings => ({ points: { ...s.points }, holders: { ...s.holders } });

/**
 * The standings before a change, where its events say: each player's points before the first
 * event that moves them, each title's holder before it first moves. So a campaign view refetched
 * after the change, which got here before its events did, can't skew where the ceremonies start.
 */
function rewound(events: readonly EventView[], start: Standings): Standings {
  const before = copy(start);
  const seen = new Set<string>();
  const set = (userId: string, points: number | undefined) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    if (points !== undefined) before.points[userId] = points;
  };
  const moved = new Set<TitleKind>();
  for (const e of events) {
    if (e.type === 'title.changed') {
      const { title, from, to, points, totals } = e.payload;
      if (!moved.has(title)) before.holders[title] = from;
      moved.add(title);
      if (from !== null) set(from, totals[from] === undefined ? undefined : totals[from] + points);
      if (to !== null) set(to, totals[to] === undefined ? undefined : totals[to] - points);
    } else if (e.type === 'mission.awarded') {
      set(e.payload.userId, e.payload.total - e.payload.points);
    }
  }
  return before;
}

/**
 * The ceremonies for the events of one change, in the order they happened, from the standings
 * before it: the titles that moved together (the server settles titles first), then each mission
 * scored. A title moving twice starts a new ceremony, as does a title after a mission. Also returns
 * the standings after them all.
 *
 * `missionSpec` finds a mission the viewer may see (public, their own secret, or a revealed one);
 * a secret completed in this very change is revealed by one of its events, so it's taken from there.
 */
export function ceremoniesFrom(
  events: readonly EventView[],
  start: Standings,
  missionSpec: (userId: string, missionKey: string) => MissionSpec | null,
): { ceremonies: Ceremony[]; end: Standings } {
  const ceremonies: Ceremony[] = [];
  const revealed = new Map<string, MissionSpec>();
  for (const e of events) if (e.type === 'mission.revealed') revealed.set(e.payload.userId, e.payload.mission);
  let current = rewound(events, start);
  let titles: TitlesCeremony | null = null;
  for (const e of events) {
    if (e.type === 'title.changed') {
      const { title, from, to, points, totals } = e.payload;
      if (!titles || titles.moves.some((m) => m.title === title)) {
        titles = { kind: 'titles', id: e.id, before: current, after: current, moves: [] };
        ceremonies.push(titles);
      }
      const next = copy(current);
      next.holders[title] = to;
      const after: Record<string, number> = {};
      for (const [id, sign] of [
        [from, -1],
        [to, 1],
      ] as const) {
        if (id === null) continue;
        after[id] = totals[id] ?? (current.points[id] ?? 0) + sign * points;
        next.points[id] = after[id];
      }
      titles.moves.push({ title, from, to, points, after });
      titles.after = next;
      current = next;
    } else if (e.type === 'mission.awarded') {
      titles = null;
      const { userId, missionKey, kind, points, total } = e.payload;
      const secret = missionKey === SECRET_MISSION_KEY;
      const next = copy(current);
      next.points[userId] = total;
      ceremonies.push({
        kind: 'mission',
        id: e.id,
        before: current,
        after: next,
        userId,
        missionKey,
        missionKind: kind,
        scope: secret ? 'secret' : 'public',
        spec: (secret ? revealed.get(userId) : undefined) ?? missionSpec(userId, missionKey),
        points,
      });
      current = next;
    }
  }
  return { ceremonies, end: current };
}

/** Players by points, most first; equal points by name, as the race lists them. */
export function rankByPoints(points: Record<string, number>, nameOf: (userId: string) => string): string[] {
  return Object.keys(points).sort((a, b) => points[b]! - points[a]! || nameOf(a).localeCompare(nameOf(b)));
}

/** The players a ceremony gives or takes points from, in the order it does. */
export function ceremonyPlayers(c: Ceremony): string[] {
  if (c.kind === 'mission') return [c.userId];
  return [...new Set(c.moves.flatMap((m) => [m.from, m.to]).filter((id): id is string => id !== null))];
}

/** The heading over a ceremony: "Mission complete", "Title changes hands", "Titles awarded"… */
export function ceremonyLabel(c: Ceremony): string {
  if (c.kind === 'mission') return c.scope === 'secret' ? 'Secret mission complete' : 'Mission complete';
  const many = c.moves.length > 1;
  if (c.moves.every((m) => m.from === null)) return many ? 'Titles awarded' : 'Title awarded';
  if (!many && c.moves[0]!.to === null) return 'Title lost';
  return many ? 'Titles change hands' : 'Title changes hands';
}

/** Says a player in a sentence, the viewer as "you", with the verb to match ("Bo takes", "You take"). */
function sayer(nameOf: (userId: string) => string, me: string) {
  return {
    subject: (id: string, one: string, you: string) => (id === me ? `You ${you}` : `${nameOf(id)} ${one}`),
    object: (id: string) => (id === me ? 'you' : nameOf(id)),
  };
}

/** A title's move, under its name: "Bo takes it from Ann", "You hold it", "Ann loses it: the lead is shared". */
export function moveText(move: TitleMove, nameOf: (userId: string) => string, me: string): string {
  const { subject, object } = sayer(nameOf, me);
  if (move.from !== null && move.to !== null)
    return `${subject(move.to, 'takes', 'take')} it from ${object(move.from)}`;
  if (move.to !== null) return `${subject(move.to, 'holds', 'hold')} it`;
  return `${subject(move.from!, 'loses', 'lose')} it: the lead is shared`;
}

const pointsWord = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** The whole ceremony in words, for screen readers. */
export function ceremonySummary(c: Ceremony, nameOf: (userId: string) => string, me: string, version: number): string {
  const { subject } = sayer(nameOf, me);
  if (c.kind === 'mission') {
    const name = c.spec ? missionName(c.spec) : missionName({ kind: c.missionKind }, version);
    return `${subject(c.userId, 'scored', 'scored')} ${name}: +${c.points}, ${pointsWord(c.after.points[c.userId] ?? 0)}.`;
  }
  const moves = c.moves.map((m) => `${TITLES[m.title].name}: ${moveText(m, nameOf, me)}.`);
  const totals = ceremonyPlayers(c).map((id) => `${id === me ? 'you' : nameOf(id)} ${c.after.points[id] ?? 0}`);
  return `${moves.join(' ')} Points: ${totals.join(', ')}.`;
}

// ---------------------------------------------------------------------------------------------
// What was just won, so what shows it elsewhere (a mission card's stamp, a title's token) can make
// an entrance when it first appears, rather than every time it's drawn.

const fresh = new Map<string, number>();

/** Marks `key` as just won, for `ms`. */
export function markFresh(key: string, ms: number, now = Date.now()): void {
  fresh.set(key, now + ms);
}

/** Whether `key` was won within its time. */
export function isFresh(key: string, now = Date.now()): boolean {
  const until = fresh.get(key);
  if (until === undefined) return false;
  if (until > now) return true;
  fresh.delete(key);
  return false;
}

/** A mission scored by a player, for `markFresh`. */
export const awardKey = (campaignId: string, userId: string, missionKey: string) =>
  `award:${campaignId}:${userId}:${missionKey}`;

/** A title won by a player (user ids are the same in every campaign), for `markFresh`. */
export const titleKey = (kind: TitleKind, userId: string) => `title:${kind}:${userId}`;
