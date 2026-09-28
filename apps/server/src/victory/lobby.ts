import {
  PUBLIC_MISSION_KINDS,
  generatePublicMission,
  generatePublicMissions,
  missionName,
  missionRules,
  publicMissionIssue,
  publicTargets,
  type CampaignRules,
  type DatasetIndex,
  type PublicMissionKind,
  type PublicMissionSpec,
  type TerritoryId,
} from '@empire/rules';
import { eq } from 'drizzle-orm';
import { mutate, requireHost, requireLobby, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { campaigns } from '../db/schema';
import { badRequest, conflict } from '../lib/errors';

/**
 * The default public missions, or as near to them as the map allows: a mission this map can't
 * support makes way for the next playable one in the catalog. The host sees the result in the
 * lobby before anything is locked.
 */
function defaultMissions(idx: DatasetIndex, rules: CampaignRules, random: () => number): PublicMissionSpec[] {
  const cfg = missionRules(rules.victory.version);
  const result = generatePublicMissions(cfg.defaultPublic, idx, rules, random);
  if ('missions' in result) return result.missions;
  const taken = new Set<TerritoryId>();
  const out: PublicMissionSpec[] = [];
  const others = PUBLIC_MISSION_KINDS.filter((k) => !cfg.defaultPublic.includes(k));
  for (const kind of [...cfg.defaultPublic, ...others]) {
    if (out.length >= cfg.publicCount) break;
    if (publicMissionIssue(kind, idx, rules)) continue;
    const spec = generatePublicMission(kind, idx, rules, random, taken);
    if (!spec) continue;
    out.push(spec);
    for (const id of publicTargets(spec)) taken.add(id);
  }
  return out;
}

/** Rules with public missions generated, for an Objectives campaign that has none yet. */
export function withDefaultMissions(ctx: AppContext, datasetVersion: string, rules: CampaignRules): CampaignRules {
  if (rules.victory.mode !== 'objectives' || rules.victory.publicMissions.length > 0) return rules;
  const idx = ctx.datasets.get(datasetVersion);
  return { ...rules, victory: { ...rules.victory, publicMissions: defaultMissions(idx, rules, () => ctx.random()) } };
}

/**
 * What stops the public missions being played under these rules, in words, or null. With
 * `complete`, the full set must be there too (before the draft starts).
 */
export function checkPublicMissions(
  ctx: AppContext,
  datasetVersion: string,
  rules: CampaignRules,
  { complete }: { complete: boolean },
): string | null {
  if (rules.victory.mode !== 'objectives') return null;
  const cfg = missionRules(rules.victory.version);
  const idx = ctx.datasets.get(datasetVersion);
  for (const spec of rules.victory.publicMissions) {
    const issue = publicMissionIssue(spec.kind, idx, rules);
    if (issue) return `${missionName(spec)}: ${issue} Swap it for another public mission first.`;
  }
  const count = rules.victory.publicMissions.length;
  if (complete && count !== cfg.publicCount) {
    return `Choose ${cfg.publicCount} public missions before the draft starts (${count} chosen).`;
  }
  return null;
}

function requireObjectives(scope: MutationScope): void {
  requireLobby(scope, 'Public missions are locked once the draft starts.');
  if (scope.campaign.rules.victory.mode !== 'objectives') {
    throw conflict('Public missions are only for Objectives campaigns.', 'not-objectives');
  }
}

async function saveMissions(scope: MutationScope, missions: PublicMissionSpec[]): Promise<void> {
  const rules = { ...scope.campaign.rules, victory: { ...scope.campaign.rules.victory, publicMissions: missions } };
  await scope.tx.update(campaigns).set({ rules }).where(eq(campaigns.id, scope.campaign.id));
  scope.campaign = { ...scope.campaign, rules };
}

/** The host picks another set of public missions; each gets fresh targets. */
export async function setPublicMissions(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  kinds: PublicMissionKind[],
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'choose the public missions');
    requireObjectives(scope);
    const idx = ctx.datasets.get(scope.campaign.datasetVersion);
    const result = generatePublicMissions(kinds, idx, scope.campaign.rules, () => ctx.random());
    if ('error' in result) throw badRequest(result.error, 'bad-missions');
    await saveMissions(scope, result.missions);
  });
}

/** The host draws new targets for one public mission, keeping clear of the others' targets. */
export async function rerollPublicMission(
  ctx: AppContext,
  campaignId: string,
  userId: string,
  slot: number,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, userId, 'change the public missions');
    requireObjectives(scope);
    const missions = scope.campaign.rules.victory.publicMissions;
    const current = missions[slot];
    if (!current) throw badRequest('There is no public mission in that slot.', 'bad-slot');
    const idx = ctx.datasets.get(scope.campaign.datasetVersion);
    const taken = new Set(missions.flatMap((m, i) => (i === slot ? [] : publicTargets(m))));
    const same = JSON.stringify(current);
    let next: PublicMissionSpec | null = null;
    // A few draws, in case one repeats the targets it replaces.
    for (let attempt = 0; attempt < 6; attempt++) {
      next = generatePublicMission(current.kind, idx, scope.campaign.rules, () => ctx.random(), taken);
      if (!next || JSON.stringify(next) !== same) break;
    }
    if (!next) throw conflict('No other targets on this map fit that mission.', 'no-targets');
    await saveMissions(
      scope,
      missions.map((m, i) => (i === slot ? next! : m)),
    );
  });
}
