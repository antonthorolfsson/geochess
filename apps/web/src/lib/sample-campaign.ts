import type { MemberView, TerritoryId } from '@empire/rules';

/**
 * The campaign the signed-out landing page shows, labelled there as sample data. The map is a
 * campaign the balance simulator played with four of its standard bots on dataset 2026.3 (`pnpm
 * --filter @empire/sim trace --players 4 --seed 27 --pace correspondence`), as it stood in round 6
 * the moment Italy's holder accepted France's declaration of war: every country, and every war
 * underway then, with the two declarations still waiting for an answer drawn dashed. The names,
 * colors, clocks and chess position are made up. `sample-campaign.test.ts` checks it against the
 * dataset and the current rules, so the landing page's example can't drift from them unnoticed.
 */
export const SAMPLE_DATASET = '2026.3';

export const SAMPLE_ROUND = 6;

/** Words separated by white space, for long lists of ids. */
const words = (text: string): string[] => text.trim().split(/\s+/);

const member = (userId: string, name: string, color: number, botLevel?: number): MemberView => ({
  userId,
  name,
  lichessUsername: null,
  color,
  autodraft: false,
  tokens: 0,
  reputation: 100,
  joinedAt: '',
  bot: botLevel === undefined ? null : { level: botLevel, standIn: false },
  rating: null,
});

export interface SampleEmpire {
  member: MemberView;
  countries: readonly TerritoryId[];
}

export const SAMPLE_EMPIRES: readonly SampleEmpire[] = [
  {
    member: member('ada', 'Ada', 0),
    countries: words(`
      AND AUT BEL BGR BIH BLR CHE CHN CZE DEU DNK ESP EST FRA HRV HUN IRL JPN KAZ KGZ KOR LTU LVA MAR MDA MKD
      MNG NLD POL PRK PRT ROU SRB SVN SWE TJK UKR UZB VNM
    `),
  },
  {
    member: member('ben', 'Ben', 4),
    countries: words(`
      ABC ARG BHS BLZ BOL BRA CAN CHL COL CRI CUB ECU FIN FLK GBR GRL GTM GUF GUY HND HTI INDIAN-OCEAN ISL JAM
      LBR LEEWARD MEX NAM NIC NOR PAN PER PRI PRY RUS SLE SLV SWZ TTO URY USA VEN WINDWARD ZAF
    `),
  },
  {
    member: member('cleo', 'Cleo', 3),
    countries: words(`
      AFG AGO ALB ARE ARM AZE BDI BGD BHR BTN BWA COD CYP DOM EGY ETH GEO GRC IND IRN IRQ ISR ITA JOR KEN LBN
      LKA LSO LUX MDG MDV MMR MNE MOZ MWI NPL OMN PAK PSE QAT RWA SAU SOM SYR TKM TUN TUR TZA UGA XKX YEM ZMB ZWE
    `),
  },
  {
    member: member('alpha', 'Alpha', 6, 3),
    countries: words(`
      AUS BEN BFA BRN CAF CIV CMR COG CPV DJI DZA ERI ESH FJI GAB GHA GIN GMB GNB GNQ IDN KHM KWT LAO LBY LIE
      MICRONESIA MLI MLT MRT MYS NCL NER NGA NZL PHL PNG POLYNESIA SDN SEN SGP SLB SSD STP SUR SVK TCD TGO THA
      TLS TWN VUT
    `),
  },
];

export interface SampleWar {
  id: string;
  attackerId: string;
  defenderId: string;
  launchId: TerritoryId;
  targetId: TerritoryId;
  /** Declared and not yet answered: drawn dashed. */
  threat: boolean;
}

/** Every war underway at that moment, the battle for Italy among them. */
export const SAMPLE_WARS: readonly SampleWar[] = [
  { id: 'w16', attackerId: 'alpha', defenderId: 'cleo', launchId: 'IDN', targetId: 'IND', threat: false },
  { id: 'w20', attackerId: 'alpha', defenderId: 'ada', launchId: 'LAO', targetId: 'CHN', threat: false },
  { id: 'w21', attackerId: 'ada', defenderId: 'ben', launchId: 'BLR', targetId: 'RUS', threat: false },
  { id: 'w22', attackerId: 'ben', defenderId: 'ada', launchId: 'FIN', targetId: 'EST', threat: false },
  { id: 'w27', attackerId: 'ada', defenderId: 'cleo', launchId: 'FRA', targetId: 'ITA', threat: false },
  { id: 'w28', attackerId: 'ben', defenderId: 'cleo', launchId: 'HTI', targetId: 'DOM', threat: false },
  { id: 'w29', attackerId: 'alpha', defenderId: 'ada', launchId: 'ESH', targetId: 'MAR', threat: true },
  { id: 'w30', attackerId: 'ben', defenderId: 'cleo', launchId: 'ZAF', targetId: 'MOZ', threat: true },
];

/** The war the page follows: Ada, from France, against Cleo's Italy. */
export const SAMPLE_BATTLE = {
  warId: 'w27',
  attackerId: 'ada',
  defenderId: 'cleo',
  target: { id: 'ITA', name: 'Italy', value: 12 },
  /** The country attacked from first, as the rules list a stake. */
  stake: [
    { id: 'FRA', name: 'France', value: 13 },
    { id: 'AND', name: 'Andorra', value: 1 },
  ],
  /** Where the map opens: the war, and enough of Europe and the Mediterranean around it. */
  frame: ['FRA', 'ITA', 'GBR', 'TUR', 'EGY', 'DZA', 'POL'],
} as const;

/** The battle's game, twelve moves into an Italian Game, the attacker playing White, as a live game's clocks stand. */
export const SAMPLE_GAME = {
  moves: words(`
    e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 a7a6
    a2a4 e8g8 f1e1 c5a7 h2h3 h7h6 b1d2 f8e8 d2f1 c8e6 c4e6 e8e6
  `),
  fen: 'r2q2k1/bpp2pp1/p1nprn1p/4p3/P3P3/2PP1N1P/1P3PP1/R1BQRNK1 w - - 0 13',
  lastMove: ['e8', 'e6'],
  /** The last move, as the board's move list shows it. */
  lastSan: '12… Rxe6',
  clocks: { white: 242_000, black: 207_000 },
} as const;

export const sampleEmpire = (userId: string): SampleEmpire => SAMPLE_EMPIRES.find((e) => e.member.userId === userId)!;

/** Each country's empire color, as the map takes it. */
export const sampleOwners = (): Map<TerritoryId, number> =>
  new Map(SAMPLE_EMPIRES.flatMap((e) => e.countries.map((id) => [id, e.member.color] as const)));
