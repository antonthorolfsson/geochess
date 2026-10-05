import {
  durationText,
  missionName,
  missionRequirement,
  SEASON_MEASURE_NAMES,
  joinWords,
  mightText,
  missionTargets,
  seasonDecider,
  tiebreakText,
  type ClaimView,
  type Evaluation,
  type MissionSpec,
  type MissionView,
  type SeasonStanding,
  type TerritoryId,
  type TitleKind,
  type VictoryPlayerView,
  type VictoryResultView,
  type WarView,
} from '@empire/rules';
import type { CampaignModel } from './campaign';
import { formatAreaCompact, formatCount, formatInt, formatUsd } from './format';
import { timeLeft } from './wars';

/** A mission as someone plays it: public missions belong to everyone, a secret one to its player. */
export interface PlayedMission {
  mission: MissionView;
  /** Whose secret mission it is; null for a public one. */
  ownerId: string | null;
}

/** The mission's exact requirement, adapted to the table: Campaign Veteran with two players, a Nemesis's rival. */
export const requirementText = (model: CampaignModel, spec: MissionSpec) =>
  missionRequirement(spec, model.idx, {
    players: model.campaign.members.length,
    playerName: (userId) => model.membersById.get(userId)?.name ?? 'a former player',
  });

export const titleOf = (mission: Pick<MissionView, 'spec'>) => missionName(mission.spec);

/** A player's public standing in the race. */
export function victoryPlayer(model: CampaignModel, userId: string): VictoryPlayerView | undefined {
  return model.campaign.victory?.players.find((p) => p.userId === userId);
}

