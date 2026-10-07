/**
 * What-if variants: changes to the missions tried in the simulator only, never in the game. A
 * variant can patch mission specs (their thresholds live in the specs), keep kinds out of play,
 * add a condition on completion, change the points and the host's war settings, or play other
 * mission rules, generation and dealing included (`missionRules`).
 */
import type {
  DatasetIndex,
  MissionRules,
  MissionSpec,
  MissionWorld,
  PublicMissionKind,
  PublicMissionSpec,
  Random,
  SecretMissionKind,
  SecretMissionSpec,
  TerritoryId,
  UserId,
  WarRules,
} from '@empire/rules';
import type { TitleStat } from './engine/titles';

export interface VariantContext {
  players: number;
}

/** What a public mission patch may use to choose new targets. */
export interface PublicPatchContext extends VariantContext {
  idx: DatasetIndex;
  random: Random;
  /** The other public missions' targets, to keep clear of. */
  taken: ReadonlySet<TerritoryId>;
}

export interface Variant {
  name: string;
  description: string;
  /**
   * Mission rules in place of the version's own: targets are generated, options dealt and
   * missions specified with them, as a lobby would with a version carrying these numbers. Played
   * as a trial version only the simulator knows (`registerTrialMissionRules`).
   */
  missionRules?(base: MissionRules): MissionRules;
  /** A public mission after its targets are generated. */
  patchPublic?(spec: PublicMissionSpec, ctx: PublicPatchContext): PublicMissionSpec;
  /** A secret mission after it's dealt. */
  patchSecret?(spec: SecretMissionSpec, ctx: VariantContext): SecretMissionSpec;
  /** Public kinds that can't be played (skipped in draws, replaced in the default set). */
  excludePublic?(kind: PublicMissionKind, ctx: VariantContext): boolean;
  /** Secret kinds never dealt. */
  excludeSecret?(kind: SecretMissionKind, ctx: VariantContext): boolean;
  /** A condition on completion on top of the rules' own (claim blockers don't know about it). */
  requires?(world: MissionWorld, userId: UserId, spec: MissionSpec): boolean;
  points?: Partial<{ public: number; secret: number; toWin: number }>;
  /** The points to win by table size, over `points.toWin`. */
  toWinFor?(players: number): number;
  /**
   * Titles: `points` each, held by whoever leads the table on each figure from the moment the draft
   * ends, and lost with the lead (`engine/titles.ts`), in place of the version's own; null: none.
   */
  titles?: { stats: readonly TitleStat[]; points: number } | null;
  /**
   * Public missions added to the campaign's (each worth the public points): these kinds, or this
   * many drawn from the playable kinds not in play that don't make for a long campaign.
   */
  extraPublic?: readonly PublicMissionKind[] | ((players: number) => number);
  /** Points for a secret mission of this kind, when they differ by kind. */
  secretPoints?(kind: SecretMissionKind): number | undefined;
  /** The season's last round instead of the configured one (null: none), after which the most points win. */
  lastRound?: number | null;
  /** War tokens come every this many rounds instead of every round (round 1 always brings one). */
  tokenEvery?: number;
  war?: Partial<WarRules>;
}
