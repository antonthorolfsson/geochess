/**
 * The what-if variants tried against the baseline. Each names the scenario it's paired with; the
 * report compares them seed for seed. None of this changes the game: a variant that works becomes a
 * recommendation for the next mission rules version.
 *
 * Those above "Tuning mission rules version 3" patch version 2's specs, as the balance report ran
 * them: play them with `--mission-rules 2 --last-round none`. Version 3 has since taken the fixes
 * (their "v3" packages were its candidates), so on version 3 most of them change nothing or stack.
 */
import {
  NAMED_SET_KINDS,
  components,
  heldBy,
  hopDistances,
  pathWithin,
  roundAt,
  shuffled,
  type MissionSpec,
  type MissionWorld,
  type PublicMissionSpec,
  type SecretMissionSpec,
  type TerritoryId,
  type UserId,
} from '@empire/rules';
import type { PublicPatchContext, Variant } from './variants';

export interface VariantEntry {
  /** The scenario the variant is compared with (default `baseline`). */
  scenario?: string;
  variant: Variant;
}

/** Countries a player holds now that they didn't hold when the draft ended. */
function fresh(world: MissionWorld, userId: UserId): Set<TerritoryId> {
  const base = world.baseline.get(userId) ?? new Set<TerritoryId>();
  return new Set([...heldBy(world.owners, userId)].filter((id) => !base.has(id)));
}

/**
 * For the public missions a draft can complete on its own: at least one country of the qualifying
 * position won since the draft.
 */
function heldPositionIsWon(world: MissionWorld, userId: UserId, spec: MissionSpec): boolean {
  const won = fresh(world, userId);
  const held = heldBy(world.owners, userId);
  const anyWon = (ids: Iterable<TerritoryId>) => [...ids].some((id) => won.has(id));
  switch (spec.kind) {
    case 'strategic_positions':
    case 'regional_power':
      return anyWon(spec.territories.filter((id) => held.has(id)));
    case 'mare_nostrum':
      return anyWon(spec.shores.flatMap((shore) => shore.territories).filter((id) => held.has(id)));
    case 'great_connection': {
      const chain = pathWithin(world.idx, held, spec.endpoints[0], spec.endpoints[1]);
      return chain !== null && anyWon(chain);
    }
    case 'continental_bridge':
      return components(world.idx, held).some((block) => anyWon(block));
    default:
      return true;
  }
}

/**
 * Great Connection endpoints with `lo`–`hi` countries between them, chosen the way the lobby does
 * (generate.ts `greatConnection`), for trying other distances than the catalog's.
 */
function connectionAt(ctx: PublicPatchContext, lo: number, hi: number): PublicMissionSpec | null {
  const { idx, random, taken } = ctx;
  const ends = idx.ids.filter((id) => !idx.byId.get(id)!.micro && idx.neighbors(id).length >= 2 && !taken.has(id));
  for (const a of shuffled(ends, random).slice(0, 80)) {
    const dist = hopDistances(idx, a);
    const onMap = hopDistances(idx, a, { onMap: true });
    const region = idx.byId.get(a)!.subregion;
    const partners = ends.filter((b) => {
      const d = dist.get(b);
      if (d === undefined || onMap.get(b) !== d) return false;
      return d - 1 >= lo && d - 1 <= hi && idx.byId.get(b)!.subregion !== region;
    });
    const b = shuffled(partners, random)[0];
    if (b) return { kind: 'great_connection', endpoints: [a, b].sort() as [TerritoryId, TerritoryId] };
  }
  return null;
}

/** Whether the player won an attack declared on someone `lead` or more points ahead of them. */
function beatPointsLeader(world: MissionWorld, userId: UserId, lead: number): boolean {
  const pointsAt = (id: UserId, seq: number) =>
    world.history.awards.filter((a) => a.userId === id && a.seq < seq).reduce((n, a) => n + a.points, 0);
  return world.history.wars.some(
    (w) =>
      w.attackerId === userId &&
      w.outcome === 'attacker' &&
      pointsAt(w.defenderId, w.declaredSeq) >= pointsAt(userId, w.declaredSeq) + lead,
  );
}

const patchPublic =
  (patch: (spec: PublicMissionSpec, players: number) => PublicMissionSpec | null) =>
  (spec: PublicMissionSpec, ctx: { players: number }) =>
    patch(spec, ctx.players) ?? spec;

const patchSecret =
  (patch: (spec: SecretMissionSpec, players: number) => SecretMissionSpec | null) =>
  (spec: SecretMissionSpec, ctx: { players: number }) =>
    patch(spec, ctx.players) ?? spec;

