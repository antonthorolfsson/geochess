# Handover: Phase 4 done, Phase 5 (playtest) next

_Written 2026-09-27 at the end of the session that built Phase 4 (stats and history). Read this
first, then the plan._

## Start here

1. Read, in order: this file, [CLAUDE.md](../CLAUDE.md), and the plan
   [empire-chess-implementation-plan.md](../empire-chess-implementation-plan.md), especially
   section 8 (Phase 5, the playtest) and section 11 (risks).
2. Run `pnpm install && pnpm test` to confirm a green baseline (269 tests).
3. Phases 1 and 2 are committed (`4955ca2`), Phase 3 too (`896c7fd`). Phase 4 is not: the user
   hasn't asked for a commit. Don't commit or push unless asked.
4. Before planning the playtest, go through [what still needs the user](#what-still-needs-the-user).

## Where things stand

**Phase 1 (Foundation)** is complete: sign-in (Lichess OAuth with PKCE, email links, development
sign-in by name), lobbies with invite links and empire colors, the d3-geo map with hatching,
microstates, sea lanes and search, the snake draft with private draft lists and auto-draft, the
empire panel, dataset `2026.1` (188 territories), PWA shell, CI and Prettier.

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

## Phase 2 decisions (settled with the user on 2026-09-27)

Numbers quoted come from simulating 30 full contiguous drafts per player count on `2026.1`.

| Topic         | Decision                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pace          | A campaign setting: live or correspondence for every war. Time controls are stored per game, so a per-war choice can come later.                                                                                                                                                     |
| Rounds        | Advance only when the host presses "Next round". No round timers. Rounds refill tokens and count down locks and truces; response windows and move deadlines are in hours.                                                                                                            |
| Tokens        | 1 per round. Unused tokens carry over up to 3; tribute can take a player past 3. Declaring costs 1.                                                                                                                                                                                  |
| Unclaimed     | "End draft" auto-drafts the rest (draft lists first, then the most valuable), so the map is always full. No annexing.                                                                                                                                                                |
| Stake         | The launching country plus connected countries of the attacker's, worth at least 80% of the target (rounded up). No upper cap. Raise demands at least 125% (rounded up). With the strict 80–125% window only 44–51% of bordering enemy countries were attackable; this gives 85–91%. |
| Redirect      | Another defender country of the same value that borders the attacker's empire. The stake stays as declared. The attacker fights for it or withdraws and loses the token.                                                                                                             |
| Tribute       | A refusable offer: one unlocked defender country worth less than the target, or any number of tokens. Accepted: war over, truce. Refused: the game goes ahead as declared, with no further responses.                                                                                |
| Deadlines     | 24 h (correspondence) or 5 min (live) for the defender; silence accepts the war as declared. The attacker gets the same window to answer a counter; silence means no war (raise or redirect: withdrawn; tribute: accepted).                                                          |
| Time controls | Live 5+3; correspondence 1 day per move, and running out loses. Host presets: live 3+2, 5+3, 10+5, 15+10; correspondence 12 h, 1, 2 or 3 days per move.                                                                                                                              |
| Draws         | Defender holds. Host option: Armageddon, one more game with colors swapped, Black on 4/5 of White's time and winning on a draw.                                                                                                                                                      |
| White         | The attacker. (Phase 6 surprise wars keep "see the starting position early" as their perk.)                                                                                                                                                                                          |
| Clock mods    | Defender +10% home turf, +10% if the target has mountains or is an island; attacker +5% per own country bordering the target (launcher included). Net capped at ±25%, given to one side as extra time (initial time and increment live, time per move in correspondence).            |
| Locks         | Countries in an active war (target, stake, or offered as a redirect or tribute) are locked: they can't be targeted, staked, paid as tribute or offered. A country acquired by war or tribute can't be staked for 2 rounds.                                                           |
| Truces        | 1 round between the two players after a war resolves by a game or accepted tribute (not after a withdrawal).                                                                                                                                                                         |
| License       | AGPL-3.0-or-later, confirmed.                                                                                                                                                                                                                                                        |

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
  Germany (9) and Western Sahara (2). The friend group should review `REPORT.md`.
- **Web push on real devices** is untested end to end: it needs VAPID keys, a production build
  served over HTTPS, and (on iOS) the app on the home screen.

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
  - `scheduler.ts`: polls every 5 s for expired responses, flag-falls and half-settled games
    (deadlines are columns, so restarts lose nothing); live flag-falls also get in-process timers.
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
  - `CampaignRoom` (campaign-screen.tsx) renders either the desktop columns or the phone layout.
    The right column shows the game, else the war, else the selected country, else the empire.
  - War components: `wars-panel.tsx`, `war-detail.tsx`, `declare-war.tsx`, `stake-builder.tsx`;
    the board in `components/game/`.
  - Diplomacy components in `components/diplo/`: `diplo-panel.tsx` (the three views), `feed.tsx`,
    `conversations.tsx`, `accords-view.tsx`, `dispatch-line.tsx` (every event in words, also used
    by the draft panel), `chat-line.tsx`, `composer.tsx`. Chat lists use `useChatScroll()` to stay
    pinned to the newest message.
- **The map:** d3-zoom handles zoom imperatively; `counter-scale` keeps markers the same screen
  size; programmatic zooms go through `clamp()`. War arrows and the stake preview are the
  `WarArrows` layer, drawn beneath labels.
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
- The home screen's "waiting" count refreshes on focus, not on every move.
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

## File map

| Where                      | What                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rules/src/`      | `war.ts`, `diplomacy.ts`, `chess.ts`, `openings.ts`, `stats.ts`, `draft.ts`, `graph.ts`, `config.ts`, `colors.ts`, `dataset.ts`, `protocol.ts`, `test-fixtures.ts` (`@empire/rules/testing`: `lineDataset`, `warDataset`)                                                                                                                                                         |
| `packages/data/`           | `config/*.yaml`, `scripts/build.ts` and `scripts/lib/*`, `datasets/2026.1/`, `scripts/openings.ts` and `openings/openings.json`, `test/datasets.test.ts`, `test/openings.test.ts`                                                                                                                                                                                                 |
| `apps/server/src/`         | `app.ts`, `context.ts`, `campaigns/{mutate,routes,service,views}.ts`, `wars/{board,games,routes,scheduler,service,views}.ts`, `diplomacy/{accords,chat,routes,views}.ts`, `stats/{openings,routes,service}.ts`, `notifications/*`, `auth/*`, `realtime/*`, `db/*`, `lib/*`                                                                                                        |
| `apps/server/drizzle/`     | Migrations `0000_init` … `0002_autodraft_fallback`, `0003_wars` (wars, games, member tokens), `0004_push_subscriptions`, `0005_diplomacy` (accords, messages, chat reads, reputation)                                                                                                                                                                                             |
| `apps/web/src/components/` | `campaign/*` (screen, room context, lobby, draft, wars panel, war detail, declare war, stake builder, territory and empire panels), `diplo/*` (Diplo panel, feed, conversations, accords, dispatch lines, composer), `empire/*` (empire page, history chart, war record, chess profile), `game/*` (board, game panel), `map/world-map.tsx`, `notifications.tsx`                   |
| `apps/web/src/lib/`        | `api.ts`, `queries.ts` (incl. games and stats), `chat.ts` (feed, conversation and unread queries and their live updates), `realtime.tsx`, `campaign.ts` (derived model), `empire.ts` (real-world totals and rankings), `wars.ts` (war and game text, clocks), `use-chat-scroll.ts`, `use-document-title.ts`, `use-element-width.ts`, `use-my-games.ts`, `use-now.ts`, `format.ts` |

API: `/api/me`, `/api/auth/{dev,email,email/verify,lichess,lichess/callback,logout}`,
`/api/campaigns` (list, create), `/api/campaigns/:id` (get, patch, delete),
`/api/campaigns/:id/{invite/reset,me,leave,kick}`,
`/api/campaigns/:id/draft/{start,pick,autopick,end,list}`,
`/api/campaigns/:id/wars` (declare), `/api/campaigns/:id/wars/:warId` (read) and `…/{respond,reply}`,
`/api/campaigns/:id/round/next`, `/api/games/:gameId` and `…/{move,resign,draw}`,
`/api/campaigns/:id/accords` (propose), `/api/campaigns/:id/accords/:accordId/{answer,withdraw,renounce}`,
`/api/campaigns/:id/stats`, `/api/campaigns/:id/feed?filter=&before=`, `/api/campaigns/:id/messages` (send; `?with=` reads a
private conversation) and `…/messages/:messageId` (delete), `/api/campaigns/:id/chat` (unread
counts) and `…/chat/read`, `/api/push/{key,subscribe,unsubscribe}`, `/api/invites/:code` and
`…/join`, `/ws`.
