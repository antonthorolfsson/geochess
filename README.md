# Geo Chess

_Working title._ Friends claim countries on a world map to build empires. Wars between empires are
declared under structured rules and settled by a game of chess; the winner takes the contested
territory. Private lobbies, campaigns that run for days or weeks, playable on phone and desktop.

The full design and roadmap live in [empire-chess-implementation-plan.md](empire-chess-implementation-plan.md).

## Status

**Phase 1 (Foundation)** is in place:

- Sign in with Lichess (OAuth with PKCE, no registration needed), by emailed link, or, in
  development, by name.
- Invite-only campaigns: create one, share the invite link, pick your empire color, set the rules.
- The map: Natural Earth shapes rendered with d3-geo, pinch and pan zoom, ownership shown as
  translucent colors with hatching, tappable dots for microstates, sea lanes, country search.
- The country dataset: game values 1–10 from blended real-world data, land borders and sea lanes,
  terrain tags and real statistics, built by a versioned pipeline.
- The snake draft of the full map, with a contiguous or free draft mode and live updates over
  WebSockets. Each player can keep a private draft list that auto-draft works through, skipping
  countries already taken; when the list runs out, auto-draft either keeps picking the most
  valuable country or waits for the player, as they choose. The host can pick for a stalled
  player or end the draft early, which drafts the remaining countries automatically.

**Phase 2 (War loop)** is in place:

- War tokens (one a round, saved up to three) and host-advanced rounds.
- Declaring war on a bordering enemy country, with attackable countries highlighted on the map and
  a stake builder: the launching country plus connected countries, worth at least 80% of the
  target.
- The defender's answers: accept, raise (demand a stake worth 125%), redirect to another country
  of the same value, or offer tribute. Unanswered declarations go ahead after 24 hours (5 minutes
  live).
- Chess on Lichess's chessground board with moves checked on the server by chessops, in live
  (blitz) or correspondence campaigns: server clocks with lag compensation, clock modifiers for
  home turf, terrain and supply lines, premoves, typed moves, draw offers, and an optional
  Armageddon tiebreak for draws.
- Territory changes hands when a war ends; staked countries stay locked while their war is on,
  newly won ones can't be staked straight away, and rivals keep a truce afterwards.
- War arrows drawn on the map in grease pencil, a war room with everything waiting for you, and
  notifications by web push (installed app) or email.

**Phase 3 (Diplomacy)** is in place:

- Accords: non-aggression pacts between two players, with optional public terms. Proposals are
  private until signed; a signed accord stops both players declaring war on each other until it
  runs its course. Either side can renounce it at any time, in public, and the breaker must wait a
  round before attacking the betrayed player.
- Reputation: every empire starts at 100, loses 20 for breaking an accord and gains 2 for every
  whole round an accord holds.
- Chat: a campaign channel and one-to-one private messages from the lobby on, with unread counts
  on every device and push notifications for private messages.
- The Diplo tab: the dispatches and the campaign channel in one timeline with filters, private
  conversations, and everything about accords and reputation in one place.

**Phase 4 (Stats and history)** is in place:

- A statistics page for every empire, open to everyone in the campaign: tap a player's name in the
  standings, a war or a country, or use "Full statistics" in the Empire tab.
- Real-world totals and shares of the world (population, area, GDP, GDP at purchasing-power
  parity, military spending, armed forces), where the empire would rank among today's countries
  and among the campaign's empires ("Your economy would rank 3rd in the world, between China and
  Germany"), and every country with how it was won.
- A history graph of every empire's size, round by round, with the empire's wars marked, and a
  table view.
- The war record (won, drawn and lost as attacker and defender, tribute, countries won and lost)
  and accords kept and broken.
- A chess profile: results by colour, how games ended, average length, the games themselves and
  the most-played openings, named from the Lichess openings list.

**Victory missions** are in place. New campaigns play **Objectives** (the host can switch a
campaign to open-ended in the lobby; campaigns created before missions existed stay open-ended):

- Four **public missions**, worth 2 victory points each, chosen and shown with their exact targets
  in the lobby and locked when the draft starts. The default set is Expansion, Strategic
  Positions, The Great Connection and Campaign Veteran; the host can pick any four of sixteen
  (among them Mare Nostrum, One Billion, Seven Wonders and Kingslayer), or have four drawn at
  random, and draw new targets.
  Every player can score each public mission once: one player scoring it takes nothing from the
  others.
- One **secret mission** per player, worth 3. When the draft ends, each player is dealt up to three
  options fitted to their empire (Northern Passage, Black Sea, Silk Road, Encirclement, Strait
  Keeper, Two-Theater Power, Nemesis, Backstab, Checkmate Artist and more), privately, and chooses
  one before round 1; the best fit is assigned if time runs out. A secret mission is revealed to
  everyone, for good, once its player is one step from completing it, or completes it.
- **Claims and the response window.** Completing a territorial mission starts a public claim. It
  scores only once the round after next has started, at least 24 hours (10 minutes live) after
  the next round started, if the position was held throughout and no unresolved war could still
  break it. Campaign Veteran scores as soon as it's done.