export const VARIANTS: Record<string, VariantEntry> = {
  'veteran-4': {
    variant: {
      name: 'veteran-4',
      description: 'Campaign Veteran needs 4 wars won, 2 of them as the attacker.',
      patchPublic: patchPublic((spec) =>
        spec.kind === 'campaign_veteran' ? { ...spec, wins: 4, attackWins: 2 } : null,
      ),
    },
  },
  'veteran-attacks': {
    variant: {
      name: 'veteran-attacks',
      description: 'Campaign Veteran counts only wars won as the attacker (3 of them, against 2 opponents).',
      patchPublic: patchPublic((spec) =>
        spec.kind === 'campaign_veteran' ? { ...spec, wins: 3, attackWins: 3 } : null,
      ),
    },
  },
  'won-position': {
    variant: {
      name: 'won-position',
      description:
        'Strategic Positions, Great Connection, Regional Power, Mare Nostrum and Continental Bridge need at least one country of the position won since the draft.',
      requires: heldPositionIsWon,
    },
  },
  'battle-harder': {
    scenario: 'baseline',
    variant: {
      name: 'battle-harder',
      description:
        'Checkmate Artist needs 3 mates, Nemesis 4 countries, Backstab a strike in the round after the break.',
      patchSecret: patchSecret((spec) => {
        if (spec.kind === 'checkmate_artist') return { ...spec, wins: 3 };
        if (spec.kind === 'nemesis') return { ...spec, count: 4, reveal: 3 };
        if (spec.kind === 'backstab') return { ...spec, rounds: 1 };
        return null;
      }),
    },
  },
  'iron-wall-4p': {
    variant: {
      name: 'iron-wall-4p',
      description: 'Iron Wall is only dealt with four or more players (a lone rival can simply stop attacking).',
      excludeSecret: (kind, ctx) => kind === 'iron_wall' && ctx.players < 4,
    },
  },
  'region-easier': {
    variant: {
      name: 'region-easier',
      description:
        'Named regions need one country fewer (and reveal one sooner); Strait Keeper needs two straits; Island Empire one island fewer.',
      patchSecret: patchSecret((spec) => {
        if ((NAMED_SET_KINDS as readonly string[]).includes(spec.kind) && 'need' in spec && 'reveal' in spec) {
          return {
            ...spec,
            need: Math.max(2, spec.need - 1),
            reveal: Math.max(1, spec.reveal - 1),
          } as SecretMissionSpec;
        }
        if (spec.kind === 'strait_keeper') return { ...spec, straits: spec.straits.slice(0, 2), reveal: 1 };
        if (spec.kind === 'island_empire') return { ...spec, need: spec.need - 1 };
        return null;
      }),
    },
  },
  'connection-scaled': {
    variant: {
      name: 'connection-scaled',
      description:
        'Great Connection endpoints closer at bigger tables: 4–7 countries apart at 5–6 players, 3–5 at 7–8.',
      patchPublic: (spec, ctx) => {
        if (spec.kind !== 'great_connection' || ctx.players < 5) return spec;
        const [lo, hi] = ctx.players <= 6 ? [4, 7] : [3, 5];
        return connectionAt(ctx, lo, hi) ?? spec;
      },
    },
  },
  'kingslayer-points': {
    scenario: 'hot-publics',
    variant: {
      name: 'kingslayer-points',
      description:
        'Kingslayer counts only a war declared on a player at least 2 points ahead of you (points, not map value).',
      requires: (world, userId, spec) => spec.kind !== 'kingslayer' || beatPointsLeader(world, userId, 2),
    },
  },
  'giants-harder': {
    scenario: 'hot-publics',
    variant: {
      name: 'giants-harder',
      description:
        'Great Expanse 12 million km², One Billion 1.5 billion people, Great Powers all three won since the draft.',
      patchPublic: patchPublic((spec) => {
        if (spec.kind === 'great_expanse') return { ...spec, areaKm2: 12_000_000 };
        if (spec.kind === 'one_billion') return { ...spec, people: 1_500_000_000 };
        if (spec.kind === 'great_powers') return { ...spec, newCount: 3 };
        return null;
      }),
    },
  },
  'cold-scaled': {
    scenario: 'cold-publics',
    variant: {
      name: 'cold-scaled',
      description:
        'Great Connection endpoints closer at bigger tables; Mare Nostrum 9 countries (2 per shore); Regional Power 50%; Across the Seas 2.',
      patchPublic: (spec, ctx) => {
        if (spec.kind === 'great_connection') {
          if (ctx.players < 5) return spec;
          const [lo, hi] = ctx.players <= 6 ? [4, 7] : [3, 5];
          return connectionAt(ctx, lo, hi) ?? spec;
        }
        if (spec.kind === 'mare_nostrum') return { ...spec, need: 9, perShore: 2 };
        if (spec.kind === 'regional_power') return { ...spec, needValue: Math.ceil(spec.totalValue / 2) };
        if (spec.kind === 'across_the_seas') return { ...spec, count: 2 };
        return spec;
      },
    },
  },
  'to-win-8': {
    variant: { name: 'to-win-8', description: 'Eight points to win.', points: { toWin: 8 } },
  },
  'to-win-9': {
    variant: { name: 'to-win-9', description: 'Nine points to win.', points: { toWin: 9 } },
  },
};