/** Everyone by points, most first; equal points by name. */
export function pointsRace(model: CampaignModel): { userId: string; points: number }[] {
  const players = model.campaign.victory?.players ?? [];
  return players
    .map((p) => ({ userId: p.userId, points: p.points }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        (model.membersById.get(a.userId)?.name ?? '').localeCompare(model.membersById.get(b.userId)?.name ?? ''),
    );
}

/** A mission the viewer may see, by owner and key: public, a revealed secret, or their own. */
export function findMission(model: CampaignModel, ownerId: string | null, key: string): PlayedMission | null {
  const victory = model.campaign.victory;
  if (!victory) return null;
  if (key !== 'secret') {
    const mission = victory.publicMissions.find((m) => m.key === key);
    return mission ? { mission, ownerId: null } : null;
  }
  if (ownerId === model.me.userId && model.campaign.mySecret?.mission) {
    return { mission: model.campaign.mySecret.mission, ownerId };
  }
  const revealed = ownerId ? victoryPlayer(model, ownerId)?.secret : null;
  return revealed ? { mission: revealed.mission, ownerId } : null;
}

/** Where `userId` stands on a mission, when the viewer may know. */
export function progressOf(model: CampaignModel, userId: string, key: string): Evaluation | undefined {
  if (key === 'secret' && userId === model.me.userId) return model.campaign.mySecret?.progress ?? undefined;
  return victoryPlayer(model, userId)?.progress[key];
}

export interface MissionOverlay {
  /** The countries the mission names. */
  targets: TerritoryId[];
  /** The countries that count right now, for the player whose progress is shown. */
  held: TerritoryId[];
  /** A route: the chain held, or the best one still open. */
  path: TerritoryId[] | null;
}

/**
 * What the map calls out for a mission: its targets, what counts, and any route. Missions without
 * named targets call out the countries that count so far (or, for Two-Theater Power, the two
 * continents). Only built from missions the viewer can see, so the overlay can never show someone
 * else's secret.
 */
export function missionOverlay(
  model: CampaignModel,
  spec: MissionSpec,
  progress: Evaluation | undefined,
): MissionOverlay {
  const held = progress?.evidence.territories ?? [];
  let targets = missionTargets(spec);
  if (targets.length === 0 && spec.kind === 'two_theater_power') {
    targets = model.idx.dataset.territories.filter((t) => spec.continents.includes(t.continent)).map((t) => t.id);
  }
  return { targets: targets.length > 0 ? targets : held, held, path: progress?.evidence.path ?? null };
}

/** Whether a mission has anything to show on the map: targets, or countries that count so far. */
export const hasMapView = (spec: MissionSpec, progress: Evaluation | null | undefined) =>
  missionTargets(spec).length > 0 ||
  spec.kind === 'two_theater_power' ||
  (progress?.evidence.territories.length ?? 0) > 0 ||
  (progress?.evidence.path?.length ?? 0) > 0;

export interface ClaimTiming {
  /** "Can score in round 5" / "Round 5 has come". */
  round: string;
  /** The holding time, in words; null once it has passed. */
  time: string | null;
  /** Unresolved wars that could still break the position. */
  blockers: WarView[];
  /** Everything else is met: only the holding time or a war stands in the way. */
  roundDue: boolean;
}

/**
 * When a claim can score, without promising that it will: it has to be held continuously, and no
 * war may threaten it when the time comes.
 */
export function claimTiming(model: CampaignModel, claim: ClaimView, now: number): ClaimTiming {
  const { round } = model.campaign;
  const hold = model.campaign.victory?.holdMs ?? 0;
  const roundDue = round >= claim.eligibleRound;
  const eligibleAt = claim.eligibleAt ? Date.parse(claim.eligibleAt) : null;
  const time =
    eligibleAt === null
      ? `The ${durationText(hold)} holding time starts with round ${claim.startedRound + 1}.`
      : now < eligibleAt
        ? `At least ${timeLeft(eligibleAt - now)} more to hold.`
        : null;
  const blockers = claim.blockedBy.flatMap((id) => model.campaign.wars.find((w) => w.id === id) ?? []);
  return {
    round: roundDue
      ? `Round ${claim.eligibleRound} has come.`
      : `Can score in round ${claim.eligibleRound} at the earliest.`,
    time,
    blockers,
    roundDue,
  };
}

/** Claims by other players: positions the viewer has until the claim scores to break. */
export const rivalClaims = (model: CampaignModel) =>
  (model.campaign.victory?.claims ?? []).filter((c) => c.userId !== model.me.userId);

/** Each tiebreak measure as the thing that decided, with how to show its figures. */
const DECIDERS = {
  value: [{ text: 'the more valuable empire', format: formatInt }],
  realWorld: [
    { text: 'the larger population', format: formatCount },
    { text: 'the more land', format: formatAreaCompact },
    { text: 'the larger GDP', format: formatUsd },
  ],
};

/**
 * How a season that ran to its last round was decided, said after "the most points won": nothing
 * when points alone did it; for a single winner level on points with the best of the rest, the
 * measure that separated them and both figures (", then the larger population: 812M to 640M");
 * for winners who share it, that they were level on the tiebreak too.
 */
export function tiebreakClause(result: VictoryResultView): string {
  const [first] = result.standings;
  if (!result.seasonEnd || !first) return '';
  // Results stored before the real-world tiebreak were all decided by value, and kept no measures.
  const tiebreak = result.tiebreak ?? 'value';
  if (result.winners.length > 1) {
    return `, and the winners were level on ${joinWords(SEASON_MEASURE_NAMES[tiebreak])} too`;
  }
  const rest = result.standings.find((s) => !result.winners.includes(s.userId));
  if (!rest || rest.points !== first.points) return '';
  const decider =
    first.measures && rest.measures ? seasonDecider(first as SeasonStanding, rest as SeasonStanding) : null;
  if (decider === null) return `, then ${tiebreakText(tiebreak)}`;
  const { text, format } = DECIDERS[tiebreak][decider]!;
  return `, then ${text}: ${format(first.measures![decider]!)} to ${format(rest.measures![decider]!)}`;
}

/** A title's figure as players read it: people, land, GDP, or military might per 1,000 of the world. */
export function titleFigureText(kind: TitleKind, n: number): string {
  switch (kind) {
    case 'population':
      return `${formatCount(n)} people`;
    case 'land':
      return formatAreaCompact(n);
    case 'economy':
      return formatUsd(n);
    case 'military':
      return mightText(n);
  }
}