- **Winning.** The first to 7 points wins: two public missions and the secret, or all four public
  ones. Points are never lost. Players crossing the line together are ranked by points, and equal
  points share the victory. The campaign then becomes read-only: wars underway are cancelled
  without a result (moves kept), and every secret mission is revealed in the final results.
- A **Missions** tab (a column tab on desktop) with the race for points, your secret mission and
  your progress, claims waiting to score and what threatens them, everyone's progress on the
  public missions, and each mission's targets and routes on the map. Victory points lead the
  standings; territory value stays beside them.

The numbers (points, thresholds, generation limits, timings) are in `MISSION_RULES` in
`packages/rules/src/victory/catalog.ts`. Each campaign keeps the version it was created with, so
tuning them after a playtest never changes a campaign already underway.

## Quick start

Requires Node.js 22.12+ (24 recommended) and pnpm 10.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The game server runs on port 4000 and the web app proxies `/api` to it.

No database setup is needed: the server stores data in an embedded Postgres (PGlite) under
`apps/server/.data/`. Development sign-in is on by default, so you can create players by name.
To play several seats from one computer, use a separate browser profile or private window per
player, since each keeps its own session cookie.

To try it on a phone, open `http://<your computer's LAN address>:3000` on the same network.

## Repository layout

| Path             | Package          | What it is                                                                                                                                                                                                                                       |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/rules` | `@empire/rules`  | Pure TypeScript game rules shared by client and server: dataset types, adjacency, snake draft, war rules, accords, chess and clocks (chessops), opening names, empire statistics, victory missions, campaign settings, empire colors, API types. |
| `packages/data`  | `@empire/data`   | Map and country data pipeline, its hand-editable config, the versioned datasets it builds, and the opening names table.                                                                                                                          |
| `apps/server`    | `@empire/server` | Authoritative game server: Fastify HTTP API, WebSockets, Drizzle ORM on Postgres or PGlite.                                                                                                                                                      |
| `apps/web`       | `@empire/web`    | Next.js installable web app: map room, lobbies, draft, wars, the chess board (chessground), diplomacy and chat, empire statistics.                                                                                                               |

## Commands

| Command              | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`           | Runs the game server and the web app with live reload.                   |
| `pnpm test`          | Unit tests for the rules and dataset, integration tests for the server.  |
| `pnpm typecheck`     | Type-checks every package.                                               |
| `pnpm build`         | Production builds of the server and web app.                             |
| `pnpm data:build`    | Rebuilds the country dataset from Natural Earth and World Bank data.     |
| `pnpm data:openings` | Rebuilds the opening names table from the Lichess openings list.         |
| `pnpm db:generate`   | Generates a SQL migration after changing `apps/server/src/db/schema.ts`. |
| `pnpm format`        | Formats the code with Prettier.                                          |

## Configuration

The server reads `apps/server/.env` (see [apps/server/.env.example](apps/server/.env.example)).
Everything is optional in development. For production, set at least:

- `DATABASE_URL`: a Postgres connection string. `docker compose up -d` starts one locally.
- `PUBLIC_URL`: the public origin of the web app, used in emailed links and OAuth redirects.
- `SMTP_URL` and `MAIL_FROM`: for sign-in and war emails. Without SMTP, emails are printed to the
  server log.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`: web push keys (generate them with
  `npx web-push generate-vapid-keys`). Without them, notifications go by email only.
- `NODE_ENV=production`, which also turns off development sign-in.

Push notifications need the service worker, which is only registered in production builds. On
iPhones and iPads, push works once the app has been added to the home screen.

The web app proxies `/api/*` to the game server at `API_ORIGIN` (default
`http://localhost:4000`). In production, either serve both from one origin (a reverse proxy
routing `/api/*` and `/ws` to the game server), or give the game server its own subdomain: set
`NEXT_PUBLIC_WS_URL` for the web app, and `PUBLIC_URL` and `COOKIE_DOMAIN` for the server so the
socket there shares the session. The live game at geochess.xyz does the latter; see
[docs/deploy.md](docs/deploy.md).

## Data and attribution

Country shapes are from [Natural Earth](https://www.naturalearthdata.com/) (public domain).
Country statistics are from the World Bank's
[World Development Indicators](https://datatopics.worldbank.org/world-development-indicators/),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Gaps are filled with
clearly labeled estimates. Opening names come from the
[Lichess openings list](https://github.com/lichess-org/chess-openings) (CC0). See
[packages/data/README.md](packages/data/README.md).

Every map decision (disputed territories, microstate regions, sea lanes, game values) lives in
hand-editable YAML under `packages/data/config/`, and each build writes a review report to
[packages/data/datasets/2026.1/REPORT.md](packages/data/datasets/2026.1/REPORT.md). Read it with
your group before the first campaign.

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE)). Lichess's chessground (the board) and chessops (the
chess rules) are GPL-3.0-or-later, which the AGPL is compatible with.