/** Several variants at once: their patches applied in turn, every extra condition required. */
function combine(name: string, description: string, parts: readonly Variant[], extra: Partial<Variant> = {}): Variant {
  return {
    name,
    description,
    patchPublic: (spec, ctx) => parts.reduce((s, v) => v.patchPublic?.(s, ctx) ?? s, spec),
    patchSecret: (spec, ctx) => parts.reduce((s, v) => v.patchSecret?.(s, ctx) ?? s, spec),
    excludeSecret: (kind, ctx) => parts.some((v) => v.excludeSecret?.(kind, ctx) ?? false),
    requires: (world, userId, spec) => parts.every((v) => v.requires?.(world, userId, spec) ?? true),
    ...extra,
  };
}

const parts = ['veteran-4', 'won-position', 'battle-harder', 'iron-wall-4p'].map((n) => VARIANTS[n]!.variant);
VARIANTS['combined'] = {
  variant: combine(
    'combined',
    'Campaign Veteran 4 wins, won positions, harder battle secrets, Iron Wall from 4 players.',
    parts,
  ),
};
VARIANTS['combined-8'] = {
  variant: combine('combined-8', 'The combined changes, and 8 points to win.', parts, { points: { toWin: 8 } }),
};

/** Every fix at once: the candidate for mission rules version 3. */
const v3Parts = [
  'veteran-4',
  'won-position',
  'battle-harder',
  'iron-wall-4p',
  'region-easier',
  'cold-scaled',
  'kingslayer-points',
  'giants-harder',
].map((n) => VARIANTS[n]!.variant);
const V3 =
  'Every fix together: Campaign Veteran 4 wins, won positions, harder battle secrets, Iron Wall from 4 players, easier regions, scaled cold missions, Kingslayer on points, harder giants.';
VARIANTS['v3'] = { variant: combine('v3', V3, v3Parts) };
VARIANTS['v3-8'] = { variant: combine('v3-8', `${V3} Eight points to win.`, v3Parts, { points: { toWin: 8 } }) };
VARIANTS['v3-random'] = { scenario: 'random', variant: combine('v3-random', V3, v3Parts) };
VARIANTS['v3-8-random'] = {
  scenario: 'random',
  variant: combine('v3-8-random', `${V3} Eight points to win.`, v3Parts, { points: { toWin: 8 } }),
};

/** Countries taken from betrayed partners in strikes that count for Backstab (declared after the break, in time). */
function backstabTaken(world: MissionWorld, userId: UserId, rounds: number): number {
  const breaks = world.history.accords
    .filter((a) => a.brokenBy === userId && a.to !== null)
    .map((a) => ({
      partner: a.players[0] === userId ? a.players[1] : a.players[0],
      seq: a.to!,
      round: roundAt(world.history, a.to!),
    }));
  const taken = new Set<TerritoryId>();
  for (const w of world.history.wars) {
    if (w.attackerId !== userId) continue;
    const counts = breaks.some(
      (b) => b.partner === w.defenderId && w.declaredSeq > b.seq && w.declaredRound <= b.round + rounds,
    );
    if (!counts) continue;
    for (const t of w.transfers) if (t.from === w.defenderId && t.to === userId) taken.add(t.territoryId);
  }
  return taken.size;
}

/**
 * The stronger package: every mission that scores within a few rounds needs about twice the
 * wins, and the ones that are rarely done get easier.
 */
