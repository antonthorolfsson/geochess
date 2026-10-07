# Handover: Phase 4 done, Phase 5 (playtest) next

_Written 2026-09-27 at the end of the session that built Phase 4 (stats and history). Read this
first, then the plan._

## Start here

1. Read, in order: this file, [CLAUDE.md](../CLAUDE.md), and the plan
   [empire-chess-implementation-plan.md](../empire-chess-implementation-plan.md), especially
   section 8 (Phase 5, the playtest) and section 11 (risks).
2. Run `pnpm install && pnpm test` to confirm a green baseline (607 tests as of 2026-09-30, after
   the bots, declaring in turns and the fixes for GitHub issues #2 to #5).
3. Phases 1 and 2 are committed (`4955ca2`), Phase 3 too (`896c7fd`). Phase 4 is not: the user
   hasn't asked for a commit. Don't commit or push unless asked.
4. Before planning the playtest, go through [what still needs the user](#what-still-needs-the-user).

## Where things stand

**Phase 1 (Foundation)** is complete: sign-in (Lichess OAuth with PKCE, email links, email and
password, development sign-in by name), lobbies with invite links and empire colors, the d3-geo map with hatching,
microstates, sea lanes and search, the snake draft with private draft lists and auto-draft, the
empire panel, dataset `2026.1` (188 territories; `2026.2` since 2026-10-02, `2026.3` since 2026-10-03), PWA shell, CI and Prettier.

**Phase 2 (War loop)** is complete and verified in the browser on desktop and phone:

- **Rounds and tokens.** The host starts each round ("Next round"); everyone gains 1 war token, up
  to 3. Round 1 starts with 1 token when the draft ends.
- **"End draft"** now drafts the remaining countries automatically (draft lists first, then the
  most valuable) and logs one `draft.ended` event listing the picks.
- **Declaring war.** A "Targets" toggle highlights every attackable country. A country's panel
  says why it can't be attacked, or offers "Declare war", which opens a stake builder: attack
  from any bordering country that can reach the floor, add or remove connected countries (removing
  one drops anything it connected), value against the floor, and a clock preview. The map outlines
  the stake and draws a dashed preview arrow.
- **Answers.** The defender accepts, raises, redirects (dropdown of legal countries) or offers
  tribute (a cheaper country, or tokens, which are held back while offered). The attacker answers a
  raise with the stake builder at the raised floor, or withdraws; accepts or withdraws from a
  redirect; accepts or refuses a tribute. Unanswered declarations go ahead; unanswered counters
  mean no war. Countdown to each deadline in the war panel.
- **The game.** chessground board themed in paper and olive, moves validated by chessops on the
  server. Live games open with a 15-second countdown, run server clocks with lag compensation,
  support premoves, and flag on time; each player plays one live game at a time (others queue).
  Correspondence games have a deadline per move. Typed moves (SAN or UCI), promotion picker, draw
  offers, resign, flip board, move list, war context. Armageddon tiebreak when the host chose it.
- **Resolution.** The winner takes the target or the stake, a draw holds, tribute transfers.
  Truces and locks follow the decisions below.
- **Map.** Active wars are grease-pencil arrows from the launching country to the target (dashed
  while threatened, solid once fought); clicking one opens the war.
- **War room.** Left column on desktop, "Wars" tab on phones: round and tokens, "Waiting for your
  answer", "Your games" with whose move it is, wars underway, recent wars, standings (with tokens)
  and dispatches for every war event. Header badges ("Your move", "Answer needed", "2 wars ⚑"),
  page title flags, toasts ("War declared on Libya", "Battle stations"), and live games open the
  board by themselves. `?war=` and `?game=` in the URL open the panels, so notification links and
  the back button work. The home screen flags campaigns with something waiting.
- **Lobby settings.** Pace (also on the new-campaign form), time control, draw rule, clock
  modifiers, and under "More war settings" tokens per round, token cap, truce and lock rounds.
- **Notifications.** Web push to every browser a player enabled (a toggle in the war room, shown
  when the server has VAPID keys and the service worker is registered, i.e. production), with an
  email fallback for things that need an answer when push reached nothing (at most one email per
  topic every 6 hours).

Tests: rules 78, data 50, web 18, server 46. The server tests cover every response path, both
deadlines, live clocks and flag-falls, the live queue, both draw rules, locks, truces, tokens,
notifications and push subscriptions.

**Phase 3 (Diplomacy)** is complete and verified in the browser on desktop and phone, with three
scripted players:

- **Accords.** Two-player non-aggression accords with optional public terms. A player proposes
  (1 to 10 rounds, default 3); only the two players see the proposal; the other signs or declines
  within the answer window, and silence lets it lapse. Signed accords are public, logged, and stop
  war declarations both ways (`checkTarget` returns `accord`); wars already underway carry on.
  Signing a new accord with a current partner renews it (the old one is marked `renewed`).
- **Breaking.** "Renounce" ends an accord at once for everyone to see; the breaker loses 20
  reputation and can't declare war on the former partner until the next round starts
  (`renounced`), while the betrayed player may strike first.
- **Reputation.** Starts at 100; −20 for breaking; +2 to both partners for every whole round an
  accord holds, paid when the next round starts (the draft doesn't count, and renewing carries an
  accord on). Shown in the standings (Rep column), on the Diplo tab and the empire pages, and in
  the dispatches (`reputation.changed` for a break, one `reputation.earned` per round start). The
  propose form and proposals say what keeping the accord to the end earns. (Until 2026-09-27 a
  kept accord paid +5 when it ran its course; see
  [Phase 3 reputation, revised](#phase-3-reputation-revised-2026-09-27).)
- **Chat.** A campaign channel and one-to-one private messages from the lobby on: text up to
  1,000 characters, kept for the campaign; authors delete their own, the host removes channel
  messages. Unread counts per conversation are kept on the server, so badges clear on every
  device; private messages are pushed (at most once a minute per conversation) and counted on the
  home screen.
- **Diplo tab.** Phones: Map | Wars | Diplo | Empire (Lobby | Map | Diplo in the lobby, Map | Draft
  | Diplo | Empire in the draft). Desktop: the left column switches between the war room (or lobby,
  or draft) and Diplo. Diplo has three views: **Dispatches** (the event log and the campaign channel
  in one timeline, newest at the bottom by the message box, with All, Wars, Accords and Chat
  filters), **Messages** (a conversation per player) and **Accords** (proposals to answer, your
  accords and proposals, a propose form, every empire's reputation and standing with you, and the
  other accords in force). The war room keeps wars and standings.
- **Links and alerts.** `?chat=<player>` opens a conversation and `?accord=<id>` highlights an
  accord (notifications use both). Toasts for proposals, signatures, betrayals and private
  messages; "Answer needed" counts accord proposals too; the page title flags new messages.

**Phase 4 (Stats and history)** is complete and verified in the browser on desktop and phone, on
a scripted four-player campaign with six rounds of wars:

- **An empire page per player** at `/c/[id]/empire/[userId]`, open to every member. It opens over
  the map room without resetting it (the campaign screen now lives in the `/c/[id]` layout): the
  header arrow goes back to the map, phone tabs close it, and toasts still show. Reached from
  "Full statistics" in the Empire tab or column, any player's name in the standings, a war, a
  country's "Held by" or the accords list, and the "Other empires" row on the page itself.
- **Real-world totals**: population, GDP, GDP (PPP), area, military spending and armed forces,
  each with its share of the world, where the empire would rank among the world's countries and
  among the campaign's empires, gaps and estimates noted. Comparisons in words: "Your economy would
  rank 3rd in the world, between China and Germany."
- **History graph**: every empire's game value (or country count) at the end of each round from
  the draft on. The empire the page is about is drawn in its color with its wars marked; rivals
  are quiet lines that light up from the readout under the chart, which gives every empire's value
  and change at the round under the pointer (or keyboard), and that round's wars as links. A table
  view has every number.
- **War record**: won, drawn and lost as attacker and defender, settled by tribute, called off,
  underway; tribute tokens; countries won and lost, each linking to its war; accords signed, in
  force, kept, broken and betrayed, with reputation.
- **Chess profile**: the campaign's pace, games won, drawn and lost overall and by colour, how
  games ended, average length, opening families as White and Black with results, and every
  finished game linking to its board. Ratings wait for Phase 6.
- **Countries**: every holding with value, population, GDP and area, and how it was acquired
  (drafted with the pick number, won from someone in a round, or taken as tribute); sortable.
- **Live**: the page refetches whenever the campaign's history moves on (`campaign.events`).

An independent review found three bugs, all fixed and verified in the browser: a live game
starting while an empire page was open opened its board hidden under the page (panels opened from
a page now go back to the map room); the chart readout snapped back to "now" when the pointer left
the chart (a picked round now stays until another is picked); and links to wars older than the
campaign view's 30 most recent resolved ones did nothing (the war panel now reads them on their
own, `GET /api/campaigns/:id/wars/:warId`).

Tests: rules 117, data 53, web 30, server 69.

**Rules pages** (2026-09-28, at the user's request): how to play, with each round step by step.

- **One guide, two places.** `RulesGuide` (`components/rules/rules-guide.tsx`) renders the whole
  game: the idea, a campaign from lobby to war, each round as seven numbered steps saying who acts,
  declaring war (with a stake table), the four answers and the attacker's replies, the battle and
  clock modifiers, outcomes, truces and locks, diplomacy, a deadlines table ("if time runs out") and
  the settings. It's at `/rules` (public, linked from the app header and the landing page, which
  embedded it until 2026-10-06) and at `/c/[id]/rules`, which opens over the map room like an
  empire page from a "?" button at the right of the campaign header (labelled "Rules" from `sm`
  up). The campaign page keeps the query, so a war being answered is still open on the way back.
- **Numbers come from the rules.** Every figure is read from the campaign's `CampaignRules` or the
  rules package's constants (`stakeFloor`, `RESPONSE_WINDOW_TEXT`, `REPUTATION_*`, clock modifier
  percentages), so a campaign's page quotes its own pace, clocks, draws, tokens, truces and locks,
  and wording adapts (no truces, no locks, Armageddon, live). `/rules` uses `DEFAULT_RULES` and
  describes both paces. Phrasing helpers are in `lib/rules-text.ts`, with tests.
  **When a rule changes, update the guide's prose too**; only the numbers follow on their own.
- The contents chips are `<Link href="#…">`, not plain anchors: a native fragment navigation pushes a
  history entry Next's router ignores, which broke the back button. Pages that render after their
  data loads scroll to the address's `#section` themselves (`useScrollToHash`).
- "How it ends" said campaigns have no fixed end; it is now "Winning" (see below).

Tests: web 34.

**Email and password sign-in** (2026-09-28, at the user's request): players who have signed up
can sign in with their email and a password instead of waiting for a link.

- **Signing up is still the emailed link**, which proves the player owns the address. After a
  player's first link, the page offers "Choose a password" (skippable). The home screen's Password
  panel sets one, or changes it given the current one, and appears only for accounts with an email
  (Lichess and development accounts have none).
- **The sign-in page** has email and password, "Forgot your password?" and, for new players and
  anyone without a password, "Email me a link". A forgotten password goes through a link with
  `reset=1`, whose page asks for the new password before using the link up
  (`POST /api/auth/email/verify` with `password`). "Sign in without changing it" is offered too.
- **Sessions.** Changing a password signs out the player's other devices. Setting one from a link
  (a reset) signs out every other device. Setting a first password signs nobody out.
- **Hashing.** `auth/passwords.ts` uses Node's scrypt (N=2^15, r=8, p=1: 32 MiB, about 40 ms on a
  laptop). Each stored hash carries its settings (`scrypt$N$r$p$salt$key`), so they can be raised
  later. Hashes run one at a time so a burst of sign-ins can't starve the games. Passwords are
  NFKC-normalized, and 8 to 128 characters (`passwordSchema`).
- **Guessing.** Unknown emails and accounts without a password take the same time and get the same
  "Wrong email or password." Attempts are limited to 10 an hour per account and 30 an hour per
  address, in memory. A locked-out player can still email themselves a link.
- `SessionUser.hasPassword` tells the client which form to show. Every query that reads `users`
  names its columns, so the hash never leaves the server; keep it that way.

Tests: server 108 (`auth.test.ts`, `passwords.test.ts`).

**Name and logo** (2026-09-28, at the user's request): the game is now **Geo Chess** (was Empire
Chess) everywhere players see a name: header, landing page, titles, manifest, emails, the share
text and the Lichess client id. The logo is `media/geochess_logo.png`, a gold globe-and-rook
emblem over a dark "GeoChess" wordmark on transparency. The app uses the emblem only (the wordmark
is too dark for the dark UI); the name stays in stencil type. `pnpm --filter @empire/web icons`
(`apps/web/scripts/make-icons.mjs`) crops the emblem and renders everything in
`apps/web/public/icons/`: `emblem.png` (the `Emblem` component and notification badges),
`favicon.png` (on a dark disc so it reads on light tab strips) and the opaque home-screen icons.
Internal names (`@empire/*` packages, the plan's file name) are unchanged.

**Victory missions** (2026-09-28, from
[GeoChess_victory_conditions_coding_prompt.md](GeoChess_victory_conditions_coding_prompt.md);
not committed yet):

- **Modes.** `rules.victory.mode`: `objectives` for new campaigns (`DEFAULT_RULES`), `open` for
  any stored rules without a `victory` key, so campaigns from before are unchanged. The host can
  switch in the lobby. Holding and choosing times are lobby settings (null means the pace's
  default: 24 h / 10 min to hold, 24 h / 5 min to choose), locked with the rules. The default
  hold is also the least (`holdTimeIssue`), since the host starts rounds; changing the pace puts
  both times back to the new pace's defaults (`mergeRules`).
- **Catalog and numbers.** `packages/rules/src/victory/catalog.ts`: 10 public and 12 secret kinds
  plus the Measured Expansion fallback, instantiated as specs (targets and thresholds filled in),
  and `MISSION_RULES` (v1) with every threshold, generation limit, fit weight and timing default.
  A campaign stores its version, so tuning means adding v2. Wording comes from `text.ts`
  (`missionRequirement`, `revealRule`), shared by server notices and client cards.
- **Evaluation.** `evaluate.ts` returns parts (one per requirement), `complete`, `near` (the
  mission's own reveal rule; "one more conquest" means a country held by another player that
  borders the empire, whatever tokens, truces or accords say) and evidence. History comes from
  the event log (`victory/state.ts`): war results by event id, accord spans (renewals join up),
  round starts. Protected Expansion counts whole rounds both accords were in force and countries
  won from non-partners during the overlap.
- **Lifecycle.** Draft end → `selection` (new status): baselines recorded, up to three options per
  player from a server-private seed, persisted with their ranking; choosing is irrevocable; at the
  deadline the rank-1 option is assigned (private notice). If nothing fits a player, the host
  decides (`POST …/victory/proceed`). Round 1 (a `round.started` event) and tokens only come
  when everyone is ready.
- **Claims.** `settleVictory()` runs inside every `mutate()`, in a savepoint (`settleSafely`): if
  it throws, the change still commits without it and the error is logged, so a scoring fault
  can't stop wars, games or rounds (the campaign view likewise falls back to `victory: null`).
  It first settles any game that finished while the change waited for the lock
  (`settleFinishedGames`), then reveals (before any claim), starts, carries or interrupts claims,
  computes blockers (`blockers.ts`: every permitted outcome of the claimant's unresolved wars,
  combined; an unanswered declaration counts every redirect and tribute option; a war is named
  only if its own outcome can break the claim), then awards every eligible claim of that change
  together and checks the finish. A claim from round R scores from round R+2, once `eligibleAt`
  (set when R+1 starts, from `campaigns.round_started_at`) has passed. The scheduler triggers one
  check when a claim's time runs out (`time_reached`). Campaign Veteran scores at once.
- **Notices** go through `scope.notify()`. A change that ends the campaign sends only the
  notices marked `ending` (the result): no "war declared", "battle begun" or award notices for
  things the ending called off.
- **Persistence.** Migration `0006_victory`: `mission_players` (baseline, private options and
  seed, chosen secret, reveal), `mission_claims` (one pending per player and mission, a partial
  unique index), `mission_awards` (unique per campaign, player and mission), `campaign_results`
  (written once); `campaigns.round_started_at`, `selection_deadline`, `finished_at`; war outcome
  and game status `cancelled`.
- **The end.** First to 7; crossing together goes to the higher total, equal totals share it.
  The campaign becomes `finished`: games still underway stop first (which waits for any move
  being saved; a war whose game ended in that moment is settled by its result), then unresolved
  wars resolve as `cancelled` (no transfers, tribute tokens returned, games `cancelled` with
  their moves), pending claims and proposals lapse, every secret is revealed
  (`reason: 'final'`), and the result snapshot (with the map as it ends) is stored.
- **Privacy.** `CampaignView.victory` is public; `mySecret` is the viewer's own. Another player's
  unrevealed secret contributes nothing to views, events, pushes, notices or stats.
- **Web.** A Missions tab (phones; a column tab on desktop): the race, your secret, claims with
  what must be held, the earliest round, the holding time and any war in the way, public missions
  with everyone's progress, revealed secrets, and the results. The lobby has a Victory section
  (mode, the four cards with New targets, Change missions, Random missions, timings). Selection
  happens in the Missions tab. "Show on map" draws a mission's targets, what counts and routes
  (`WorldMap`'s `mission` and `fit` props). Victory points lead the standings.
- **Draft order** now comes from `ctx.random` (crypto in production), so tests can seed it.

An independent review found no way for a secret to leak early and no scoring bug. It found
seven smaller defects, all fixed with tests:

- Consolidation took two parallel one-country links as a two-country join.
- A claim's "waiting on" list named wars fought alongside the one that mattered.
- A game that ended just before the change that ended the campaign had its war cancelled.
- The change that ended a campaign still sent notices for what it called off.
- Cancelled games read "In progress" in the war panel.
- A fault in scoring would have blocked every change to the campaign.
- Holding times could be set below the minimum.

It also found secret options too predictable. Before the fix, a player's most frequent option
came up for 58–100% of seeds and a rival's one-seed guess matched about 1.4 of the three. Now
the most frequent comes up for 35–53% and a guess matches 0.2–0.9. The review left one thing as
is: a possible raise is modelled as losing everything the attacker could stake from the
launching country. That is conservative for every mission except Consolidation, where losing
part of it could break a block that losing all of it wouldn't.

Tests: rules 182, data 63, web 40, server 99 (`apps/server/vitest.config.ts` raises the hook
timeout: seven in-memory databases booting at once took over 10 s on Windows).

**Mission rules version 2** (2026-09-29, the user's list; not committed yet). New campaigns play
version 2; every campaign stored before keeps version 1, which never offers these missions
(`MissionRules.publicKinds` and `secretKinds` say what each version offers; the lobby picker and
the rules guide list the campaign's version).

- **Public:** Mare Nostrum (12 of the 21 Mediterranean countries, at least 3 on each shore:
  European, African, eastern; a long campaign), One Billion (people in countries won since the
  draft), Great Expanse (7.5 million km² won since the draft), Seven Wonders (3 of 8 countries
  with a wonder, 2 won since the draft), Kingslayer and Lightning Campaign (records: a war won on
  whoever led the race when it was declared, while you trailed; two wars declared in one round,
  won). Fixed targets are generated first, so Regional Power, The Great Connection and Strategic
  Positions keep clear of them; Seven Wonders and Mare Nostrum share Italy and Egypt.
- **Secret:** eight named sets (Black Sea, Baltic League, Gulf Hegemon, Caspian, Nordic, Horn of
  Africa, Andean Spine, Mekong), three routes (Silk Road China–Italy, Cape to Cairo, Pan-American
  Highway USA–Chile) dealt to an empire at or within reach of one end, Buffer Zone (the most
  valuable drafted country with 3–6 neighbors, and all of them), Strait Keeper (both shores of
  three of twelve named straits, from the nearest not already held), Half of Humanity (dealt only
  to whoever holds one of the two most populous countries), and a fourth family, **battle**:
  Nemesis (hold 3 countries taken from the rival with the longest front), Backstab (break an
  accord, then take a country from that partner in a war declared within the next two rounds;
  revealed by the break), Iron Wall (two wars won as defender), Checkmate Artist (two wars won by
  checkmate). The last three are records and score at once.
- **Dealing.** With four families and three options, the order the families are drawn in comes
  from the player's seed (`MissionRules.families`), so a hand is three of the four. Battle
  missions fit anyone with an opponent, so under version 2 every player gets three options and
  the Measured Expansion fallback no longer comes up. Options show conquests, or wins for the
  battle missions (`effortText`). Secret options are now dealt with the campaign's history, since
  an accord broken during the draft would make Backstab one step away.
- **History.** `loadHistory` (server) adds each war's declaration (round and event id) and how
  its deciding game ended, who broke each accord, and every award with its event id. Kingslayer
  works out who led at a declaration from that (`leadersAt`): points awarded before it, then
  value on the map as it was, undoing every later war's transfers.
- **Wording.** Figures in progress parts can carry a unit (`people`, `km2`, `percent`), shown by
  `partAmount`: "1.46 billion", "7.5 million km²". A Nemesis's rival is named through
  `missionRequirement`'s `playerName` option.
- **Random missions** (the user's call, 2026-09-29): the host can have the four public missions
  drawn at random in the lobby (`POST …/victory/missions/random`). The server draws four
  different ones from those the campaign's version offers and this map and draft mode can play
  (`drawPublicKinds`), uniformly, with no limit on long-campaign missions, and gives them fresh
  targets; a draw whose targets can't be kept apart is drawn again (up to six times).

Tests since: rules 211, data 66, web 40, server 113.

**Balance simulation** (2026-09-29, at the user's request): whole campaigns played by bots, to
find missions that are too easy or too hard. Findings and recommendations are in
[balance-report.md](balance-report.md). Not committed yet.

- **`packages/sim` (`@empire/sim`)** plays campaigns headlessly.
  - It uses the rules package for every rule and mirrors only the server's orchestration
    (`src/engine/`): round starts, the war lifecycle and `settleVictory`.
  - The bots (`src/bots/`) chase their missions, block visible claims, answer wars and make and
    break accords.
  - Run it with `pnpm sim` and summarise with `pnpm sim:report`; `trace` tells one campaign round
    by round. The README explains the scenarios, the knobs and how to add a what-if.
  - Output goes to `packages/sim/out/` (git-ignored).
- **`apps/server/test/sim-parity.test.ts`** replays eight simulated campaigns through the real
  server. Awards, reveals, winners and the final map must match exactly. If the server's lifecycle
  changes, mirror it in `packages/sim/src/engine/`, or this test fails.
- **What the runs found** (44,284 campaigns):
  - **Pace.** Campaigns are won around round 6–9, not 15–25. At 2–3 players a sixth to a quarter
    never finish.
  - **Near-free public missions.** Campaign Veteran and Kingslayer are scored by 70–98% of
    players.
  - **Secrets.** The battle secrets double their holder's chance of winning, while most region and
    route secrets are almost never done.
  - **The draft.** At 2–3 players it hands out Strategic Positions and similar positions.
  - **Dead missions.** Great Connection and Mare Nostrum are dead at 5 or more players.
  - **What was ruled out.** No single number fixes the pace, and more points to win makes half of
    all campaigns stall.
  - **Recommendations** for mission rules version 3, and two new host settings (a season length
    and a slower token rate), are in the report. All but the slower token rate are now applied:
    see the next section.

Tests since: sim 17, server 121 (the parity test).

**Mission rules version 3 and seasons** (2026-09-29, the report's recommendations at the user's
request, all but the slower war tokens; not committed yet). New campaigns play version 3 with a
last round of 25. Campaigns stored before keep their version, and have no last round unless the
host sets one in the lobby. What the simulator says about the result is in the report's
[Version 3, as built](balance-report.md#version-3-as-built).

- **Records are harder.**
  - Campaign Veteran counts only wars won as the attacker, opponents included: four of them,
    against three different opponents, or all there are (`attackOnly`).
  - Kingslayer counts only a war declared on the leader on points while they were four or more
    points ahead (`lead`; value no longer decides who leads, so nobody leads before points exist).
  - Checkmate Artist needs three mates, Iron Wall three wins (and is dealt only from four players),
    Nemesis four countries (revealed at three).
  - Backstab needs two countries from the betrayed partner in wars declared within the next two
    rounds (`count`). The report said "in the round after the break"; simulated, that left it
    completed 5% of the time and its holder with 0.4 of a fair chance, so it was eased.
- **Giants are bigger:** Great Expanse 20 million km², One Billion two billion people (it's named
  for its figure, so version 3 shows "Two Billion": `missionName`, `kindName`), Great Powers all
  three won since the draft.
- **Across the Seas** needs two attacks.
- **Positions need a conquest** (`needsConquest`): Strategic Positions, Regional Power and Mare
  Nostrum count only with one of the countries held won since the draft, Continental Bridge with
  one in the block, and The Great Connection through a chain that passes through one
  (`pathThrough` in `world.ts`: a country lies on such a chain when two routes from it, one to
  each end, share nothing else, found as a two-unit flow).
- **Table size:** The Great Connection and Mare Nostrum are only for four players or fewer
  (`MissionRules.maxPlayers`, `publicMissionIssue(…, players)`). The lobby card says so once a fifth
  player joins, the draft can't start with them, and random draws leave them out. **Great Powers
  replaces The Great Connection in the default set** (the user's call).
- **Long campaigns:** `MissionRules.long` lists the missions that make for a long campaign (the
  "Long campaign" tag in the lobby, on mission cards and in the rules, version by version), and a
  random draw takes at most one of them (`longDrawn`); version 2 draws with no limit, as before.
  Version 3's list is the public missions a fifth of players or fewer scored in the simulator
  (Continental Bridge at 5 or more players), and the five secrets done least: Silk Road, Cape to
  Cairo, Pan-American Highway, Encirclement and Unification.
- **Region and route secrets** (the user's call: fewer targets, tuned in the simulator):
  - Named seas and regions need half their countries, at least two (Black Sea three of six, Baltic
    League five of nine, the sets of four two of them). Mountain Kingdom and Hidden Triangle need
    two of three (Hidden Triangle's targets one or two conquests away), Strait Keeper one strait,
    Island Empire three islands.
  - These are revealed only once complete (`reveal` = `need`), not one short: rivals saw the last
    step coming and blocked it.
  - Tried and dropped: holding region and route secrets to fewer conquests when dealing, and
    Encirclement to rings of three. Completion didn't move, and chains and rings looked cheap, so
    players chose them and rarely finished them.
- **Summaries follow the version:** `missionSummary(kind, cfg)` words each mission with its
  version's numbers; `MissionInfo` no longer has `summary` or `long`.
- **The season** (`rules.victory.lastRound`, 2 to 100 or null; `lastRoundOf(rules)` is null for
  open-ended campaigns). The lobby offers rounds 15, 20, 25 or 30, or none. In the last round the
  war room says so and the host's button reads **End the campaign**: `nextRound` then calls
  `endSeason` (`victory/finish.ts`), which brings missions up to date (something just done could
  still take someone to 7), then gives the win to the most points, then the campaign's tiebreak
  (`seasonWinners`), players level on all of it sharing it. The result and the `campaign.won` event
  carry `seasonEnd`; the missions panel and the dispatches say how it ended. Claims still waiting
  don't count.
- **Tiebreak** (`rules.victory.tiebreak`, GitHub issue #11, 2026-10-02): players level on points at
  the end of the season are separated by the largest population, then the most land area, then the
  largest nominal GDP (`realWorld`, `seasonMeasures` in `victory/claims.ts`). Rules stored before
  it read as `value`, the most valuable empire, which those campaigns started with; new campaigns
  get `realWorld` through `DEFAULT_RULES`. There's no lobby control. The result keeps the tiebreak
  and each player's measures, so the final results name what decided it ("then the larger
  population: 812M to 640M"); the rules pages and the settings list say which tiebreak applies.
- **Simulator:** campaigns play the current version with a last round of 25; `--mission-rules 2`
  and `--last-round none` replay the report's setup. `endSeason` is mirrored in `engine.ts` (a
  `{ t: 'end' }` action), records carry the version and last round, and the bots value the version
  3 rules. The what-ifs in `variants-catalog.ts` before "Tuning mission rules version 3" patch
  version 2. The parity test gained two campaigns that end on points and one on version 2.

- **Web:** the lobby's Victory section has a Last round setting and flags a mission the table has
  outgrown; the campaign header and war room read "Round 12 of 25"; the missions panel and final
  results say when the season ended it; `rules-text.ts` lists the last round.
- **Dev database:** Field Marshal's test campaigns "Season Check" (a lobby) and "Last Round Check"
  (with Bo, ended on points after round 2) come from this work, plus a stray lobby also named
  "Last Round Check".

Tests since: rules 229, web 40, sim 20, server 127 (482 in all).

**Revised war answers** (2026-09-29, at the user's request, from the balance report's finding that
a defender gains by raising whatever happens, and that nothing lets anyone out of a war; not
committed yet). All of it is host settings in `rules.war`. Rules stored before read as the original
game (a free raise, redirects anywhere and free, tribute, no fortifying or calling off), so no
campaign underway changes, production's included; new campaigns start from `REVISED_WAR_RULES`
through `DEFAULT_RULES`.

- **Raising** (`raise`): `matched` (the default) has the defender put one of their own countries
  into the war, worth 50–100% of the target (`MATCHED_RAISE_MIN_PCT`, `matchedRaiseRange`), free to
  stake and no more than the attacker could still add from the launching country
  (`raiseOptions`). The attacker adds at least as much or withdraws; winning takes both
  (`WarCounter.added`, `ActiveWar.added`, `warTransfers`). `token` is the old raise to `raisePct`
  paid for with a war token, which goes to the attacker if they meet it. `free` is the original.
  `off` has none. The 50% floor came from the simulator: with no floor, defenders put in a country
  worth 1, attackers matching with whole countries overshot by about 2, and raising stayed a cheap
  win.
- **Redirects**: `redirect: 'nearby'` needs the offered country to border the target, and the war
  keeps the first target's clock (`clockTarget`); `redirectToken` makes a redirect cost a token,
  paid to the attacker if they fight on. Counter tokens sit in `WarCounter.tokens`; unanswered at
  the campaign's end, they go back (`finishCampaign`).
- **Reserves**: with a matched or token raise, a declaration can set countries aside
  (`DeclareWarInput.reserves`, `wars.reserves`, `checkReserves`). They're public and locked while
  the answer is pending; a raise they cover is met at once with the cheapest subset
  (`stakeFromReserves`), logged as a `war.reply` with `fromReserves`.
- **Fortifying** (`fortify`): a war token makes war on a country need `raisePct` until the round
  after next starts (`holdings.fortified_until`, `fortifiedUntil`, `declarationFloor`, used by
  `checkTarget`, `checkStake`, `suggestStake` and `launchersFor`). Public (`CampaignView.fortified`,
  a `country.fortified` event, a rampart on the map); cleared when the country changes hands;
  fortifying again in a later round extends it.
- **Calling off** (`recall`): the attacker ends a declaration before the answer
  (`POST …/wars/:warId/recall`): `war.recalled`, then resolved as `withdrawn`.
- **Peace terms** (`peaceTerms`, which takes tribute's place as an answer): either player offers
  terms until the game is over (`apps/server/src/wars/peace.ts`, table `peace_offers`). Terms move
  staked countries from the attacker; the target (and an added country), or instead one country
  worth less than the target, from the defender; up to 10 tokens one way; and an optional accord
  (`PeaceTerms`, `peaceIssue`, `peaceCountries`). Offers are private like accord proposals: no
  events, `scope.notifyOnly`, and `WarView.peace` holds only the viewer's own. They lapse after the
  answer window, a newer one from the same player replaces them, and the recipient's move in the
  war's game declines them (inside the move's transaction, `playMove`). Accepting stops the game
  (`stopWarGames`: game row first, then the offer, so a move can't deadlock with it; a game that
  finished first keeps its result), hands over the terms, resolves the war as `settled` (a truce,
  neither a win nor a loss; `war.resolved` carries the terms), and signs any accord
  (`signAgreedAccord`, shared with `answerAccord`). Claim blockers ignore peace terms, since the
  claimant must agree to them.
- **Lobby**: the Wars settings gained Raising the stakes, four toggles, and the least and raised
  stake in More war settings. The rules guide and settings list describe each campaign's own
  choices (`raiseText`, `raisedRowLabel`).
- **Simulator**: mirrors all of it (fortifying, calling off, peace offers answered at once, reserves
  and auto-met raises, counter tokens) and plays the revised answers by default; bots fortify what
  a claimed mission leans on, set reserves for token raises, and offer tribute-like peace with a
  2-round accord. `whatif:original-answers`, `whatif:raise-token` and `whatif:raise-off` compare
  (results in the balance report's
  [War answers, revised](balance-report.md#war-answers-revised)). The parity test replays three
  more campaigns: two on the original answers, one with token raises, reserves, fortifying, peace
  and declarations called off (`recallRate`, a test-only bot knob).
- `answerWindow` (unused since Phase 2) went with the rewrite of `war-detail.tsx`.
- **Dev database:** Field Marshal's "Peace Check" (with Bo, round 7: two wars settled by peace,
  Iran fortified, a matched raise with Argentina waiting on Field Marshal) and "Answers Lobby" (a
  lobby, raise set to cost a token).

Tests since: rules 254, data 66, web 41, sim 25, server 151 (537 in all; the new server file is
`test/war-answers.test.ts`).

**GitHub issues #2 to #5** (2026-09-30):

- **The host sets colors (#2).** In the lobby the host can give any player a free color ("Color"
  beside their name, `PATCH /api/campaigns/:id/members/:userId`): for friends who never picked
  one, and for scripted players nobody signs in as. Joiners still get the first free color, so the
  first to join is Sky beside the host's Cobalt.
- **Clearer sea lanes (#4).** Lanes are dashes of map-room white on a dark casing (`SeaLanes` in
  `world-map.tsx`), so they read over sea, over land at their ends and over hatching; the selected
  country's lanes are stronger still. War arrows stay the strongest marks on the map.
- **Missions framed where they are (#3).** "Show on map" frames its countries with `frameAround()`
  in `lib/map-geometry.ts`, where the map's geometry now lives. A country whose box is wider than a
  quarter of the map and bigger than the others' put together (Russia, and the United States,
  Fiji, Polynesia, Micronesia and New Zealand, which cross the date line) counts only where it
  comes near the others: its part within a quarter of their extent, and its mainland as far as the
  reach must stretch to meet it. The Baltic League shows the Baltic, not all of Russia; the
  Pan-American Highway the lower 48 and Chile, not the world. Great Powers still shows all three.
- **The header's call to action is a button (#5).** "Your pick" and "Choose mission" open the
  draft or the missions, "Your move" the next game waiting for a move, and "Answer needed" the next
  thing waiting for an answer (`model.answers`: one per war or proposal, soonest deadline first).
  What needs the answer lights up: the answer box, peace terms offered, or the accord proposal
  (`useSpotlight` in `ui.tsx` scrolls it into view, focuses it and pulses amber, holding still
  with reduced motion). Pressing again moves on to the next (`nextAnswer`). With declaring in turns, "Your turn"
  (after "Your move", before "Answer needed") opens the war room.

Tests since: web 49, server 152 (546 in all).

**Declaring in turns** (2026-09-30, at the user's request: "Players should take turns declaring war
in that phase. Now the bots are very fast to declare"). Anyone could declare
whenever they liked, so whoever acted first when a round began (scripted players, at once) took the
best targets and locked the countries around them. New campaigns now take turns; it's a host
setting in `rules.war.turns`, false when absent, so every stored campaign keeps declaring freely
(production's included), and `REVISED_WAR_RULES` (so `DEFAULT_RULES` and the simulator) turns it on.

- **Rules** (`packages/rules/src/turns.ts`): `turnOrder(seats, round)` is the draft order round the
  table, one seat further along each round, round 1 starting with whoever drafted last.
  `nextTurn` gives the turn to the next player after the one who acted (them last) who hasn't
  passed and `canTakeTurn` (a token, and a country to declare war on or one of theirs to fortify);
  a player busy in a live game goes after everyone else who can. `checkTurn` refuses anyone else
  (`not-your-turn`) and everyone once declaring is over (`turns-over`); `turnsBefore` is the war
  room's guide to when you're up. A turn lasts the answer window (`TURN_WINDOW_MS`: 24 h, 5 min).
- **A turn** is one declaration or one fortification, or a pass, which ends that player's declaring
  for the round. Silence passes when the time runs out (the scheduler's `expireTurns`), and the host
  can pass the turn for whoever holds it (`POST …/turn/pass` names the player, so a pass can't land
  on the next one if the turn has just moved on). Declaring is over when nobody left can act; it
  isn't reopened if someone gains a token later. Answers, replies, peace terms, calling off,
  diplomacy and games never wait for turns.
- **Server** (`apps/server/src/wars/turns.ts`): the round's order, passes, whose turn and its
  deadline are columns on `campaigns` (migration `0009_declaration_turns`). `beginTurns` runs at
  every round start after the accords (`nextRound`, and round 1 from the draft or once secret
  missions are chosen); `round.started` carries the order. Declaring and fortifying check the turn
  and pass it on (`turnTaken`). The turn is only reassigned then, at a pass and at a round start, so
  a player who loses their last token on their own turn (paying for a counter) passes by hand or by
  time. Events: `turn.passed` (`auto` for time, the host as actor for a host pass) and
  `turns.ended`, both under the Wars feed filter. "Your turn to declare war" is pushed, with email
  in correspondence; the home screen counts it.
- **Live games wait** while players are still declaring (`beginFighting`, `startQueuedGames`), and
  start once declaring is over: otherwise a player would sit at the board while their turn ran out.
  Correspondence games start at once, as before.
- **Web:** the war room's "Declaring in turns" block (the order, whose turn and how long, "Your turn"
  with Pass, and "Pass for …" for the host); country panels say whose turn it is instead of offering
  Declare war or Fortify; a "Your turn" header badge, title flag, toast and Wars badge; dispatch
  lines; the lobby toggle "Take turns declaring"; the rules guide's round, Declaring war ("Taking
  turns"), fortifying, battle and deadlines text; "Declaring" in the settings list.
- **Simulator:** `engine/turns.ts` mirrors the server; each round the bots take turns (fortify on
  their first turn if they want, then one declaration a turn, or pass) before answers and games, so
  later waves only answer and fight. Passes are `{ t: 'pass' }` actions, which the parity test
  replays, and it checks every round begins with the simulator's order. `whatif:no-turns` plays
  the old way; the comparison is in the balance report's
  [Declaring in turns](balance-report.md#declaring-in-turns): the game plays the same.
- **Tests** that exercise other rules pin `turns: false` (`ORIGINAL_ANSWERS` in both test helpers,
  the diplomacy tests, the simulator's scripted campaigns). `apps/server/test/turns.test.ts` covers
  the server side.

Defaults taken while building (not asked; easy to change):

- **Order:** a rotation of the draft seats, round 1 from the last seat (the first seat already had
  the draft's first pick). The obvious alternative is a catch-up order, the player furthest behind
  first; the simulator can't compare the two, since its bots don't race.
- **Passing is final** for the round, and a timeout is a pass: an away player costs the table one
  turn's wait a round, not one a lap. Unused tokens carry over as before.
- **Turn time** is the answer window, not a host setting. A correspondence table can spend days
  declaring; the host's "Pass for …" is the remedy.
- **Players with nothing to do are passed over**, not marked as passed, so a player who gains a
  token while others are still declaring gets their turn when it comes round.

Tests since, with both: rules 263, data 66, web 52, sim 27, server 162 (570 in all).

**Bots** (2026-09-29, at the user's request; not committed yet): players the host adds in the
lobby, each with a chess level from 1 to 8. The user's calls, asked before building (all four were my
recommendations): Stockfish's lite WASM build committed to the repo, rather than the 205 MB npm
package or a hand-written engine; levels 1 to 8 like Lichess's computer, each with a short
description and a rough rating checked by a round robin; bots act at once (correspondence answers
and moves within seconds, a short clock-aware pause in live games); and the level changes only the
chess, every bot playing the map with the simulator's standard strategy.

- **Lobby.** "Add a bot" (host only, in the lobby, with a seat free) with a level select that shows
  what the level plays like. A bot takes the first call sign nobody uses (Alpha, Bravo, Charlie,
  Delta, Echo, Foxtrot, Tango, Victor; none is a place on the map, which `datasets.test.ts` checks)
  and the first free color. The host can change a bot's level until the draft starts
  (`PATCH /api/campaigns/:id/bots/:botId`) and removes one with the usual Remove (`…/kick`), which
  deletes its user too; deleting the campaign deletes its bots. `member.joined` carries
  `bot: { level }` ("Field Marshal added Alpha, a level 4 bot (club player).").
- **Identity.** Each bot is a user of its own, `bot_` and 12 letters drawn from `ctx.random` (so a
  seeded test deals the same secrets every run), a member of one campaign with `members.bot_level`
  (migration `0010_bots`, which also adds `members.bot_round`). No person's id can start with `bot_`,
  so `isBotId` is a prefix test and SQL uses `starts_with`. `MemberView.bot` is `{ level }` or null;
  levels are public.
- **How they act.** `BotRunner` (`bots/runner.ts`) hears from `mutate()` of every change to a
  campaign with a bot in it (private ones too), and from `changeGame` and `startGame` of every change
  to a game with a bot in it. A pass loads a snapshot (`bots/state.ts`, one repeatable-read
  transaction) and asks `nextAction` (`bots/decide.ts`) for one action at a time: first anything
  waiting on a bot (accord proposals, a secret mission to choose, peace offers, declarations,
  counters), then each bot's round (breaking an accord, proposing one, fortifying; once a round,
  recorded in `members.bot_round` through a private `mutate()`), then declarations while it has
  tokens and a war worth it. Every
  action goes through the ordinary service (`declareWar`, `respondToWar`, `answerAccord`…), so the
  rules are checked for bots as for anyone. A refused action is logged and falls back to what
  silence would do (accept a declaration, withdraw from a raise, decline an offer). Bots draft through
  auto-draft (`autodraft: true`), with the simulator's mission-aware picker (`bots/draft.ts`).
- **Strategy** is the simulator's standard bot, unchanged. `packages/sim/src/live.ts`
  (`@empire/sim/live`, now a server dependency) builds a `SimState` from a live campaign
  (`liveState`) and asks for one decision at a time (`liveBots`). The simulator's `diplomacy()` was
  split into `breaksAccord`, `proposalPartner` and `accepts`, drawing random numbers in the same
  order: traced campaigns before and after compare byte for byte. Strategy assumes an even game
  against anyone (every rating 1500), so a bot's level changes only its chess.
- **Privacy.** A bot's view (`botState`) holds its own secret, options, proposals and peace offers;
  rivals' secrets only once revealed; proposals and offers only where it's one of the two players.
  `bots-campaign.test.ts` builds a view in the middle of a campaign and checks.
- **Chess.** Stockfish 19 lite, single-threaded (Stockfish.js by Chess.com, in
  `apps/server/engine/` with its license, hashes and how to update it in the README; a nested
  `package.json` marks the folder CommonJS) runs as a child process speaking UCI (`bots/engine.ts`).
  One process serves every bot, one search at a time, at the lowest CPU priority so the game
  server's clocks and sockets come first. It starts on the first search, stops after 10 idle
  minutes (it takes about 100 MB), and restarts if it dies; a search it died under gets one retry. A search that overruns is told to stop, then the process is killed. Without the files, bots
  play random moves and the server warns at startup; a failed search plays a random move.
  `STOCKFISH_PATH` points elsewhere. The Dockerfile copies `engine/` into the image.
- **Levels** (`bots/chess.ts`). Levels 3 to 7 play at Stockfish's `UCI_Elo` 1400, 1500, 1900, 2400
  and 2700, searching only as deep as a limited Stockfish chooses its move (1 plus its skill level),
  so they take milliseconds and don't depend on the server's CPU. Levels 1 and 2 play the lowest
  `UCI_Elo` (1320) with 35% and 12% random moves. Level 8 is full strength for up to 1.5 s a move (less
  when its live clock is low), its first 10 plies varied among lines within 30 centipawns. The
  ratings `BOT_LEVELS` quotes come from the ladder (`pnpm --filter @empire/server bot-ladder`): 1,335
  games (150 between neighbouring levels, 75 two apart, 30 in each pairing with level 8), fitted by
  Bradley–Terry and pinned at level 3 = 1400, gave 768, 1097, 1400, 1634, 1964, 2293 and 2570, steps
  of 230 to 330, rounded to 750, 1100, 1400, 1650, 1950, 2300 and 2550. Level 8 won all 60 of its
  games, so its "about 3000" is a floor rather than a measurement. An earlier ladder showed why the
  levels aren't evenly spaced `UCI_Elo`s: strength goes by the depth a limited Stockfish picks at,
  so 1650 and 1900 came out only 100 apart while 1400 and 1650 were 413.
- **Timing.** Correspondence: bots answer and move at once, and the board says "Thinking…" rather
  than the time per move. Live: the bot works its move out as soon as its turn begins (after the
  countdown, for the first) and plays it once its pause since then is up, so the search is part of
  the pause (`thinkingMs`: at most
  1.3 s for the first 8 plies, then about a hundredth of the clock plus a third of the increment,
  varied by half either way, at most 6 s and never more than a fifteenth of the clock, and quick
  under 20 s). Bots can play several live games at once: `busyPlayers` and `startQueuedGames` leave
  them out, so a queued game with a bot starts as soon as the person in it is free.
- **Draws.** A bot takes a draw that wins it the war (Black in Armageddon) and refuses one that loses
  it (White in Armageddon). Otherwise it looks (depth 12, full strength): with defender-holds it takes
  a draw unless 0.3 pawns better; in a first game that would go to Armageddon, the attacker takes it
  unless 1.5 pawns better and the defender only when 1.5 pawns worse. Bots never offer draws, resign
  or call a declaration off.
- **Peace terms.** A bot defender that prefers terms offers them and answers the declaration with
  its fallback straight away (the simulator has terms answered first, which a person may take hours
  over). Moving would pass over terms offered to a bot, so it answers them before its move.
- **Messages and notices.** Bots don't read messages: the server refuses private messages to them
  (a bot's user must stay deletable) and the Messages list leaves them out. Notices to bots are
  dropped (`skippingBots` wraps the notifier).
- **The sweep.** `runDueWork` ends with `ctx.bots.sweep()`, which finds answers, secrets, rounds and
  moves owed by bots that nothing announced (after a restart), leaving a campaign whose pass failed
  alone for a minute. It stops after one query when no campaign underway has a bot.
- **Deploys.** `render.yaml` now redeploys the server when `packages/sim/**` changes, since the
  server bundles the simulator's bots.
- **Checked in the browser** on the dev server: lobby (desktop and phone), the draft, secrets, a
  correspondence game against a level 4 bot, and a live 3+2 game against a level 3 bot (first move
  about a second after the countdown, then about a second a move in the opening and four at move 8).
  A review of the finished diff found two bugs (a queued live game with a bot waited behind the bot's
  other game; the build filter above) and five smaller things (priority, the sweep's queries, the
  bookkeeping outside `mutate()`, the pause after the search, the guide's wording), all fixed. It
  also noted that each action reloads the whole history; left as is, since a bot's actions add to
  it anyway.
- **Web.** The lobby's players list (bot rows with a level select for the host and the level in
  words for everyone else, and "Add a bot"); `BotTag` ("BOT 4", spelled out for screen readers and on
  hover) beside every `PlayerName` and on the empire page, with the level in the page's facts; bot
  picks read "claimed" in the dispatches and bots lose the draft panel's "auto-draft" note; the
  rules guide's "Playing with bots" section, whose level table reads `BOT_LEVELS`.
- **Dev database:** Field Marshal's "Bot Check" (with Alpha, level 4, and Bravo, level 2): round 1,
  Alpha's war on Greece being played with Field Marshal to move, Alpha's accord proposal to Field
  Marshal waiting, and a finished bot-against-bot war over Iran; "Bot Lobby Check" (a lobby with
  Alpha, level 1); and "Live Bot Check" (live 3+2, open-ended, with Alpha at level 3, whose war on
  China Field Marshal left to run out on the clock).

**Bots standing in for players** (2026-09-29, the user's answer to the open question below). When
a player goes quiet, the host opens their empire page and chooses **Hand to a bot** (with a level),
from the draft on. The bot plays that seat as its own: the countries, wars, accords, secret mission
and points stay the player's, and so does the user id, which the bot acts under.

- **Model.** A seat is played by a bot when `members.bot_level` is set: a bot of its own (user id
  `bot_…`) or, with the player's own id, a stand-in. Everything that asks "is this a bot?" now asks
  the seat (`botSeats`, `playedByBot` in SQL); `isBotId` is only for bots' own users (deleting them,
  refusing messages to them, the notifier's safety net). `MemberView.bot.standIn` tells the two
  apart.
- **Service** (`bots/standins.ts`): `PUT /api/campaigns/:id/players/:userId/stand-in` (host; not in
  the lobby, where the host removes a player and adds a bot instead; not the host's own empire or a
  bot) sets the level and `bot_round` to the current round, so the round's accords and fortifying
  wait for the next round while answers, moves and declarations start at once; in the draft, the
  bot picks straight away if it's the player's turn (`advanceDraft` now counts bot seats as
  auto-drafters). `DELETE` (the player, or the host) hands it back. Events `standin.began` and
  `standin.ended`; the player is told at the handover, and when the host hands it back.
- **The player meanwhile** sees a banner with **Take it back**, can read everything and chat, and
  gets no notices (`mutate()` drops notices to bot seats; the correspondence "Your move" checks the
  seat). Their own requests to act are refused with `stood-in` by `registerStandInGuard`
  (`bots/guard.ts`), a pre-handler on every write under `/api/campaigns/:id/…` and
  `/api/games/:gameId/…` except chat and the stand-in route; the bot's actions go through the
  services directly, so they're not affected.
- **Checked in the browser:** Field Marshal handed Bo's empire to a level 3 bot, which declared war on
  Russia at once; Bo saw the banner, was refused a fortify, took the empire back; the dispatches read
  "Field Marshal handed Bo's empire to a level 3 bot." and "Bo took the empire back from its bot."
- **Dev database:** Field Marshal's "Stand-in Check" (with Bo, round 1, Bo's bot-declared war on
  Russia waiting for Field Marshal's answer).

Tests since: rules 260, data 67, web 41, sim 25, server 180 (573 in all; the new server files are
`test/bots.test.ts` (bots of their own and stand-ins), `test/bots-campaign.test.ts` on the real map,
and `test/stockfish.test.ts`, which plays the shipped engine).

### Bot defaults taken while building (not asked; easy to change)

- **Call signs** rather than names chosen by the host; **level 3** as the add-bot default; levels
  locked once the draft starts, like the rules.
- **Strategy at the simulator's knobs** (`DEFAULT_KNOBS`): bots propose 3-round accords, sign or
  refuse proposals by the simulator's rule, raise a third of the time when it pays, and so on.
- **Every rating 1500 to the strategy**, so a strong bot doesn't attack more for knowing it'll win
  the game, and a weak one doesn't hide.
- **One engine process**, searches queued. A pass re-weighs declarations on every change to the
  campaign: on the real map with seven bots holding three tokens each, a snapshot took about 3 ms
  (embedded database) and each bot's declaration 1 to 2 ms on a laptop.

### Bots: the user's answers (2026-09-29)

- **Replacing an inactive player:** yes, built as stand-ins (above). Defaults taken: the player can
  take the empire back without the host; the host can hand it back too; the bot doesn't redo the
  round's accords and fortifying; a stand-in's level is fixed until it's handed back.
- **Map play by level:** no; every bot keeps the standard strategy at every level.
- **Level 8 on Render's tenth of a CPU** playing weaker than on a laptop: fine.

### Bots and declaring in turns (2026-09-30, merging the bots with `main`)

Where the campaign declares in turns, a bot fortifies and declares only on its turn, as the
simulator's `takeTurns` does: on its first turn of the round (before it has fortified or declared
anything) a country to fortify if it wants one, otherwise one war, otherwise it passes
(`turnFor` in `bots/decide.ts`, the `fortify` and `pass` actions in `runner.ts`). Its round
(accords) no longer fortifies then. The sweep also picks up any campaign whose turn a bot holds.
Bots see the turn state, which is public. A person holding the turn keeps the bots waiting, as
anyone would; the host's "Pass for …" and the turn's deadline cover an away player.

**Rating handicaps** (2026-10-01, at the user's request: "the option to give auto handicaps to
weaker chess players. If all players sign in via lichess then we use their rating to compare.
Players that are not using lichess sign in can assign their own elo for the auto handicap if that
option is toggled on by the host"; not committed when written). The user's calls, asked before
building: **time odds** (rather than draw or material odds), and ratings **frozen when the draft
starts**.

- **Settings** (`rules.war`): `handicap` (`off`, `light`, `full`; absent reads `off`, and new
  campaigns start `off` too) and `selfRatings` (players without an established Lichess rating type
  one in; off: they play unrated). Lobby: "Rating handicap" under Wars, and the toggle under it.
- **Ratings** (`packages/rules/src/handicap.ts`, `playerRating`): a seat a bot plays has its
  level's `BOT_LEVELS` rating (a stand-in too: handicaps follow whoever plays); otherwise the
  player's Lichess rating for the campaign's kind of game (`lichessPerfFor`: correspondence, or
  Lichess's own category for the clock, so 3+2 and 5+3 are blitz, 10+5 and 15+10 rapid), or the
  nearest kind they play if that one is provisional or unplayed (`lichessRatingFor`); otherwise,
  with `selfRatings`, the number they gave (400 to 3200). A Lichess rating always wins over a typed
  one. No rating: no handicap in that player's games.
- **Lichess.** Ratings are kept on the user (`users.lichess_ratings`, `lichess_ratings_at`): read
  from `/api/account` at sign-in (the token is still revoked at once), and from the public
  `/api/user/:name` (`ratings/lichess.ts`, `ctx.lichess`, a 5 s timeout) when a Lichess player
  opens a lobby with handicaps on (`POST /api/campaigns/:id/rating/refresh`, at most every 10
  minutes; it skips the campaign lock and pushes `campaign.changed` to the player's lobbies) and
  before the draft freezes them, if more than an hour old (`refreshBeforeFreezing`, outside the
  lock). Lichess unreachable keeps the old ones. Players who signed in before this have none until
  one of those reads.
- **Freezing.** `startDraft` writes each person's rating to `members.rating` (`freezeRatings`).
  `members.claimed_rating` is the typed one (`PATCH /api/campaigns/:id/me` with `rating`, lobby
  only). `MemberView.rating` (`seatRating` in `ratings/service.ts`) is live in the lobby, frozen
  after, the bot's for a bot seat, and null with handicaps off. Public, like the war data.
- **Time odds** (`ratingHandicap`, `clockFactors` in `war.ts`): gaps under 50 points count for
  nothing; past that the weaker player gets 8% (light) or 16% (full) more time per 100 points, up
  to 30% or 60%. In live games the stronger player loses as much (full at a 400-point gap: 8 minutes
  against 2 at 5+3); in correspondence the stronger keeps their time, so no deadline lands in
  someone's night. It multiplies with the clock modifiers (whose 25% cap is unchanged) and
  Armageddon's share, and is worked out when the game is created (`warHandicap` in
  `wars/service.ts`), so it's baked into the game's `timeControl`.
- **Web.** The lobby's "Ratings for the handicap" lists every rating and its source, with "Your
  rating" for players who may type one, "Check Lichess again", and "Link your Lichess account"
  (the existing OAuth route links to the signed-in player). The stake builder shows a "Handicap"
  line under the clock; the board already shows each side's time. The rules guide has a "Rating
  handicap" part and the settings list a row (`handicapText`, `ratingText`, `handicapLine`).
- **Simulator.** `whiteEdge` now uses `clockFactors`, so the simulator plays the handicap when the
  rules have one, every simulated player rated at their `elo`. Scenarios `elo-300-light`,
  `elo-300-full` and `elo-star-full`.
- **Checked in the browser** (dev server): a live 5+3 lobby with Ann (1850, own), Bo (1450, own) and
  a level 3 bot (1400); Bo's change after the draft started was refused; Ann's declaration on Russia
  previewed "Bo +60% time, You −60% (400 points apart)" and the game came out 2:18 + 1.4 s for Ann
  (60% off, then her +15% supply lines) against 8:00 + 4.8 s for Bo.

Tests: rules `handicap.test.ts`, server `test/handicap.test.ts` (with a fake Lichess; tests never
reach Lichess, `startTestServer`'s `lichess` option), web `rules-text.test.ts`.

**Over the board** (2026-10-01, at the user's request: "Some friend groups might want to meet up and
play the chess games over the board. Each battle should have the option of concluding otb. The
winner can then declare victory and the loser acknowledges it"). Any game between two people can
move to a real board, in any campaign: it needs both players' agreement, so it isn't a host
setting, and nothing changes for players who don't use it.

- **Rules** (`packages/rules/src/over-the-board.ts`, `overTheBoard()`): either player offers, the
  other accepts (offering back accepts) or declines; a move online declines it, like a draw offer.
  Over the board there are no moves, clocks or draw offers here. A player reports "I won" or a draw
  and the other confirms or disputes; the reporter may change their report, the other can't report
  over it. "I lost" is resigning, which ends the game at once. A report nobody answers in the answer
  window (`REPORT_WINDOW_MS`, 24 h / 5 min) stands. Disputing leaves the game on the real board.
  Either player can take it back online when no report is waiting. Games with a bot seat (stand-ins
  too) can't move over the board.
- **Server.** Columns `games.otb_offer_by`, `over_the_board_at` and `report` (migration
  `0012_over_the_board`); `POST /api/games/:gameId/over-the-board` with `{ action }`
  (`overTheBoardAction` in `wars/games.ts`). Moving over the board freezes the clocks (`clocks` as
  they stand, `lastMoveAt` null, no deadline); a report sets `deadline`, so the scheduler and live
  flag timers make an unanswered report stand (`flagIfDue`). Going back online starts the clocks
  again after the live countdown (correspondence: a fresh time per move). Every result reached over
  the board has reason `over-the-board`, which settles the war as usual. An Armageddon tiebreak
  after a draw over the board starts over the board too. Offers, reports, disputes and returns to
  online notify the other player (reports by email in correspondence); the home screen counts an
  offer or a report waiting for the player, and not an over-the-board game as their move.
- **Bots** decline offers, and a bot standing in for a player whose game was over the board takes
  it back online (once any report is answered or stands) and plays on (`runner.ts`).
- **Stats.** Over-the-board games count in results and endings ("Won over the board") but not in
  the average length or openings.
- **Web:** "Play over the board" under the board (the opponent sees the offer with "Play over the
  board" and "Keep playing online"); over the board, "I won", "Draw", "I lost" and "Play online
  instead", or "Confirm" and "Dispute" for a report, with how long until it stands. The player
  strips say "offers a real board" or "reports a win"; Your games says "Over the board?", "Over the
  board" or "Confirm result". The rules guide's battle section has an "Over the board" part, and
  the deadlines table a row.
- **Checked in the browser** (dev server, correspondence): Bo offered after 1. e4 e5, Ann accepted,
  Bo reported a win, Ann confirmed, and Bo took Azerbaijan, "White wins over the board".

Defaults taken while building (not asked; easy to change): a report stands if unanswered (as an
unanswered declaration goes ahead), rather than waiting forever; either player can return the game
online alone, as the way out of a dispute; only games underway (not queued live games) can move.

**Country values 1 to 20** (2026-10-02, at the user's request: a superpower should be worth five
or six median countries, not three). New campaigns play dataset `2026.2` and mission rules
version 4; campaigns already created keep `2026.1` (values 1 to 10) and their version. The
simulator's case is in the balance report's
[A 1–20 value curve](balance-report.md#a-120-value-curve).

- **Data.** `config/values.yaml` ranks the same scores against a 1–20 distribution: China and the
  United States 20, India 18, Russia 17, Brazil and Indonesia 16, Japan, Germany and Canada 15
  (Germany by override, with Japan), and so on down; values 1–3 barely move. The map is worth 928
  instead of 718. The pipeline takes values up to `MAX_VALUE` (20). `2026.2` was built from
  `2026.1`'s statistics with the new curve (the World Bank isn't reachable from the cloud
  container), so `pnpm data:build` with the cached downloads should rebuild it unchanged.
- **Rules.** `DATASET_VALUE_SCALES` (`dataset.ts`): 1 for `2026.1`, 1.29 for `2026.2`.
  `MISSION_RULES_V4` carries `valueScale: 1.29`: Expansion +22, Regional Power 26–71, Two Theater
  10, Measured Expansion 26 (21 to reveal), Strategic Positions targets worth 3–15, Hidden Triangle
  2–12, Great Powers counts countries worth 13 or more, and target fit scaled the same way. A data
  test checks that the latest dataset's scale matches the current version's. Rules stored without
  a mission version now read as version 3 (they're on `2026.1`); `DEFAULT_RULES` names version 4.
- **Bots.** Knobs counted in value (`vpValue`, the declaring thresholds, `betrayMargin`,
  `draftNoise` and a new `tokenValue`, the worth of a war token, formerly fixed at 1) are written
  for 1–10 and scaled by the campaign's dataset (`knobsFor`): live bots look it up per campaign,
  the simulator per run.
- **Simulator.** `baseline` plays the latest dataset; `values-10` plays `2026.1` with mission rules
  3, as campaigns created before. Records note the dataset, the countries drafted and every
  country that changed hands. The parity test replays `values-10` campaigns on a `2026.1` server.
- **Web.** The rules guide says 1 to 20 (1 to 10 for a campaign on `2026.1`, from its
  `datasetVersion`), and its stake table shows targets 1–6, 8, 10, 12, 15 and 20.

**Transatlantic sea lanes** (2026-10-03, at the user's request). Dataset `2026.3` is `2026.2` plus
two manual lanes in `config/sea-lanes.yaml`: Brazil–Liberia (Natal–Monrovia, 3,026 km) and
Argentina–South Africa (Buenos Aires–Cape Town, 6,703 km), with `near` points so they aren't drawn
from Fernando de Noronha or the Prince Edward Islands. Values, land borders and the map are
unchanged; `DATASET_VALUE_SCALES` gives it 1.29 like `2026.2`, so it pairs with mission rules
version 4. New campaigns get it; campaigns already on `2026.2` keep their map. (`2026.2/REPORT.md`
still shows the 1–10 values in its territory table; `2026.3`'s report has the right ones.)

Tests: rules `over-the-board.test.ts`, server `test/over-the-board.test.ts`.

**Compare empires** (GitHub issue #12, 2026-10-02: "a statistics page that compares all empires
with beautiful charts"). `/c/[id]/compare` opens over the map room like an empire page. It needs
nothing new from the server: it draws `GET …/stats` (every empire's record already) and the
campaign view.

- **Leaders**: tiles for the most victory points, value, people, economy, land, military spending,
  wars won, chess score (level scores go to whoever played more) and reputation; players level
  share a tile.
- **The race**: the empire page's `HistoryChart` with `userId={null}`, so every empire's line is
  in its color until one is picked from the readout, which quiets the rest.
- **Shares of the world**: a bar per measure (value, countries and the six real-world figures)
  split between the empires in their colors and hatching, the rest of the map unclaimed in olive.
  Picking an empire from the key or a bar reads its figures out beside every bar.
- **Wars and chess**: a row per empire, won in its color, drawn grey and lost as an outline, the
  bar's length the number fought or played; the figure is won–drawn–lost for wars and the score
  for chess. **Diplomacy**: reputation as bars either side of where everyone started (100), with
  accords in words. **By the numbers**: every figure in a sortable table.
- Empires are in standings order (points, then value) in every chart. The logic is in
  `lib/compare.ts`, with tests.
- **Ways in**: "Compare" beside the standings' Empires heading, "Compare empires" in the Empire
  tab, and "Compare all" in an empire page's Other empires row.
- **Checked in the browser** (dev server, desktop and phone): Field Marshal's "Compare Check"
  (Field Marshal and six bots, eight rounds of bot wars).

Tests since: web 65.

**Raising back and forth** (2026-10-03, at the user's request: "allow opponents to reraise back and
forth"; the user chose "raising accepts the war", a cap of three raises, and that a war won
without chess counts for no mission).

- **The setting.** `rules.war.raises` (1 to `MAX_RAISES`, 5): how many times a war's stakes can be
  raised, the defender's first raise included, with a matched raise only. Absent reads as 1, the
  original single raise, so stored campaigns (production's included) keep their game;
  `REVISED_WAR_RULES` gives new campaigns 3. The lobby shows "Raises in one war" under Matched.
- **The rules** (`war.ts`, "Raising back and forth"). Each raise is how far you go over what you
  were asked for, and the other side must match it. The attacker raises again by staking at least
  half the target more than the raise demands (`attackerRaiseRange`); what they stake over it, up
  to the target's value and never more than the defender's most valuable free country, is what the
  defender must put in (`attackerRaiseMore`, `owedByDefender`). The defender answers with one
  country: worth at least that to meet it, or enough more (half the target to all of it, within
  what the attacker could still add) to raise again (`defenderAnswerOptions`). Overshoot on a meet
  is lost, as before. Once the last raise is made, the other side can only meet it or back down.
- **Raising accepts the war.** The attacker facing the first raise can still withdraw as before
  (the token is spent). Anyone who has raised and then backs down loses the war as declared,
  without a game: the defender yields the target and keeps the countries they put in (outcome
  `yielded`); the attacker forfeits the stake as declared (`counter.declared`) and keeps what they
  added since (`forfeited`). Silence after raising is backing down. A truce follows, as after a
  battle.
- **State.** All of it is in the war's `counter` JSON: `steps` (each raise and answer after the
  first, `RaiseStep`) and `declared`. `raiseAnswerer` and `waitingOn` say who answers;
  `addedCountries` lists every country put in, tied up from the raise on and won with the target.
  `ActiveWar.added` is now a list, and a raise's country is tied up through `added` rather than
  `offered`. No migration: the new outcomes are only TypeScript enum values on a text column.
- **Server.** `POST …/wars/:warId/reply` is answered by whoever `waitingOn` names: the attacker
  with `stake`, the defender with `territoryId`, `raise` to raise again. `war.reply` events carry
  `by: 'defender'`, `territoryId` and `more`. Reserves meet any raise of the defender's at once,
  never by raising. "Answer needed" counts and the bots' sweep use `owingAnswer` (SQL on the last
  step). Notices: "Ann raised again", "Bo raised again".
- **Missions.** Wars won because the other side backed down count for no battle mission:
  `yielded` and `forfeited` aren't `attacker`/`defender`, and Nemesis and Backstab skip them
  (`battles()` in `evaluate.ts`). Their wording now says backing down doesn't count. Claim
  blockers count backing down and the countries the defender may still put in.
- **Records.** The war record has "Won when they backed down" and "Backed down" rows
  (`opponentBackedDown`, `backedDown`); the compare page counts them with "other".
- **Simulator.** Mirrors all of it; the standard bot weighs meeting, raising again (given how the
  other side would answer) and backing down. `whatif:single-raise` plays the old rule against the
  baseline, `whatif:raise-five` allows five. The report's war table has "Raised again" and "Backed
  down" columns. The parity test's baseline cases now raise back and forth.
- **Web.** The war panel lists the raises, the attacker's answer has "Meet the raise" (was "Raise
  the stake"), "Raise again" and "Back down" once they have raised; the defender answering a raise
  gets "Meet the raise", "Raise again" and "Back down". The rules guide has "Raising back and
  forth" and the new deadline rows. Checked in the browser on a dev campaign (Ann and Bo, "Raise
  Check"): Ann raised again, Bo raised again, and Ann's answer offered only meeting or backing down.
- **Balance** (a first look: live, 150 seeds at 2, 4 and 6 players, against
  `whatif:single-raise` seed for seed). Defenders raise about as often (18–20% of declarations,
  from 20–21%), and the bots raise again after nearly every first raise (19–20% of declarations).
  Hardly anyone backs down after raising (under 1%), and fewer attackers withdraw (1–2%, from
  3–4%). Wars get bigger: value taken per attacker win 17.3 / 16.0 / 14.9, from 16.2 / 14.5 /
  13.8. Campaigns end a little sooner: median win round 13 / 10 / 8, from 13 / 12 / 9, and at 4
  players 27% are won in rounds 15–25, from 40%. The bots' answers are one step deep, so the
  playtest should say whether people raise back as readily. To rerun:
  `pnpm sim --scenario baseline,whatif:single-raise --players 2-8 --seeds 300`.

Tests since: rules 306, web 66, sim 27, server 219 (`war-raises.test.ts` in rules; "raising back and forth" in
`test/war-answers.test.ts`).

**Higher stakes** (2026-10-04, at the user's request: attacking "should be a bit more painful
since there is no easy way out of a war that has been declared", and fortifying should matter).
`REVISED_WAR_RULES` now gives new campaigns `stakeFloorPct: 110` (from 80) and `raisePct: 150`
(from 125, which with a matched raise only fortifying uses). The schema defaults stay 80 and 125,
so stored campaigns (production's included) keep their stakes. Nothing else changed: the rules
guide, the stake table and the lobby read the numbers from the rules, and the lobby already offers
110 and 150. In the lobby, changing the least stake moves the raised stake by as much
(`withStakeFloor` in `config.ts`), so fortifying keeps the gap the host had: 80% gives 120%, 125%
gives 165%. Server tests whose small maps were sized for 80% play `ORIGINAL_STAKES`
(`test/helpers.ts`), which `ORIGINAL_ANSWERS` now includes. The simulator's baseline plays the new
stakes; `whatif:original-stakes` plays the old. Findings in
[balance-report.md](balance-report.md#higher-stakes): a war goes from +2.0 to about +0.5 country
value per declaration for the attacker, the bots declare 3–6% less, and game length and missions
don't move. The playtest should say whether people declare much less than the bots.

**Titles, mission rules version 5** (2026-10-05, at the user's request after the simulator runs in
[balance-report.md](balance-report.md#titles)). New campaigns play version 5: version 4's missions
plus four titles worth a point each, with 10 points to win (from 7). Stored campaigns keep their
version, so production's campaigns have no titles.

- **The rule** (`packages/rules/src/victory/titles.ts`): Largest Population, Largest Territory,
  Largest Economy (nominal GDP) and Greatest Military Might go to whoever leads the table on that
  figure when round 1 starts (the first `settleVictory` of the war), and move the moment someone
  passes the holder, points and all: no claim, no holding time, so taking one can win on the spot.
  A holder who is only matched keeps it; a lead shared by players who don't hold it goes to nobody
  (`nextHolder`). Unknown figures count as zero.
- **Military might** (`militaryMight`): each country's share of the world's military spending and
  of its armed forces, both by their square roots, averaged, in whole millionths of the world (so
  sums are exact and the server and simulator agree to the unit); shown per thousand (USA 56.0,
  China 41, India 31, Russia 29). The user chose it over spending (the USA held that title 92% of
  the time) and over the plain or mixed blends.
- **Server.** `campaigns.titles` (migration `0013_titles`) holds who has each. `settleVictory`
  settles titles first, before missions, logging one public `title.changed` event per move (with
  both players' totals) and notifying both; it then checks the finish line if a title moved even
  when nothing was awarded. `pointsOf(awards, members, campaign)` adds title points everywhere
  points are counted (the view, awards, `endSeason`); `loadHistory` turns `title.changed` into a
  minus and a plus mark, so Kingslayer's "leader at the time" counts titles. The results keep each
  player's titles. Bots see the holders (`LiveCampaign.titles`) and weigh titles a war would win,
  keep or lose (`titleSwing` in the simulator's standard bot).
- **Simulator.** Version 5 plays the catalog's titles through the rules package
  (`engine/titles.ts` keeps the what-ifs' other figures); the parity test passes. `whatif:no-titles`
  plays version 4's scoring. Scripted sim tests and the server's mission tests pin version 4 so
  missions alone score; titles have their own tests.
- **Web.** The tokens (art in `media/titles/`, rendered to `apps/web/public/titles/` by
  `pnpm --filter @empire/web titles`) sit after every player's name in a campaign: `PlayerName`
  reads the holders from `TitlesProvider` (`components/victory/title-tokens.tsx`), overlapping like
  a stack of coins at small sizes. The Missions tab has a Titles section (holder, figure, yours);
  dispatches and toasts say when a title moves; the rules guide has a Titles part; the race uses
  thinner marks for 10 points so names fit.

**Award ceremonies** (2026-10-05, at the user's request: points from a mission or a title "should
be very clear with some form of animation": a title's token going from its holder to the new
holder, and for missions the mission card and the points increasing on the leaderboard; the design
was left to me).

- **The ceremony.** Whenever points move, everyone in the campaign sees a card under the intel
  toasts, top centre of the map room (`AwardCeremonies` in `components/victory/award-ceremony.tsx`,
  in the same stack as the toast). It holds a leaderboard of every player (points, and the titles
  they hold in fixed slots) and plays the change out on it:
  - **Titles.** The token lifts off its old holder's row, turns over twice along an arc and lands
    on the new holder's row in a ring of sparks; both totals change as it lands (amber +1, grease
    red −1), then the rows re-sort. A title coming from nobody (round 1, or after a shared lead)
    starts from its emblem in the card's heading, and one going to nobody flies back to it and
    fades. The titles of one change move together, staggered ("Titles awarded" at round 1).
  - **Missions.** The mission card is dealt onto the table, a "Scored" rubber stamp comes down on
    it, and its points fly off its badge as a chip into the player's row, which counts up.
  - About 4½ seconds each (more for several titles); a tap or ✕ dismisses it. It replaces the
    toasts for points ("+2 victory points", "Largest Population: +1", "… lost"). Screen readers
    hear one sentence per ceremony.
- **From events.** `lib/ceremony.ts` (pure, with tests) turns each `campaign.events` push into
  ceremonies: the titles of one change together (the server settles titles first), then each
  `mission.awarded`, with everyone's standing before and after, from the events' own totals.
  Pushes can outrun the refetch of the change before, so the queue keeps the standings the events
  lead to until the campaign view catches up (by event id). A secret completed in the same change
  is shown from its `mission.revealed`; otherwise only missions the viewer may already see
  (`findMission`), so nothing private shows early. Anything new that moves points must log an event
  the ceremonies understand.
- **Waiting.** One at a time, at most four waiting (older ones give way). They wait while the viewer
  has a live game underway, since the clock may be running, and while the page is hidden; then they
  play. Events missed while disconnected aren't replayed.
- **The leaderboards themselves** (`components/victory/score-effects.tsx`). `PointsCounter` counts
  a total to its new value a point at a time, popping, with the change floating up beside it: in the
  war room's standings, the race and the ceremony. The race's marks fill in one after another, or
  drain red for a lost title. The standings and the race slide rows into their new places when
  someone overtakes (`useReorderSlide`). These react as soon as the campaign view refetches, a
  moment before the ceremony's points land.
- **Afterwards.** Scored missions in the Missions tab carry a "Scored" stamp (`ScoredStamp`, through
  `MissionCard`'s `stamp`): the viewer's public missions and secret, revealed secrets that scored,
  completed secrets in the results. A token beside a player's name pops in with a glint when they
  have just won it. Both make their entrance once, from marks the ceremony sets as it queues
  (`markFresh`: 3 minutes for a stamp, 20 seconds for a token), not every time they're drawn.
- **Reduced motion.** The card shows the outcome at once (rows tinted, the change beside each
  total), nothing flies, and it goes after 4½ seconds; the global rule cuts the CSS animations.
- **Checked in the browser** (dev server; Chromium at desktop and phone sizes, driven by scripts):
  Ann and four bots, where round 1's titles were handed out and titles moved as the bots fought, and
  mission ceremonies were injected into the page's WebSocket; and a campaign hosted by Field
  Marshal with Ann's empire handed to a level 7 bot, where Ann saw "You take it from …" three times
  and a real award, "You scored Campaign Veteran", stamped on her card in the Missions tab.
  Reduced motion and a title lost to a shared lead were checked by injection.

Tests since: web 83 (`lib/ceremony.test.ts`). On a 4-core cloud container, one data test and two
simulator tests take just over vitest's 5-second limit and time out; with `--testTimeout=30000`
everything passes (rules 314, data 68, web 83, sim 29, server 220).

Defaults taken (not asked; easy to change): the timings; every player sees every ceremony, not only
the two involved; a tap dismisses; ceremonies wait out live games; on a public mission's card the
stamp marks the viewer's own score. One thing noticed and left alone: in the desktop column, a
player with "you", a bot tag and four tokens has no room left for their name in the race.

**Claims held through a round's turns** (2026-10-05, at the user's request: "rounds instead of a
clock", making sure everyone has had a chance to pass). New campaigns hold claims by turns instead
of a holding time: a claim from round R scores from round R+2, once declaring has run to its end
in a round after R (everyone passed, ran out of time, or had nothing to do: `nextTurn` already
passes over players without tokens or targets). A host who starts the next round before declaring
is over doesn't cut the answer short: the claim waits for a round whose turns run their course,
and scores in the change that ends them.

- **Rules.** `rules.victory.hold` (`CLAIM_HOLDS`: `time` | `turns`), absent meaning `time`, so
  stored campaigns (production's included) keep their clock; `DEFAULT_RULES` has `turns`.
  `holdsByTurns(rules)` is true only with `rules.war.turns` too: without turns there's no end of
  declaring to wait for, so the time applies. `claimTurnsServed` / `claimTurnsHeld` in
  `victory/claims.ts`.
- **Server.** `campaigns.turns_ended_round` (migration `0014_turns_ended_round`), set by
  `giveNextTurn` when declaring ends. `settleVictory` uses it in place of `eligibleAt`, which stays
  null (so the claim scheduler never looks). `ClaimView.turnsHeld` and `VictoryView.hold` tell the
  client.
- **Simulator.** Mirrors it (`SimState.turnsEndedRound`) and now plays `hold: 'turns'`. It always
  plays every turn before the next round, so awards land in the same rounds as before; the parity
  test passes unchanged and the balance report still holds.
- **Web.** The lobby offers "A round of turns" or "A holding time" when turns are on, and the
  holding-time picker only where the time applies; claim cards say whose turns they wait for; the
  rules guide, scoring notes and settings list describe whichever rule the campaign plays.

**Arsenals and energy** (GitHub issue #32, 2026-10-05: "without affecting gameplay the stats pages
should show standing army size, number of tanks, naval ships, fighter jet, oil production, natural
gas production and energy production"). Seven figures beside the dataset's own, in a table no rule
reads, so no game can change.

- **The table.** `packages/data/facts/facts.json` (`FactTable`, `FACT_KEYS` and `factOf` in
  `packages/rules/src/facts.ts`), built by `pnpm data:facts` (`scripts/facts.ts`, names in
  `config/facts.yaml`, review in `facts/REPORT.md`). It is not part of a dataset version: territory
  ids and members are the same in every version, so one table serves every campaign, old ones too,
  and nothing pins it. Each territory sums its canon statistics codes, like the dataset's figures.
- **Arsenals: Global Firepower 2025**, read from a third-party scrape on GitHub
  (`nupurmadaan04/unified-military-analytics`, pinned to a commit), the user's choice: the
  container's network policy blocks globalfirepower.com and Wikipedia, and Global Firepower isn't
  openly licensed. 145 countries; the other 43 territories show —. **Standing army** is Global
  Firepower's active personnel (2025), shown beside the dataset's **Armed forces** (World Bank,
  2020, paramilitaries included), which the military-might title keeps using. **Combat aircraft**
  adds Global Firepower's fighters and attack aircraft: it files the F-35 under attack, which left
  Norway and the Netherlands with no fighters. **Naval ships** is its total naval assets, patrol
  craft included.
- **Energy: Our World in Data** (CC BY 4.0; the GitHub energy file, pinned): oil and gas
  production (Energy Institute to 2024 for the big producers, The Shift Project to 2016 for the
  rest) and electricity generation (Ember, mostly 2024–25), all in terawatt-hours a year. "Energy
  production" is electricity: Our World in Data has no total of primary energy produced.
- **Web.** `/facts/facts.json` (copied by `copy-datasets.mjs`, read once a visit with `useFacts`).
  A country's panel lists the seven under "Arsenal and energy" (source and year on hover); an
  empire page's real-world totals add them with the same share, world rank and empire rank; the
  comparison page adds an "Arsenals and energy" section of share bars. `lib/empire.ts` and
  `lib/compare.ts` take the table for the new keys (`FigureKey`), with tests.

Tests since: data 72, web 88.

**Victory and defeat, and the results page** (2026-10-05, at the user's request: "animations for
victory and defeat, followed by a post game score screen with victory points and some
statistics"; the design was left to me).

- **The ending** (`Finale` in `components/victory/finale.tsx`). When a campaign is won, every
  player sees its ending once, full screen over the map room, then the results page:
  - **Victory:** the room dims and warms, a sunburst turns behind the emblem, and "Victory" comes
    down as a huge worn rubber stamp in signal amber. As it lands the table jolts, ink spreads in a
    ring and ticker tape fires from both bottom corners and rains down, in amber, map-room white,
    gold and the winners' colors. Then the winners with their points counting up, how it was won,
    and "See the results".
  - **Defeat:** the room's colors drain to grey as its light flickers, ash falls and embers rise,
    and "Defeat" comes down in grease red. The winners are the only color left on screen; under
    them, how it was won and where the player finished ("You finished joint 2nd with 8 victory
    points.").
  - A shared victory says who it's shared with; a season ended on points says so, with the
    tiebreak if one decided it. Words come from `finaleText` (`lib/results.ts`).
  - **When.** Once the campaign is over and the player hasn't seen it end in this browser
    (`finaleSeen`, localStorage, with a memory fallback): live when the `campaign.won` push
    arrives, or on opening a campaign that ended while they were away. It waits for the award
    ceremonies of the change that won it (`AwardCeremonies`'s `onBusy`), a live game, and the page
    being in front of them (`usePageVisible`). It moves on by itself after about 8 seconds on
    screen (hidden time doesn't count), or at a tap, Escape, "Skip" or "See the results", and goes
    to the results page. "Watch the ending again" there replays it. The campaign screen is `inert`
    while it plays; the "Victory" toast is gone.
  - **Timing.** The stamp's landing (jolt, ink, ticker tape) and the points counting up follow the
    CSS animations' `animationend`, not timers, so they stay in step however the browser paces
    frames. Particles are one canvas (`components/victory/particles.ts`), running only while
    something is in the air.
  - **Reduced motion:** the whole composition at once, no slam, shake, particles or counting, and
    it holds for 6 seconds.
- **The results page** (`/c/[id]/results`, `components/victory/results-screen.tsx`), a page over
  the map room like the comparison page. Reached from the ending, a "Results" call to action in the
  campaign header once it's over, "See the results" in the Missions tab, the phone map footer, and
  the ending's notification (now `/c/:id/results`, `resultsUrl` in `victory/settle.ts`). While the
  ending is still to play, the page waits behind it, then comes in as it goes:
  - **Header:** who won and how, where the viewer finished, and a "Victory" or "Defeat" stamp.
  - **Podium:** the top three on blocks in their colors and hatching, rising third, second, first,
    the winner under the emblem, points counting up. Players level share a place (`placesOf`: on
    points, and at a season's end on the tiebreak too).
  - **Final standings:** everyone with a bar to the points to win, split into public missions,
    the secret mission and titles held at the end (`breakdownOf`); a row opens to the missions
    scored (with rounds), titles and the secret mission, revealed.
  - **The race:** the history chart on its new **Points** measure: every empire's victory points
    at the end of each round, the points to win marked, the lines drawing themselves in. The
    measure is on the empire and comparison pages too (where it isn't the default).
  - **Honors** (`honorsOf`): Conqueror (most countries taken), Warlord (most wars won), Bulwark
    (most attacks repelled, draws included), Spoils of War (most value taken in one war), Grandmaster
    (best chess score, two games or more), Swift Strike (fastest checkmate; a quick resignation is
    more likely a war given up), Marathon (longest game), Warmonger (most wars declared), Diplomat
    (best reputation, when they differ) and Oathbreaker (most accords broken). Only those someone
    earned; players level share one. Each is a medal on a ribbon in the holder's color.
  - **The campaign in numbers** (`campaignTotals`): rounds, wars declared, countries that changed
    hands, games, checkmates, moves, accords signed and broken, counting up.
- **Victory points by round.** `HistoryPoint.victoryPoints` (stats endpoint): the stats service
  now reads `mission.awarded` and `title.changed` events as `PointsChange`s, and `empireHistory`
  adds them up by round, titles taken away included. Optional in the type, since the web and the
  server deploy separately: without it the chart doesn't offer Points.
- **Checked in the browser** (dev server on a scratch database; Chromium, desktop and phone): a
  season Field Marshal won on titles, one a bot won after six rounds of bot wars (Field Marshal's
  defeat), the ending arriving live while the map room was open, an injected pair of title
  ceremonies holding the ending back until both had played, a replay, and reduced motion.

Tests since: rules 318, data 72, web 103 (`lib/results.test.ts`), sim 29, server 223 (745 in all;
victory points by round in rules' `stats.test.ts` and the server's `stats.test.ts` and
`victory-flow.test.ts`).

Defaults taken (not asked; easy to change): the ending plays once per browser rather than once per
player across devices (no server state); about 8 seconds before it moves on by itself; a tap
anywhere moves on; the honors and their names; the stats a results page leads with.

**GitHub issues #37, #41 and #42** (2026-10-05).

- **#37, the war on the map.** The war open beside the map (its details, or the board of a game in
  it) is called out: the attacker's stake outlined in amber dashes, as a stake being built is, the
  target and any countries raises put in outlined and filled in grease red, and its arrow drawn
  strong. On desktop the map frames all of them when the war or its game opens (it used to fly to
  the target alone), and a link that opens one (a "your move" notification) frames it instead of
  the player's empire: a zoom asked for before the map is measured is now its first frame
  (`WorldMap`'s `war` prop, `MapWarFocus`; `mapWarFocus` in the campaign screen).
- **Mission rules version 6** (new campaigns; version 5 is otherwise unchanged and stored campaigns
  keep theirs). **#41:** Nemesis is dealt only from three players (`nemesis.minPlayers`): with
  two, the rival it marks is the only one there is. The rules guide tags it "three players or
  more". **#42:** Nordic counts Iceland, three of the five (Norway, Sweden, Finland, Denmark and
  Iceland). Iceland's only lanes run to Greenland and the United Kingdom, so the set no longer
  hangs together; rather than add a Norway–Iceland lane (a new dataset version, and a new front),
  named sets are now dealt where enough of their countries to finish them hang together, which
  changes nothing for the sets of versions 1 to 5 on any dataset.
- The data test that sampled who is dealt the Northern Passage now checks candidates: it was dealt
  in 3 of 160 hands under version 5 and 2 under version 6 (Nordic, with Iceland, is dealt more), so
  eight drafts had only found one by luck.
- **Checked in the browser** (a production build on a scratch database, against a bot; desktop and
  phone): a war's game and its details with France and Germany called out and framed, the board's
  "War details" link, and a fresh load of a game link.

Tests since: rules 319, data 73, web 103, sim 29, server 223 (747 in all).

**The landing page** (2026-10-06, at the user's request: the home page asked visitors to sign in
or read the whole rulebook before it showed them the game).

- **Home and campaigns apart** (the user's follow-up: signed in, there was no way back to the
  landing page). `/` is the landing page for everyone, prerendered as static HTML; the dashboard
  moved unchanged to `/campaigns` (`campaigns-screen.tsx`). The header's emblem goes home; signed
  in, its **Campaigns** button goes to `/campaigns`, which is also where signing in leads without a
  `next` (`safeNext`), where the installed app opens (`manifest.ts`), and where "All campaigns",
  leaving or deleting a campaign, the 404 page and a notification without a link go. On a phone the
  signed-in header drops the wordmark (and under 360 pixels the Rules link) to fit.
- **A malformed `#fragment`** (`/rules#%E0%A4`) no longer breaks the rules pages: `useScrollToHash`
  decoded it unguarded, and the `URIError` replaced the page. Codex's review of PR #44 found it on
  the landing page, which no longer needs the hook.
- **What a visitor sees** (`components/landing/`): the emblem and the pitch, **Start a campaign**
  (`/login?next=/new`, so the usual sign-in goes straight on to the new campaign form; `/new` for a
  player), **See a sample campaign** (an anchor to `#sample`; since 2026-10-07 also **Try the
  tutorial**, see the guest tutorial below) and "Already
  playing? Sign in" ("Signed in as …" and **Your campaigns** for a player). Then a sample campaign on the real `WorldMap` and chessground `Board`, labelled as
  sample data on the map, on the board's panel and in its caption; three illustrated steps (draft,
  battle, missions and titles); the battle for Italy worked through (the stake, what each side
  wins, what a draw does); live play, correspondence and bots; the rules in five lines; and links
  to `/rules`. Every number comes from `DEFAULT_RULES` and the rules package's constants, as in the
  guide, and nothing says how long a campaign lasts.
- **The sample** (`lib/sample-campaign.ts`) is a campaign the simulator played on dataset 2026.3,
  as it stood in round 6 the moment Italy's holder accepted France's declaration: every holding,
  and every war underway then. To see it played out:
  `pnpm --filter @empire/sim trace --players 4 --seed 27 --pace correspondence`. Names, colors,
  clocks and the chess position are made up. `sample-campaign.test.ts` checks it against the
  dataset and `DEFAULT_RULES` (a legal declaration, a stake at exactly the floor, the whole map
  held, the chess line reaching its position), so a rule change that breaks the example fails
  there: update the sample or the example's prose then.
- **`WorldMap`'s `still`**: no controls, inert, and nothing on it takes the pointer (`.map-still`), so
  the page scrolls over the sample map with a wheel or a finger. The sample board leaves out its
  coordinates. (On every other board they came out in paper white, unreadable on the light squares:
  chessground puts `orientation-white` on the same element as `.board-theme`, so `globals.css`'s
  `.board-theme .orientation-white …` rules never matched. Fixed with the guest tutorial.)
- **Header**: signed out, every page but sign-in itself offers **Sign in**, coming back to the page
  afterwards (`?next=`). The landing page runs wider than the usual column, and the header with it
  (`AppHeader`'s `wide`).
- **Long text** keeps to about 68 characters a line (`.readable` in `globals.css`, on the rules guide
  and `/rules`), with the stencil headings as they were; `/rules` ends with Start a campaign too.
  The guide no longer takes a heading `level` (only the landing page used it).
- **Checked in the browser** (dev server, Chromium, at 1440, 1024, 820 and 390 pixels wide): no
  sideways scroll; the tab order (header, the calls to action, the rules links, with the sample map
  and board skipped) and its amber focus rings; both anchors, followed and loaded directly; Start a
  campaign through sign-in to `/new`; and the campaign map's controls and zoom. After the split,
  signed in and out: the header from 320 pixels up, the emblem home and the Campaigns button to the
  dashboard, sign-in from `/` landing on `/campaigns`, `/campaigns` sending a visitor to sign in,
  the landing page's links for a player, and a campaign's back arrow to `/campaigns`.

Tests since: rules 319, data 73, web 108, sim 29, server 223 (752 in all).

**Rules quick start and scoring text** (2026-10-06, at the user's request: beginners met too much at
once, and some descriptions still reflected older rules). Text and layout only: no rule, number,
balance or stored campaign changed.

- **Quick start** (`#quick-start`, first on both rules pages): five steps (how to win, the draft,
  declaring one war, the chess game, what changes hands), every number from the page's rules. The
  contents split into "New here?" (the quick start) and "Reference"; each section heading has a
  Contents link back (`#contents`). Winning moved up after "After a war". **Every existing anchor
  is kept** (`#idea` … `#settings`, `#fortifying`, `#raising`, `#peace`; the landing page links
  `/rules#answers`); Winning's parts gained their own (`#points`, `#scoring`, `#public-missions`,
  `#secret-missions`, `#claims`, `#titles`, `#finish`, `#last-round`).
- **Winning, rewritten.** Both routes to victory (reaching `points.toWin` at once, when a mission
  scores or a title moves; or the most points when the host moves on from the last round, then the
  campaign's tiebreak); permanent mission points, pending claims (not points, and not counted at a
  season's end) and transferable title points side by side; what scores at once (records, titles)
  and what waits (positions). The old line "missions make 11 at most, so a winner holds a title or
  two" was wrong (11 is more than 10): `winningMathText` works it out from the version instead.
- **Campaign-specific.** A campaign's page reads its own mission rules version (a note says so
  when it isn't the current one, `missionVersionNote`), tiebreak, hold rule and last round; the
  standard page reads `DEFAULT_RULES`.
- **Deadlines.** The standard page gives both paces wherever they differ (`paceTimeText` and the
  `*TimeText` helpers; the deadlines table has a column per pace, from `deadlineRows`); a
  campaign's page only its own. Before, the attacker's reply, raises, the secret-mission choice
  and the deadlines table quoted correspondence times alone.
- **Elsewhere:** the war panel's last-round notice and end-of-campaign confirmation said "then the
  most valuable empire" for every campaign; they now quote the campaign's tiebreak
  (`seasonEndText`). The lobby's Objectives option said "first to 7" (`objectivesText`). The README
  had pre-revision war defaults (80%, a raise to 125%, tribute), the version 2 default missions,
  time-held claims and "first to 7, points never lost"; `lib/readme.test.ts` now checks its numbers
  against the rules. Two stale code comments (`VICTORY_MODES`, `claims.ts`).
- **Tests:** `components/rules/rules-guide.test.ts` renders the whole guide (`renderToStaticMarkup`)
  for the standard rules, a live campaign, alternate settings, a version 4 campaign and a stored
  open-ended one, and checks anchors, the quick start, both routes, the kinds of points and that
  no contradictory scoring or other pace's deadlines appear. Checked in Chromium at 390 and 1280
  pixels: no sideways scroll, deep links land, no console errors.

Tests since: rules 319, data 73, web 131, sim 29, server 223 (775 in all).

**Pictures in the rules guide** (2026-10-06, at the user's request: the three the rules most needed).
`components/rules/rules-art.tsx`, drawn like the landing page's step pictures, whose pieces
`landing/step-art.tsx` now exports (`Sheet` takes a size; the grease-pencil arrow is `WarArrow`;
the landing page's own pictures render exactly as before). Every number comes from the page's
rules, so a campaign's page draws its own stake, points and holding rule:

- **What changes hands** (Quick start, step 5): one war on five countries, declared, then each
  ending: the attacker takes the target, the defender the whole stake and nothing else, a draw
  (Armageddon where the campaign plays it). The stake is the least the campaign allows against a
  target worth 6, as in "Declaring war".
- **Points and claims** (`#points`): a race to `points.toWin`, slot by slot: mission points scored,
  a title held (version 5 on), a claim waiting, the rest to go.
- **When a claim scores** (`#claims`): rounds 3 to `claimEligibleRound(3)`, the position completed,
  held (through everyone's turns, or for the campaign's holding time) and scoring, beside a record
  or title that counts at once.

The map drawings are hidden from screen readers (their captions say it); the other two are text.
Tests in `rules-guide.test.ts` check each picture's numbers for current, version 4, Armageddon and
open-ended rules. Checked in Chromium at 390 and 1280 pixels.

Tests since: rules 319, data 73, web 137, sim 29, server 223 (781 in all).

**A responsive campaign screen** (2026-10-07, at the user's request: from 1024 pixels the screen
had three columns, 340 and 360 pixels wide, which left the map 324 pixels at 1024, and 224 beside a
game's 460-pixel column). Layout only: no rule changed.

- **Three columns only while the map keeps its room.** `roomLayout()` (`lib/room-layout.ts`, with
  tests) shares out the room under the header. The left column (the lobby, draft or war room, the
  missions, diplomacy) stays open only while the map keeps 600 pixels beside both columns
  (`MAP_MIN`): from 1300 pixels wide while planning. Narrower, it folds into a 64-pixel rail along
  the left edge, a button per section with the column's counts; a button opens its section over
  the map as a drawer, and the button again, ✕ or Escape closes it. Under 1024 pixels
  (`useIsDesktop`) phones and portrait tablets keep their layout: tabs along the bottom, sheets
  over the map, the board over everything, full screen as before.
- **The board comes first in a game.** A game's column is as wide as the board can be with both
  clocks fitting the room's height (`GAME_CHROME`), 420 to 680 pixels, leaving the map at least 360;
  the left column folds first. At 1440 × 900 the board grew from 428 to about 630 pixels; at
  1024 × 768 to about 505, with 421 pixels of map (was 224).
- **Nothing is lost when panels open, close or fold.** The column and the drawer are one element,
  so folding keeps what's in it. Its sections, and the phone's tabs, mount the first time they show
  and stay mounted, hidden, after: a scroll position, a half-filled form or a stake being built
  (the phone's sheet stays under other tabs) survive switching away. A chat box keeps unsent text
  per conversation in memory (`Composer`'s `draftKey`). The map never remounts, and the drawer
  covers it without moving it; framing keeps clear of the drawer (`WorldMap`'s `leftInset`), and
  so do the search and toggles (beside it, wrapping to two rows, or hidden under it when there's no
  room). A hidden Diplo panel marks nothing read (`DiploPanel`'s `active`). Closing the drawer on
  Diplo is leaving Diplo, which drops `?chat=` as before; a game folding the column isn't.
- **What's waiting stays in sight.** The header shows every call to action, not only the most
  pressing: the first filled in amber, the rest outlined, from 768 pixels up ("Your move", "Your
  turn", "Answer needed"); each goes where it names, opening the drawer if need be. The rail keeps
  the column's badges.
- **Keyboard.** A section opened from the rail takes focus (its heading); closing puts focus back on
  the button. If the column folds while it has focus (a game opened from the war room), focus goes
  to the game, whose panel now takes focus and steps through moves with the arrow keys, or to the
  rail. Closing a game puts focus back where it was opened from. Hidden sections, a closed drawer,
  the map under a phone's tab or a game, and everything behind a full-screen map or board are
  `inert`. With reduced motion the drawer appears without sliding.
- **Checked in the browser** (dev server, Chromium, scripted) at 390, 768, 1024, 1280 and 1440
  pixels: the map, a country, the stake builder (and the war room open beside it), missions,
  diplomacy, a game and a full-screen game, on a scratch database's three-player campaign "Layout
  Check" (round 2: Field Marshal to move in a war on Cy, to declare, and to answer Bo's war and
  Cy's accord), plus a lobby and a draft. No sideways scroll and no cut-off or covered control in
  any of them. Scripted checks also followed a message being written, a stake, an open
  conversation and the map's position through the drawer, folds, resizes and phone tabs, focus
  each way, unread messages, and reduced motion.

Defaults taken (not asked; easy to change): the widths above; the rail on the left, with text
labels; the drawer stays open while you pick countries or wars from it, but "Show on map" closes it;
extra calls to action from 768 pixels.

Tests since: rules 319, data 73, web 140, sim 29, server 223 (784 in all).

**The guest tutorial** (2026-10-07, from a GitHub issue: visitors couldn't try the game's loop
before signing in). `/tutorial`, prerendered as static HTML, linked from the landing page's hero
(**Try the tutorial**) and under its sample campaign (**Fight this battle yourself**).

- **What it is.** The landing page's sample campaign (four empires on dataset 2026.3, round 6),
  played from the moment before Ada declares war on Italy, with the visitor as Ada. An intro, five
  steps and a finish: **your empire** (select one of your countries, on the map or from the
  holdings; the mission is shown with its progress), **a target** (the 26 attackable countries
  outlined as the Targets toggle does; any country picked says whether it can be attacked and
  why not, by `checkTarget`; Italy is the one the mission needs; found by name with the
  production `CountrySearch` too), **the stake** (how the war can end, each outcome previewable on
  the map, then the production `StakeBuilder` at the floor, France and Andorra for 14; "Declare
  war"; Cleo accepts), **the battle** (a mate in two on the production `Board`, `PlayerStrip` and
  `TypedMove`: Cleo's one legal reply comes by itself, another legal move is taken back with a word
  on why, two hints, and **Skip the battle**, which says first what skipping does and then plays
  the win), and **what changed** (the map before the war, then after it, with a toggle; Italy
  moving from Cleo to Ada; both empires' countries and value; the mission complete, a claim
  staked, scoring in round 8). The finish offers **Start your own campaign** (`/login?next=/new`,
  or `/new` signed in), playing again, the rules and the home page.
- **Labelled sample throughout**: the header (`TUTORIAL` and a Sample stamp, which narrow phones
  drop), the map's caption, the intro's notice and the battle's "Sample war game".
- **Nothing leaves the browser.** No account, campaign, message, rating or notification is made,
  and the only request is the usual `GET /api/me`. The campaign is a `CampaignView` built locally
  (`tutorialCampaign()` in `lib/tutorial.ts`) and read through the campaign screen's own
  `buildModel()`, so targets, stakes, clock modifiers, outcomes (`warTransfers`, `afterGame`) and
  mission progress (`evaluateMission`) all come from the rules package; there is no second engine.
  The place reached is kept in this tab's session storage (`geochess.tutorial`), read back through
  `restoreTutorial()`, which starts afresh from anything the rules couldn't have reached (a stake
  under the floor, moves off the winning line, a later step without the earlier ones done). A new
  tab starts at the intro; blocked storage only loses the place on a reload.
- **The scenario, checked** by `lib/tutorial.test.ts` (17 tests): the whole map held, Ada's turn
  with a war token, Italy legal and other countries refused for the right reasons, the starting
  stake at exactly the floor, each outcome's transfers, a mission the generator could deal under
  the current mission rules (Strategic Positions on Germany, Egypt, Spain, Italy and Türkiye: five
  positions worth 3 to 15 within four steps of Italy, at least two apart, over four subregions,
  three to hold with one won since the draft; Ada holds Germany and Spain), and the chess: from
  `2r3k1/1b3ppp/p7/4p3/4P3/Pq2BN1P/1P1R1PP1/3R2K1 w - - 0 27` a search proves 27. Rd8+ is the only
  mate in two, 27… Rxd8 the only reply and 28. Rxd8# the only mate. The tutorial has no history, so
  the mission's baseline (holdings when the draft ended) is the prepared map. **A rule change that
  breaks the tutorial fails there**: update the scenario or its prose then.
- **Layout.** Phones and portrait tablets: the map on top (hidden for the battle), the step below
  with its buttons along the bottom. From 1024 pixels the step is a column beside the map, and in
  the battle the board gets a column of its own, as big as the height allows, with the rest beside
  it. Each step frames its part of the map; focus goes to the step's heading as it opens.
- **Reuse.** `EmpirePanel`'s body is now `EmpireSummary` (the tutorial has no statistics pages to
  link to), and `game-panel.tsx` exports `PlayerStrip` and `TypedMove`. The board coordinates now
  read on both colors of square, the right way up and flipped (`globals.css`).
- **Checked in the browser** (dev server, Chromium, scripted): the whole signed-out journey at
  1280 × 800 by mouse and at 390 × 844 by touch (tapping countries on the map, moves on the board),
  a wrong move, a refused typed move, hints, the scripted reply, reloads at the stake and mid-battle,
  the result's change, and **Start your own campaign** through dev sign-in to `/new`, with no
  request but `GET /api/me` before signing in and no console errors; at 1024 × 768 by keyboard
  alone with reduced motion (typed moves, the losing preview, the before and after toggle);
  Skip the battle; Start over (cancelled and confirmed); Exit and back in the same tab (resumes), a
  new tab (starts afresh) and blocked storage; and every step at 320 × 640, 844 × 390, 768 × 1024
  and 1440 × 900 with no sideways overflow.

Defaults taken (not asked; easy to change): the tutorial reuses the landing page's sample rather
than a smaller made-up world; Strategic Positions as its mission; session storage (a tab's life)
rather than local storage; Start over asks first; going back is allowed until war is declared;
skipping always wins; Cleo always accepts.

Tests since: rules 319, data 73, web 157, sim 29, server 223 (801 in all).

### Victory defaults taken while building (not asked; easy to change)

- **Generation.** Public targets: a subregion of 5–12 countries worth 20–55 that isn't a whole
  continent (Regional Power); five positions worth 3–8 within four steps of a random hub, two
  apart, over two subregions (Strategic Positions); endpoints in different subregions (The Great
  Connection, see below); targets of different missions don't overlap. Secrets: each
  needs 2–7 conquests (targets and the countries in the way, a greedy estimate), the nearest
  target within 3; fit is closeness to 4 conquests, less for countries in the way, rivals past
  two and target value past 16, plus a little seeded jitter. Dealing draws with the player's
  private seed (`MissionRules.variety`): a kind per family from those that fit, each kind's
  instance from its three best fits; the three are then ranked by fit (rank 1 is assigned at the
  deadline). Drawing the best fits alone let rivals work out a player's options from the map.
- **Two Fronts, Great Powers, Across the Seas, Consolidation** count "new" as held now and not in
  the baseline. Consolidation with a scattered draft needs the join between drafted pieces to
  need at least two new countries: parallel links, and a country touching several pieces, count
  once.
- **Unification** marks the most valuable country of two drafted pieces that need at least two
  conquests to join; **Encirclement** routes can't pass through the center.
- **Notices.** Reveals and claims go to every member, awards and lost claims to the player, the
  result to everyone; tags dedupe per claim and per mission.
- **Mission rules versions.** The lobby can't pick one: a campaign plays the version it was
  created with (version 2 since 2026-09-29).
- **The Great Connection** (the user's call, 2026-09-28): the endpoints have six to ten countries
  between them on the shortest chain, by land or sea lane as the mission counts it, and the chain
  must be as short without crossing the edge of the map (`crossesMapEdge`: Russia to the United
  States over the Bering Strait, and the date-line lanes to Polynesia). It used to be four to six
  steps, and hubs like Russia made pairs look random: Finland and Haiti were three countries apart
  through Russia, Alaska and the Bahamas. Changed in version 1 rather than a new version: the
  numbers only pick targets in the lobby, and campaigns past it keep the targets they stored.

## Phase 2 decisions (settled with the user on 2026-09-27)

Numbers quoted come from simulating 30 full contiguous drafts per player count on `2026.1`.

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pace          | A campaign setting: live or correspondence for every war. Time controls are stored per game, so a per-war choice can come later.                                                                                                                                                                                                                                 |
| Rounds        | Advance only when the host presses "Next round". No round timers. Rounds refill tokens and count down locks and truces; response windows and move deadlines are in hours.                                                                                                                                                                                        |
| Tokens        | 1 per round. Unused tokens carry over up to 3; tribute can take a player past 3. Declaring costs 1.                                                                                                                                                                                                                                                              |
| Unclaimed     | "End draft" auto-drafts the rest (draft lists first, then the most valuable), so the map is always full. No annexing.                                                                                                                                                                                                                                            |
| Stake         | The launching country plus connected countries of the attacker's, worth at least 80% of the target (rounded up). No upper cap. Raise demands at least 125% (rounded up). With the strict 80–125% window only 44–51% of bordering enemy countries were attackable; this gives 85–91%. New campaigns since 2026-10-04: 110%, and 150% against a fortified country. |
| Redirect      | Another defender country of the same value that borders the attacker's empire. The stake stays as declared. The attacker fights for it or withdraws and loses the token.                                                                                                                                                                                         |
| Tribute       | A refusable offer: one unlocked defender country worth less than the target, or any number of tokens. Accepted: war over, truce. Refused: the game goes ahead as declared, with no further responses.                                                                                                                                                            |
| Deadlines     | 24 h (correspondence) or 5 min (live) for the defender; silence accepts the war as declared. The attacker gets the same window to answer a counter; silence means no war (raise or redirect: withdrawn; tribute: accepted).                                                                                                                                      |
| Time controls | Live 5+3; correspondence 1 day per move, and running out loses. Host presets: live 3+2, 5+3, 10+5, 15+10; correspondence 12 h, 1, 2 or 3 days per move.                                                                                                                                                                                                          |
| Draws         | Defender holds. Host option: Armageddon, one more game with colors swapped, Black on 4/5 of White's time and winning on a draw.                                                                                                                                                                                                                                  |
| White         | The attacker. (Phase 6 surprise wars keep "see the starting position early" as their perk.)                                                                                                                                                                                                                                                                      |
| Clock mods    | Defender +10% home turf, +10% if the target has mountains or is an island; attacker +5% per own country bordering the target (launcher included). Net capped at ±25%, given to one side as extra time (initial time and increment live, time per move in correspondence).                                                                                        |
| Locks         | Countries in an active war (target, stake, or offered as a redirect or tribute) are locked: they can't be targeted, staked, paid as tribute or offered. A country acquired by war or tribute can't be staked for 2 rounds.                                                                                                                                       |
| Truces        | 1 round between the two players after a war resolves by a game or accepted tribute (not after a withdrawal).                                                                                                                                                                                                                                                     |
| License       | AGPL-3.0-or-later, confirmed.                                                                                                                                                                                                                                                                                                                                    |

### Defaults taken while building (not asked; easy to change)

- **"N rounds" counts round starts** (the user confirmed this on 2026-09-27 rather than switch to
  full rounds). A country won in round 3 with a 2-round lock can be staked from round 5; a 1-round
  truce set in round 3 ends when round 4 starts. Accords count the same way.
- **Stake floor and raise are host settings** in the schema (`stakeFloorPct`, `raisePct`), not
  shown in the UI. The 24 h / 5 min answer windows are constants (`RESPONSE_WINDOW_MS`).
- **Live games:** a 15-second countdown before White's clock starts; one live game per player at
  a time, later ones queued in order (war status `ready`).
- **Chess rules:** threefold repetition, the fifty-move rule, stalemate and dead positions end the
  game at once (no claims). A flag against a lone king is a draw. Moving declines the opponent's
  draw offer; your own offer stands.
- **Lag compensation:** each live move is credited the player's smoothed WebSocket round trip, up
  to 750 ms; the server waits the same 750 ms past a deadline before flagging.
- **Supply lines** count every attacker country bordering the target by land or sea lane.
- **Tribute options** are listed alphabetically; redirect targets likewise.
- **Notifications:** "Your move" is pushed only for correspondence games; round starts aren't
  notified.
- **Existing campaigns:** rules saved before Phase 2 get the default war settings when read;
  members of campaigns already underway start with 0 tokens until the host starts a round.
  Campaigns whose draft was ended before auto-drafting keep their unclaimed countries, which
  nothing can take.

## Phase 3 decisions (settled with the user on 2026-09-27)

All at the proposed defaults except round counting, which stays as round starts.

| Topic      | Decision                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rounds     | "N rounds" keeps counting round starts, for truces, locks and accords.                                                                                                                                                               |
| Kinds      | One kind: a non-aggression accord between two players, with optional free-text terms shown publicly but not enforced. Alliances wait for Phase 6 champions.                                                                          |
| Length     | Chosen when proposed, in rounds (default 3). Renewed by signing a new one, which replaces the one in force.                                                                                                                          |
| Forming    | One player proposes; the other accepts or declines within the answer window (24 h / 5 min); silence declines. Proposals are private; signed accords are public.                                                                      |
| Wars       | Accords block declarations both ways, like a truce. Wars already underway carry on.                                                                                                                                                  |
| Breaking   | Either partner can renounce at any time: the accord ends at once, everyone is told, the breaker loses reputation and can't declare war on the former partner until the next round starts.                                            |
| Reputation | Starts at 100. Breaking costs 20; every whole round an accord holds gives both players 2 (revised from +5 per accord kept, see below). Shown in standings and on the Diplo tab, with changes in the dispatches. No other effect yet. |
| Chat       | Campaign channel plus one-to-one private messages, text only (up to 1,000 characters), kept for the campaign; authors delete their own, the host removes channel messages. Push for private messages only.                           |
| Feed       | Dispatches and the campaign channel in one timeline with filters (all, wars, accords, chat) in the Diplo tab; private messages and accords beside it; the war room keeps wars and standings.                                         |

### Defaults taken while building Phase 3 (not asked; easy to change)

- **When accords can be signed:** from the draft until the campaign ends, not in the lobby (the
  table isn't final). The draft counts as round 0, so a 3-round accord signed during the draft
  holds until round 3 starts, and a 1-round one ends with the draft.
- **One waiting proposal per pair**, whichever way it goes; the proposer can withdraw it, and may
  propose to the same player at most 4 times an hour (so propose-and-withdraw can't flood them).
  Terms are up to 280 characters. Accord notices carry one tag per pair of players, so the email
  cooldown covers every proposal between them.
- **Renewal replaces at once:** the old accord is marked `renewed` and the new one carries it on,
  so the rounds keep earning.
- **Reputation has no floor**; it can go below zero.
- **Chat limits:** 8 messages per 10 seconds per player; private-message pushes at most once a
  minute per conversation, previewing 140 characters; chat never emails. Deleted messages show
  "Message deleted" or "Removed by the host"; removals aren't logged as events. Unread counts
  ignore messages from players who left the lobby, since their conversations can't be opened.
- **Message ids are global** (one sequence for every campaign), so on a quiet server gaps between
  channel message ids hint at how many private messages were sent, though not by whom. Accepted
  as low impact.
- **Notifications:** a proposal (push, email fallback like a war declaration), signed, declined,
  broken, and "ran its course" (push to both). Lapsed proposals and withdrawals aren't notified.
- **The standings** put each player's country count under their name to make room for reputation.
- **Feed order:** by time, and a message and a dispatch in the same millisecond put the dispatch
  first (the server merges the two lists per page, so paging never skips an item).

### Phase 3 reputation, revised (2026-09-27)

An independent review found two loopholes in "+5 per accord kept": 1-round accords every round
farmed +5 each (and a 1-round accord signed in the draft paid +5 while restricting nothing), and
renewing forfeited the +5, so letting an accord lapse and re-signing paid more. The user chose to
pay by the round instead:

- When round R starts, every accord in force through the whole of round R−1 pays both partners
  `REPUTATION_PER_ROUND` (2). "Whole round" means the partners' unbroken run of accords began
  before round R−1 did: `accordsHeldThrough()` walks back through `renews` links, so a renewal
  carries the accord on, while a lapse followed by a new accord loses the round in between.
- The round an accord is signed in doesn't count, so a 1-round accord never pays; the draft
  (round 0) doesn't count, so nothing is paid when it ends. A 3-round accord earns 4.
- Running its course pays nothing extra; breaking still costs 20 and the round it's broken in
  isn't paid. The payments at one round start are logged as a single `reputation.earned` event.
- Campaigns already underway: accords kept before the change keep their +5; accords in force earn
  by the round from the next round start on.

## Phase 4 decisions (settled with the user on 2026-09-27)

All at the proposed defaults.

| Topic         | Decision                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whose stats   | Every empire's page is public within the campaign, like the map. The Empire tab opens your own.                                                                                                       |
| Where         | A full-screen page per empire (`/c/[id]/empire/[userId]`) with a back link; the Empire tab and column keep the summary, with a "Full statistics" link.                                                |
| History graph | Game value per round for every empire on one chart, the viewed empire emphasized, its wars marked where territory changed hands, and a toggle for country count.                                      |
| War record    | Wins, losses and draws as attacker and defender, tribute paid and taken, withdrawals, accords kept and broken, and the countries won and lost, each linking to its war.                               |
| Chess profile | The campaign's games only: results by colour, how games ended, average length and the most-played openings named from the Lichess openings list (CC0, downloaded with the user's OK). No ratings yet. |
| Updates       | Recomputed from the event log on each request (no stored aggregates); the page refetches when `campaign.events` arrive.                                                                               |

### Defaults taken while building Phase 4 (not asked; easy to change)

- **History is worked backwards** from today's holdings, undoing each `war.resolved` event's
  transfers, so the last point always matches the map, even for campaigns whose log is incomplete
  (test fixtures, early data). Round 0 is the end of the draft; there is no graph before round 1.
- **One point per round end**, not per war: several wars in a round are one step and one marker,
  and the readout lists them.
- **Emphasis, not eight colors**: the viewed empire's line is in its color and rivals are gray
  until picked in the readout. The map colors fail as thin lines on gunmetal (Plum and Cobalt too
  dark, Ice and Sage too close), so each `EmpireColor` has a `line` step for charts: same hue,
  lightened to 3:1 and given chroma 0.10 where needed. Map fills are unchanged.
- **Markers** only for the viewed empire's wars that moved territory (not draws, withdrawals or
  token tributes). The y axis fits the data rather than starting at zero.
- **World rankings** compare the empire's total with every territory in the dataset (bundled
  regions included), and name neighbours in the ranking other than the empire's own countries.
  Totals sum the countries that have a figure, noting how many don't; "est." marks totals that
  include an estimate.
- **The chess profile counts game results**, not war outcomes: a drawn Armageddon is a draw there,
  though the war went to Black. Openings are grouped by family (the name before the colon) per
  colour, top five each; a game is named by the last named position among its first 36 plies (the
  longest named line), matched by position, so transpositions count. Game length is in full moves.
- **Accords in the record** are signed ones only; proposals stay private.
- **Every empire at once**: `GET /api/campaigns/:id/stats` returns all empires (at most 8), so
  switching between them is instant.
- **Reading the chart**: the readout shows the round under the mouse, else the round picked with a
  click, tap or the arrow keys (it stays until another is picked, Escape or "Show now" clears it),
  else now. Screen readers hear picked rounds only.
- **Panels and pages**: links to empire pages keep the address's query, so a panel open underneath
  (a war being answered, a conversation) stays mounted, and "Back to the map" returns to it. A
  panel opened while a page is up (a live game starting) goes back to the map room. The page's
  heading takes focus when it opens.
- **Opening names are remembered** per finished game in server memory (up to 20,000 games).
- The page in the lobby is only reachable by URL; it says empires take shape in the draft.

## What still needs the user

- **Planning the playtest** (Phase 5): who plays, which pace, the rules to start from, and which
  numbers to watch (the plan names country values, the token economy, the stake range, time
  controls and round length).
- **Map canon:** de facto borders per Natural Earth (Crimea with Russia; a one-line flip is in
  `packages/data/config/canon.yaml`), Western Sahara whole, Taiwan and Kosovo separate,
  Somaliland in Somalia, Northern Cyprus in Cyprus, 6 microstate regions, value overrides for
  Germany (15, with Japan) and Western Sahara (2). The friend group should review `REPORT.md`.
- **Web push on real devices** is untested end to end: it needs VAPID keys, a production build
  served over HTTPS, and (on iOS) the app on the home screen.
- **Secret missions still uneven after version 3** (see the report's
  [Version 3, as built](balance-report.md#version-3-as-built)): battle secrets still give their
  holder more than a fair chance, and a few route secrets (Pan-American Highway, Cape to Cairo,
  Encirclement, Unification) are almost never done by the bots, since a chain or a ring can't be
  made shorter. Retire them, redesign them, or wait for the playtest? The slower war tokens the
  report also suggested were left out at the user's request.
- **The revised war answers' defaults** (see the report's
  [War answers, revised](balance-report.md#war-answers-revised)): new campaigns raise `matched`
  (the report's alternative was the token raise); the simulated defenders still raise about a
  quarter of declarations, mostly with countries near the 50% floor. Redirects nearly vanish with
  both `nearby` and a token (0–1% of declarations, from 16–39%). Both are host settings; the
  playtest should say whether the floor needs raising and whether redirects should stay nearby.

## Running and testing

```bash
pnpm dev          # game server :4000 + web :3000 (web proxies /api to the server)
pnpm test         # all packages
pnpm typecheck    # includes `next typegen` for the web app
pnpm build        # server bundle (tsup) + Next production build
pnpm format       # Prettier
```

- **Database.** Embedded PGlite in `apps/server/.data/pglite`, with migrations applied at startup.
  Set `DATABASE_URL` for real Postgres (`docker compose up -d` starts one). To reset, stop the
  server and delete `apps/server/.data`.
  - The dev DB holds the user's own campaign **"Test1"**. Don't modify it.
  - Test campaigns: "Operation Long Winter", "Draft List Check", "Phone List Check", "Wait Check"
    (Phase 1), and from this session, hosted by Field Marshal with Bo: "Border Dispute"
    (correspondence, three rounds of wars, with one war and one game still pending, which the
    scheduler will auto-accept and time out), "Blitz Night" (live), "Tiebreak" (Armageddon
    underway) and "Settings Check" (a lobby). From Phase 3, hosted by Field Marshal: "Diplomacy
    Check" (with Bo and Cy, round 3: chat, private messages, a broken accord, one kept, and Field
    Marshal's accord with Cy in force) and "Lobby Chat Check" (with Bo, a lobby with chat). From
    Phase 4, hosted by Field Marshal: "History Check" (with Bo, Cy and Di, round 6 after six rounds
    of scripted wars, accords kept and broken, and Bo's declaration on Cy waiting for an answer)
    and "Draft Stats Check" (with Bo, free draft, a few picks in). "History Check" was later played on
    to round 10 (36 resolved wars, so the oldest are out of the campaign view), and "Blitz Night"
    moved to round 2 with one more war, which Bo resigned.
  - A campaign with real history is quickest to script against the dev server: sign four players
    in with `/api/auth/dev`, create and join, start and end the draft, then per round ask the rules
    for targets (`attackableTargets`, `suggestStake` over a `WarBoard` built from the campaign
    view) and play a short scripted game (Scholar's mate, Fool's mate, a knight shuffle to a
    threefold draw, or a few opening moves and a resignation).
- **Dev servers.** The user often runs `pnpm dev` in their own terminal, whose output isn't
  visible from here. Check with `ps` before starting anything, and don't kill their processes.
  `tsx watch` restarts the server when shared code changes (and applies new migrations); Next
  hot-reloads.
- **Several players at once.** Each player needs their own session cookie.
  - curl with one cookie jar per player (send an `Origin` header on writes):
    ```bash
    curl -s -c bo.jar -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"name":"Bo"}' http://localhost:3000/api/auth/dev
    ```
  - In the browser pane, `localhost:3000` is signed in as the user's own account; don't sign it
    out. Use a `*.localhost` subdomain for another player, e.g. `http://fm.localhost:3000`, which
    has its own cookies. `127.0.0.1` doesn't work: Next's dev server blocks its dev resources from
    origins not in `allowedDevOrigins`.
  - To find legal targets and stakes for a scripted player, run the rules package over a
    campaign view with `npx tsx` from `apps/server` (it resolves `@empire/rules`).
- **Browser pane tips.** Prefer `find` refs over coordinates, and re-`find` after re-renders. Stub
  `window.confirm = () => true` before buttons that confirm (next round, end draft, resign,
  withdraw, renounce, delete a message). Screenshots can lag a render; check the DOM with
  `javascript_tool` when one looks stale. Reset any emulated viewport when done.
- **Server tests** run the real app on in-memory PGlite with a fake clock and the scheduler off:
  `server.clock.advance(ms)` then `server.runDue()` steps through deadlines, and `server.notices`
  records notifications. War tests use `warDataset()` from `@empire/rules/testing` (two empires
  with a sea lane, terrain and same-value countries; values are in the ids). Helpers are in
  [apps/server/test/helpers.ts](../apps/server/test/helpers.ts).

## Architecture you need to know

- **`packages/rules` is the single source of game rules**, pure TypeScript with no I/O; the server
  enforces with it and the client previews with it.
  - `war.ts`: targets (`checkTarget`, `attackableTargets`), stakes (`checkStake`, `suggestStake`,
    a best-first search for the cheapest connected stake), locks, truces, answers (`canRaise`,
    `redirectOptions`, `tributeOptions`), clock modifiers, time controls, resolution, tokens.
    Everything takes a `WarBoard` (holdings with acquisition rounds, unresolved wars, truces).
    `activeWar()` turns a server row or a client view into what the rules see.
  - `chess.ts`: `ChessGame` (replay, legality, SAN, typed input, endings, timeouts) and clock
    arithmetic, on chessops.
  - `config.ts`: rules schema with the `war` settings; `parseRules` fills defaults, and stored
    rules are always read through it.
  - `diplomacy.ts`: accord lengths and terms, `checkProposal`, `accordsInForce` and
    `renunciationsFrom` (what the war rules see), reputation (`accordsHeldThrough`,
    `reputationForKeeping` and the constants), `feedShows` (which feed filter shows what) and
    `conversationKey`. `WarBoard` carries `accords` and `renunciations`.
  - `protocol.ts`: API and WebSocket types, including `WarView`, `GameView`, `AccordView`,
    `MessageView`, the feed types, and the war and accord events.
- **Every campaign state change goes through `mutate()`** in
  [apps/server/src/campaigns/mutate.ts](../apps/server/src/campaigns/mutate.ts): per-campaign lock,
  a transaction holding the campaign row, events via `scope.log.add()`, a push to every member
  after commit, and `scope.afterCommit()` for work such as notifications.
- **Wars** ([apps/server/src/wars/](../apps/server/src/wars/)):
  - `service.ts`: declare, respond, reply, fight (create and start games, the live queue), settle
    finished games, resolve, next round, expire unanswered responses.
  - `games.ts`: moves, resignations and draw offers under a per-game lock (`ctx.gameLocks`),
    publishing `game.update` to every member. **Lock order:** a game lock may take the campaign
    lock inside it (to settle the war), never the other way round.
  - `turns.ts`: declaring in turns, where the rules have it: the round's order, passes and whose
    turn it is live on the campaign row; `service.ts` checks the turn before a declaration or
    fortification and passes it on after.
  - `scheduler.ts`: polls every 5 s for expired responses and turns, flag-falls and half-settled
    games (deadlines are columns, so restarts lose nothing); live flag-falls also get in-process
    timers.
  - `board.ts` loads the `WarBoard`; `views.ts` shapes rows for the API.
  - Truces aren't stored: they're derived from wars resolved recently.
- **Diplomacy** ([apps/server/src/diplomacy/](../apps/server/src/diplomacy/)):
  - `accords.ts`: propose, answer, withdraw, renounce through `mutate()`; `startRoundForAccords()`
    runs at every round start (and when the draft ends): it pays the accords held through the
    round before, then lets finished ones run their course. `lapseProposals()` runs in the scheduler.
    Private changes (proposals, declines, withdrawals, lapses) log no events and call
    `scope.notifyOnly([...])`, so only the two players are pushed `campaign.changed`.
  - `chat.ts` (`ChatService`): messages don't change the campaign, so they skip the campaign lock
    and push `chat.message` straight to the players who can read them (every member for the
    channel, two for a private message). `feed()` merges events and channel messages into pages
    with a two-part cursor (`"<event id>.<message id>"`). Read positions live in `chat_reads`.
  - Proposals are the second private field of `CampaignView`: `accords` holds public accords plus
    the viewer's own proposals.
- **Statistics** ([apps/server/src/stats/](../apps/server/src/stats/)): `service.ts` reads the
  campaign's holdings, wars, `war.resolved` events, games and signed accords in one read-only
  transaction and hands them to `campaignStats()` in `packages/rules/src/stats.ts` (history,
  acquisitions, war records, accord tallies, chess profiles). `openings.ts` (`OpeningNamer`) names
  each game's opening from `packages/data/openings/openings.json` via `OpeningBook` in
  `packages/rules/src/openings.ts`. Real-world totals and rankings are worked out on the client
  (`apps/web/src/lib/empire.ts`) from the dataset it already has.
- **Pages over the map room.** `app/c/[id]/layout.tsx` renders `CampaignScreen`, and child routes
  (the empire page) render inside it as an overlay while the map, tabs and panels stay mounted.
  `useSelectedLayoutSegment()` tells the screen a page is open; covered regions are `inert`; the
  overlay reads the model through `useCampaignRoom()` (`components/campaign/room-context.tsx`),
  which also has `useEmpireHref()` for links to empire pages. `usePanelParams().set` pushes
  `?war=`-style state in place on the map room, and navigates back to it from a page.
- **Time** comes from `ctx.now()`, injectable for tests. The hub measures each socket's round
  trip (`hub.latency(userId)`) for lag compensation.
- **Real time on the client.** `campaign.events` messages refetch the campaign and go into the
  cached feeds; `game.update` messages go straight into the game's query cache (`BoardGame` adds
  `receivedAt`, and clocks run from it, so client clock skew doesn't matter); `chat.message` goes
  into the feed or conversation cache (`apps/web/src/lib/chat.ts`) without refetching the campaign.
  On reconnect everything is refetched.
- **Notifications** ([apps/server/src/notifications/](../apps/server/src/notifications/)): the
  notifier pushes to every stored subscription (dropping ones the push service says are gone) and
  emails when push reached nothing and the notice asks for it. Subscriptions are only accepted for
  known push-service hosts, so the server can't be pointed elsewhere. The service worker's `push`
  and `notificationclick` handlers are in `apps/web/public/sw.js`.
- **Privacy pattern.** Per-player private data goes into viewer-specific fields of `CampaignView`
  (`myDraftList`, `myAutodraftFallback`, the viewer's proposals in `accords`). The event log is
  public to every member, so private actions never log events. War data, tokens, signed accords and
  reputation are public within a campaign; private messages only reach their two players.
- **Security.** Sessions are hashed tokens in an httpOnly SameSite=Lax cookie; unsafe methods
  check `Origin` (CSRF); WebSocket upgrades check the origin hostname; validate input with
  `parse(schema, value)` and throw `HttpError` helpers for player-facing messages. Game views are
  for campaign members only, and moves for the two players.
- **Web app structure.**
  - Pages are thin server components; the `/c/[id]` layout wraps the screen in `Suspense`
    because it reads `useSearchParams`, and the `/c/[id]` page itself renders nothing.
  - Empire page components are in `components/empire/`: `empire-screen.tsx` (header, totals,
    countries), `history-chart.tsx` (SVG chart, readout and table), `war-record.tsx`,
    `chess-profile.tsx`. Player names link to empire pages through `PlayerName`'s `href`.
  - `buildModel()` in [apps/web/src/lib/campaign.ts](../apps/web/src/lib/campaign.ts) derives the
    war board, targets, active and past wars, what's waiting on the viewer, and each locked
    country's war. `useMyGames()` adds whose move it is in each of the viewer's games.
  - `CampaignRoom` (campaign-screen.tsx) renders the phone layout under 1024 pixels, and columns
    from there as `roomLayout()` (`lib/room-layout.ts`) decides: three, or the left one folded into
    a rail that opens it over the map as a drawer. The right column shows the game (as wide as its
    board needs), else the war, else the selected country, else the empire.
  - War components: `wars-panel.tsx`, `war-detail.tsx`, `declare-war.tsx`, `stake-builder.tsx`;
    the board in `components/game/`.
  - Diplomacy components in `components/diplo/`: `diplo-panel.tsx` (the three views), `feed.tsx`,
    `conversations.tsx`, `accords-view.tsx`, `dispatch-line.tsx` (every event in words, also used
    by the draft panel), `chat-line.tsx`, `composer.tsx`. Chat lists use `useChatScroll()` to stay
    pinned to the newest message.
- **The map:** d3-zoom handles zoom imperatively; `counter-scale` keeps markers the same screen
  size; programmatic zooms go through `clamp()`. War arrows and the stake preview are the
  `WarArrows` layer, drawn beneath labels. Framing and panning keep clear of the controls along
  the top (`topInset`) and the phone's sheet (`bottomInset`), both measured by the campaign screen,
  and of a drawer open over the map's left side (`leftInset`).
  The sheet is measured just after the zoom that opens it, so a zoom asked for from outside
  (`focus`, `fit`) is done again if the room changes within a moment. One country is framed on
  `focusBounds()`, which leaves out pieces stranded across the date line or far out at sea.
- **Visual language** (plan section 9): gunmetal, panel, olive-drab land, deep sea, grease-pencil
  red for wars (`.btn-war`), signal amber for alerts and your turn; Sofia Sans Condensed with Saira
  Stencil for names and headlines only; plain button labels; 44px tap targets; reduced motion
  respected. The board theme is `.board-theme` in `globals.css`.

## What's next: Phase 5 (playtest)

Plan section 8: run a real campaign with the friend group, tune country values, the token economy,
the stake range, time controls and round length, and gather feedback before Phase 6. Worth doing
first:

- Have the group review the map canon (`REPORT.md`).
- Try push on real phones once production is live (iPhones need the app on the home screen). The
  deployment (Vercel, Render, Supabase, Resend at geochess.xyz) is described in
  [deploy.md](deploy.md).
- Host tools the plan names for stalled campaigns: pause, or replace an inactive player.

Smaller follow-ups, none blocking:

- Browsing earlier positions by clicking a move; move sounds.
- The campaigns page's "waiting" count refreshes on focus, not on every move.
- A campaign view carries active wars plus the 30 most recently resolved, the 150 most recent
  events, and the 30 most recently ended accords; the feed pages through everything, the stats
  page reads everything, and the war panel reads older wars on their own. Dispatch lines still only
  link wars in the view.
- `games` has no `campaign_id` index; the stats service reads games by war (indexed) instead, and
  `attentionCounts` scans them. Fine at friend-group scale.
- Chat: @mentions with push, group conversations, and showing accords on the map were left out.
- The opening name could show on the board during a game (the server would add it to `GameView`).
- `answerWindow` in `war-detail.tsx` is unused (left from Phase 2).

## Gotchas

- **Next.js 16** differs from older versions; read the bundled docs in
  `apps/web/node_modules/next/dist/docs/`. `params` and `searchParams` are async; `proxy.ts`
  replaces middleware; Turbopack is the default; dev and build can run concurrently; `next dev`
  rewrites `apps/web/AGENTS.md` and `CLAUDE.md` (leave them be).
- **TypeScript is pinned to 6.0.x.** TypeScript 7 (native) lacks the JS API Next's type check uses.
- **Zod 4:** `.prefault({})` for nested object defaults; `z.literal([...])` takes several values.
- **Fastify 5:** `req.host` includes the port and `req.hostname` doesn't; `trustProxy` is on.
- **WebSocket in development** connects straight to `:4000`; cookies ignore ports, so auth works.
  In production it connects straight to `api.geochess.xyz`, and the session cookie is set on
  `geochess.xyz` and its subdomains (`COOKIE_DOMAIN`) so it goes along.
- **chessground** needs its CSS imported (`board.tsx` does), measures itself, and is redrawn by a
  `ResizeObserver` when its panel changes size. Its config is memoized so the 100 ms clock tick
  doesn't reset a drag.
- **chessops** represents castling as the king taking its rook; `ChessGame` stores and accepts
  e1g1 as well.
- **Prettier ignores** `packages/data/config/` and the plan document.
- **zsh:** a bare `===` in `echo` triggers equals-expansion; quote it.
- **Page titles:** Next inserts its own `<title>` (ahead of the old one) when the route changes, so
  setting `document.title` once doesn't stick. The campaign screen uses `useDocumentTitle()`, which
  re-applies the title whenever the head changes.
- **SVG focus rings:** browsers draw a `:focus` outline on a focusable `<svg>` after a click, even
  when `:focus-visible` doesn't match; the history chart turns it off and keeps an amber
  `:focus-visible` ring.
- **Hidden but mounted:** the campaign screen hides its column's sections, a closed drawer and the
  phone's other tabs with `visibility: hidden` and `inert`, not `display: none`, so their scroll
  positions survive; a class that sets `visibility: visible` inside them would show through.
- **Scripted checks against `pnpm dev`:** Next's dev badge (`nextjs-portal`) sits over the phone's
  first tab and takes its clicks; hide it (`nextjs-portal { display: none }`) before driving phones.

## File map

| Where                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rules/src/`      | `war.ts`, `handicap.ts`, `turns.ts`, `diplomacy.ts`, `chess.ts`, `bots.ts` (levels, call signs), `openings.ts`, `stats.ts`, `draft.ts`, `graph.ts`, `config.ts`, `colors.ts`, `dataset.ts`, `protocol.ts`, `victory/*` (missions: `catalog`, `evaluate`, `blockers`, `generate`, `claims`, `text`, `world`), `test-fixtures.ts` (`@empire/rules/testing`: `lineDataset`, `warDataset`)                                                                                                                                                                                                                                                                                                |
| `packages/data/`           | `config/*.yaml`, `scripts/build.ts` and `scripts/lib/*`, `datasets/2026.1/`, `2026.2/` and `2026.3/`, `scripts/openings.ts` and `openings/openings.json`, `test/datasets.test.ts`, `test/openings.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/`         | `app.ts`, `context.ts`, `campaigns/{mutate,routes,service,views}.ts`, `wars/{board,games,peace,routes,scheduler,service,turns,views}.ts`, `diplomacy/{accords,chat,routes,views}.ts`, `stats/{openings,routes,service}.ts`, `victory/{settle,state,selection,finish,lobby,views,routes,scheduler}.ts`, `bots/{runner,decide,state,engine,chess,draft,lobby,standins,guard,ids,routes}.ts`, `ratings/{lichess,service,routes}.ts`, `notifications/*`, `auth/*`, `realtime/*`, `db/*`, `lib/*`                                                                                                                                                                                          |
| `apps/server/drizzle/`     | Migrations `0000_init` … `0002_autodraft_fallback`, `0003_wars` (wars, games, member tokens), `0004_push_subscriptions`, `0005_diplomacy` (accords, messages, chat reads, reputation), `0006_victory` (mission players, claims, awards, results), `0007_passwords` (`users.password_hash`), `0008_war_answers` (peace offers, reserves, fortifications), `0009_declaration_turns` (turn order, passes, whose turn), `0010_bots` (`members.bot_level`, `bot_round`), `0011_ratings` (Lichess ratings on users, claimed and frozen ratings on members)                                                                                                                                  |
| `apps/web/src/components/` | `campaign/*` (screen, room context, lobby, draft, wars panel, war detail, declare war, stake builder, territory and empire panels), `diplo/*` (Diplo panel, feed, conversations, accords, dispatch lines, composer), `empire/*` (empire page, compare page, history chart, war record, chess profile), `game/*` (board, game panel), `map/world-map.tsx`, `rules/*` (rules guide, `/rules` page, campaign rules page), `landing/*` (the home page's sections, its sample campaign and step pictures), `tutorial/*` (the guest tutorial: screen, steps, battle), `home-screen.tsx` (the landing page), `campaigns-screen.tsx` (your campaigns, name and password), `notifications.tsx` |
| `apps/web/src/lib/`        | `api.ts`, `queries.ts` (incl. games and stats), `chat.ts` (feed, conversation and unread queries and their live updates), `realtime.tsx`, `campaign.ts` (derived model), `map-geometry.ts` (map shapes and framing), `empire.ts` (real-world totals and rankings), `compare.ts` (empires side by side), `wars.ts` (war and game text, clocks), `rules-text.ts` (settings in words), `sample-campaign.ts` (the landing page's sample), `tutorial.ts` (the guest tutorial's scenario and steps), `room-layout.ts` (screen columns), `use-chat-scroll.ts`, `use-document-title.ts`, `use-element-width.ts`, `use-element-size.ts`, `use-my-games.ts`, `use-now.ts`, `format.ts`          |

API: `/api/me` (and `PUT /api/me/password`), `/api/auth/{dev,email,email/verify,password,lichess,lichess/callback,logout}`,
`/api/campaigns` (list, create), `/api/campaigns/:id` (get, patch, delete),
`/api/campaigns/:id/{invite/reset,me,members/:userId,leave,kick,rating/refresh}`, `/api/campaigns/:id/bots` (add) and `…/bots/:botId` (level), `/api/campaigns/:id/players/:userId/stand-in` (put in, take back),
`/api/campaigns/:id/draft/{start,pick,autopick,end,list}`,
`/api/campaigns/:id/wars` (declare), `/api/campaigns/:id/wars/:warId` (read) and `…/{respond,reply,recall,peace}`,
`…/peace/:offerId/{answer,withdraw}`, `/api/campaigns/:id/fortify`,
`/api/campaigns/:id/round/next`, `/api/games/:gameId` and `…/{move,resign,draw}`,
`/api/campaigns/:id/accords` (propose), `/api/campaigns/:id/accords/:accordId/{answer,withdraw,renounce}`,
`/api/campaigns/:id/stats`, `/api/campaigns/:id/secret` (choose), `/api/campaigns/:id/victory/missions` (the host's four) and
`…/missions/:slot/reroll`, `/api/campaigns/:id/victory/proceed`,
`/api/campaigns/:id/feed?filter=&before=`, `/api/campaigns/:id/messages` (send; `?with=` reads a
private conversation) and `…/messages/:messageId` (delete), `/api/campaigns/:id/chat` (unread
counts) and `…/chat/read`, `/api/push/{key,subscribe,unsubscribe}`, `/api/invites/:code` and
`…/join`, `/ws`.
