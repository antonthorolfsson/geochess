/**
 * What-if variants: changes to the missions tried in the simulator only, never in the game. A
 * variant can patch mission specs (their thresholds live in the specs), keep kinds out of play,
 * add a condition on completion, or change the points and the host's war settings. Generation
 * parameters (which `missionRules(version)` reads from the catalog) can't be varied here.
 */
import type {
  DatasetIndex,
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
  /** Points for a secret mission of this kind, when they differ by kind. */
  secretPoints?(kind: SecretMissionKind): number | undefined;
  /** The season's last round instead of the configured one (null: none), after which the most points win. */
  lastRound?: number | null;
  /** War tokens come every this many rounds instead of every round (round 1 always brings one). */
  tokenEvery?: number;
  war?: Partial<WarRules>;
}