const strong: Variant = {
  name: 'strong',
  description:
    'Campaign Veteran 6 wins (3 attacking, 3 opponents), Expansion +25, Two Fronts 3 per continent, Lightning Campaign 3 wars; Checkmate Artist 3 mates, Nemesis 4, Iron Wall 3 wins, Backstab 2 countries in the round after the break.',
  patchPublic: patchPublic((spec) => {
    if (spec.kind === 'campaign_veteran') return { ...spec, wins: 6, opponents: 3, attackWins: 3 };
    if (spec.kind === 'expansion') return { ...spec, gain: 25 };
    if (spec.kind === 'two_fronts') return { ...spec, perContinent: 3 };
    if (spec.kind === 'lightning_campaign') return { ...spec, wins: 3 };
    return null;
  }),
  patchSecret: patchSecret((spec) => {
    if (spec.kind === 'checkmate_artist') return { ...spec, wins: 3 };
    if (spec.kind === 'nemesis') return { ...spec, count: 4, reveal: 3 };
    if (spec.kind === 'iron_wall') return { ...spec, wins: 3 };
    if (spec.kind === 'backstab') return { ...spec, rounds: 1 };
    return null;
  }),
  requires: (world, userId, spec) => spec.kind !== 'backstab' || backstabTaken(world, userId, spec.rounds) >= 2,
};
VARIANTS['strong'] = { variant: strong };

const strongParts = [
  strong,
  ...['won-position', 'iron-wall-4p', 'region-easier', 'cold-scaled', 'kingslayer-points', 'giants-harder'].map(
    (n) => VARIANTS[n]!.variant,
  ),
];
const V3S =
  'The stronger package, with won positions, Iron Wall from 4 players, easier regions, scaled cold missions, Kingslayer on points and harder giants.';
VARIANTS['v3s'] = { variant: combine('v3s', V3S, strongParts) };
VARIANTS['v3s-25'] = {
  variant: combine('v3s-25', `${V3S} The campaign ends after round 25.`, strongParts, { lastRound: 25 }),
};
VARIANTS['v3-25'] = {
  variant: combine('v3-25', `${V3} The campaign ends after round 25.`, v3Parts, { lastRound: 25 }),
};
VARIANTS['v3s-random'] = { scenario: 'random', variant: combine('v3s-random', V3S, strongParts) };
VARIANTS['v3s-25-random'] = {
  scenario: 'random',
  variant: combine('v3s-25-random', `${V3S} The campaign ends after round 25.`, strongParts, { lastRound: 25 }),
};

VARIANTS['kingslayer-4'] = {
  scenario: 'hot-publics',
  variant: {
    name: 'kingslayer-4',
    description: 'Kingslayer counts only a war declared on a player at least 4 points ahead of you.',
    requires: (world, userId, spec) => spec.kind !== 'kingslayer' || beatPointsLeader(world, userId, 4),
  },
};

/** Countries won since the draft, still held. */
const wonCount = (world: MissionWorld, userId: UserId) => fresh(world, userId).size;

VARIANTS['giants-3'] = {
  scenario: 'hot-publics',
  variant: {
    name: 'giants-3',
    description:
      'Great Expanse and One Billion need at least three countries won since the draft; Great Powers all three won.',
    patchPublic: patchPublic((spec) => (spec.kind === 'great_powers' ? { ...spec, newCount: 3 } : null)),
    requires: (world, userId, spec) =>
      (spec.kind !== 'great_expanse' && spec.kind !== 'one_billion') || wonCount(world, userId) >= 3,
  },
};

VARIANTS['tokens-every-2'] = {
  variant: {
    name: 'tokens-every-2',
    description: 'A war token every other round instead of every round.',
    tokenEvery: 2,
  },
};
VARIANTS['v3-slow'] = {
  variant: combine('v3-slow', `${V3} A war token every other round.`, v3Parts, { tokenEvery: 2 }),
};
VARIANTS['v3-slow-25'] = {
  variant: combine('v3-slow-25', `${V3} A war token every other round; the campaign ends after round 25.`, v3Parts, {
    tokenEvery: 2,
    lastRound: 25,
  }),
};

VARIANTS['giants-big'] = {
  scenario: 'hot-publics',
  variant: {
    name: 'giants-big',
    description:
      'Great Expanse 20 million km², One Billion 2 billion people, Great Powers all three won since the draft.',
    patchPublic: patchPublic((spec) => {
      if (spec.kind === 'great_expanse') return { ...spec, areaKm2: 20_000_000 };
      if (spec.kind === 'one_billion') return { ...spec, people: 2_000_000_000 };
      if (spec.kind === 'great_powers') return { ...spec, newCount: 3 };
      return null;
    }),
  },
};

const BATTLE_SECRETS: readonly string[] = ['backstab', 'checkmate_artist', 'iron_wall', 'nemesis'];

/** Secrets priced by effort: two points for winning battles, four for holding ground. */
const pricedSecrets: Variant = {
  name: 'priced-secrets',
  description:
    'Battle secrets (Backstab, Checkmate Artist, Iron Wall, Nemesis) are worth 2 points; every other secret 4.',
  secretPoints: (kind) => (BATTLE_SECRETS.includes(kind) ? 2 : 4),
};
VARIANTS['priced-secrets'] = { variant: pricedSecrets };
VARIANTS['priced-secrets-forced'] = {
  scenario: 'secrets',
  variant: { ...pricedSecrets, name: 'priced-secrets-forced' },
};

// ---------------------------------------------------------------------------------------------
// Tuning mission rules version 3 (these patch version 3's specs; compare with `secrets`)

const isNamedSet = (spec: SecretMissionSpec) => (NAMED_SET_KINDS as readonly string[]).includes(spec.kind);

/** Named sets need half their countries (rounded up), revealed one short. */
const setsHalf = (spec: SecretMissionSpec): SecretMissionSpec | null => {
  if (!isNamedSet(spec) || !('territories' in spec) || !('need' in spec) || !('reveal' in spec)) return null;
  const need = Math.max(2, Math.ceil(spec.territories.length / 2));
  return { ...spec, need, reveal: need - 1 } as SecretMissionSpec;
};

/** Region secrets counted by targets are revealed only once complete, not one short. */
const revealedWhenDone = (spec: SecretMissionSpec): SecretMissionSpec | null => {
  if ((isNamedSet(spec) || spec.kind === 'mountain_kingdom' || spec.kind === 'hidden_triangle') && 'need' in spec)
    return { ...spec, reveal: spec.need } as SecretMissionSpec;
  if (spec.kind === 'strait_keeper') return { ...spec, reveal: spec.straits.length };
  return null;
};

VARIANTS['v3-sets-half'] = {
  scenario: 'secrets',
  variant: {
    name: 'v3-sets-half',
    description: 'Named sets need half their countries.',
    patchSecret: patchSecret(setsHalf),
  },
};
VARIANTS['v3-sets-hidden'] = {
  scenario: 'secrets',
  variant: {
    name: 'v3-sets-hidden',
    description: 'Named sets, Mountain Kingdom, Hidden Triangle and Strait Keeper revealed only once complete.',
    patchSecret: patchSecret(revealedWhenDone),
  },
};
VARIANTS['v3-sets-both'] = {
  scenario: 'secrets',
  variant: {
    name: 'v3-sets-both',
    description: 'Named sets need half their countries, and region secrets are revealed only once complete.',
    patchSecret: patchSecret((spec) => {
      const half = setsHalf(spec) ?? spec;
      return revealedWhenDone(half) ?? half;
    }),
  },
};
VARIANTS['v3-backstab-2r'] = {
  scenario: 'secrets',
  variant: {
    name: 'v3-backstab-2r',
    description: 'Backstab: two countries within the next two rounds.',
    patchSecret: patchSecret((spec) => (spec.kind === 'backstab' ? { ...spec, rounds: 2, count: 2 } : null)),
  },
};

// ---------------------------------------------------------------------------------------------
// War answers. Campaigns play a new campaign's answers (a matched raise, nearby redirects that
// cost a token, fortifying, calling a declaration off, peace terms); these play others.

VARIANTS['original-answers'] = {
  variant: {
    name: 'original-answers',
    description:
      'The original answers: a free raise to 125%, redirects anywhere at no cost, tribute, no fortifying or calling off.',
    war: {
      raise: 'free',
      redirect: 'anywhere',
      redirectToken: false,
      fortify: false,
      peaceTerms: false,
      recall: false,
    },
  },
};
VARIANTS['raise-token'] = {
  variant: {
    name: 'raise-token',
    description: 'A raise to 125% that costs the defender a war token, which the attacker gets for meeting it.',
    war: { raise: 'token' },
  },
};
VARIANTS['raise-off'] = {
  variant: {
    name: 'raise-off',
    description: 'No raising, and a stake floor of 100%.',
    war: { raise: 'off', stakeFloorPct: 100 },
  },
};

// ---------------------------------------------------------------------------------------------
// Declaring. Campaigns take turns to declare, as new campaigns do; this plays the original rule.

VARIANTS['no-turns'] = {
  variant: {
    name: 'no-turns',
    description:
      'Declaring whenever you like (the original rule): each player in a random order declares all they want.',
    war: { turns: false },
  },
};
