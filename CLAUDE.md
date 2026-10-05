# Geo Chess

Friends claim countries on a world map and settle wars with chess. The design and phased roadmap
are in `empire-chess-implementation-plan.md`; read the relevant section before building a feature.

**Current status, open decisions and what to build next are in `docs/handover.md`. Read it first
when starting new work.**

## Commands

- `pnpm dev`: game server (port 4000) and web app (port 3000) with live reload
- `pnpm test`, `pnpm typecheck`, `pnpm build`: run across all packages
- `pnpm data:build`: rebuild the country dataset (downloads are cached in `packages/data/raw/`)
- `pnpm data:openings`: rebuild the opening names table from the Lichess openings list
- `pnpm db:generate`: new SQL migration after editing `apps/server/src/db/schema.ts`
- `pnpm sim --scenario baseline --players 2-8 --seeds 400`, then `pnpm sim:report baseline`: the
  balance simulator (`packages/sim`, see its README); findings are in `docs/balance-report.md`
- `pnpm --filter @empire/server bot-ladder`: bot levels play each other on the shipped Stockfish,
  and the fitted ratings are what `BOT_LEVELS` quotes

## Layout and rules of the road

- `packages/rules` is the single source of game rules, pure TypeScript with no I/O. The server
  enforces with it; the client previews with it. New rules go here first, with vitest tests.
  API request/response and WebSocket message types live in `packages/rules/src/protocol.ts`.
- `packages/data` builds versioned datasets. Never edit `datasets/<version>/` by hand: change the
  YAML in `packages/data/config/` and rerun the pipeline. Campaigns pin the dataset version they
  started with, so a data change that alters ids or adjacency needs a new version.
- `apps/server` (Fastify + Drizzle) is authoritative. Every state change to a campaign goes through
  `mutate()` in `src/campaigns/mutate.ts`: per-campaign lock, a transaction with the campaign row
  locked, events appended to the `events` log, then a push to every member over WebSockets.
- Wars live in `apps/server/src/wars/`: `service.ts` runs the lifecycle through `mutate()`;
  `games.ts` handles moves under a per-game lock, which may take the campaign lock inside it but
  never the other way round. Deadlines are rows in the database, polled by `scheduler.ts`, with
  in-process timers for live flag-falls. Tests drive time through the injectable `ctx.now()`.
- How a war is answered is host settings in `rules.war` (raise style, how many raises go back and
  forth, redirects, fortifying, peace terms, calling off). A new war setting must default, when
  absent, to what campaigns already played, so stored rules (production's included) keep their
  game; new campaigns get the new default through `DEFAULT_RULES`. With raises back and forth
  (`rules.war.raises` above 1), a countered war waits on whoever didn't raise last (`waitingOn`,
  `owingAnswer` in SQL), not always the attacker; whoever raised and then backs down loses the war
  as declared (outcomes `yielded` and `forfeited`), which no battle mission counts. Peace offers
  (`wars/peace.ts`) are private to the two players, like accord proposals, until accepted.
  Anything that stops a game from a campaign change updates the game row before touching anything
  a move also updates (peace offers), so the two can't deadlock.
- New campaigns declare war in turns (`rules.war.turns`; absent means anyone declares whenever they
  like, as campaigns stored before do). The rules are in `packages/rules/src/turns.ts`, the
  round's state on the campaign row (`apps/server/src/wars/turns.ts`). Declaring and fortifying
  check the turn (`requireTurn`) and pass it on (`turnTaken`); anything new that should cost a turn
  must do the same. Live games wait until declaring is over.
- Empire statistics are derived on each request, never stored: `apps/server/src/stats/` gathers the
  rows and `packages/rules/src/stats.ts` works out history, war records and chess profiles.
- Victory missions: the catalog, versioned numbers (`MISSION_RULES`), evaluators, target
  generation and claim blockers are in `packages/rules/src/victory/`; the server side is in
  `apps/server/src/victory/`. Tuning means a new version (version 5 since 2026-10-05); stored
  campaigns keep theirs. Numbers counted in country value are written for one dataset value scale
  (`MissionRules.valueScale`, `DATASET_VALUE_SCALES`): values run 1 to 20 from dataset 2026.2 and 1
  to 10 before, so new campaigns pair the latest dataset with the current version, and the bots'
  value knobs are scaled to each campaign's dataset (`knobsFor`). From version 5, titles
  (`victory/titles.ts`) give a point each for leading the table on population, land, GDP and
  military might, kept on the campaign row (`campaigns.titles`) and moving with the lead: the only
  points that can be lost. `settleVictory()` runs inside every `mutate()` (titles, reveals, claims, awards,
  the finish). A campaign's last round (`rules.victory.lastRound`) ends it on points when the host
  moves on from it (`endSeason`). A player's secret mission and options are private until
  `mission.revealed`: never put them in events, pushes, notices or another player's view before
  that. Every player sees points move as an award ceremony, built from the pushed `title.changed`
  and `mission.awarded` events (`apps/web/src/lib/ceremony.ts`, played by `award-ceremony.tsx` in
  `components/victory/`): anything new that moves points needs an event they understand.
- Diplomacy lives in `apps/server/src/diplomacy/`. Accords go through `mutate()`; the event log is
  public to every member, so private changes (proposals, declines) log no events and call
  `scope.notifyOnly()`. Chat doesn't change the campaign: `chat.ts` skips the campaign lock and
  pushes `chat.message` only to the players who can read it.
- Bot players (`apps/server/src/bots/`) are added by the host in the lobby: a user each (ids
  `bot_…`), with `members.bot_level`. The host can also hand a quiet player's empire to a bot
  (`standins.ts`): the same column on the player's own membership, so "is this a bot?" means the
  seat (`botSeats`, `playedByBot`), not the id; the player's own writes are refused meanwhile
  (`guard.ts`). `runner.ts` hears of every change to a campaign or game with
  a bot in it and acts through the same services players' requests use, so every rule is checked for
  bots too. Each decision is the simulator's standard bot (`@empire/sim/live`) on a view holding only
  what that player may see (`state.ts`): never another player's secret, proposals or peace offers
  before the rules make them public. Chess is Stockfish's lite WASM build in `apps/server/engine/`
  (a child process, `engine.ts`); what each level asks of it is in `chess.ts`, and `BOT_LEVELS` in
  the rules describes the levels to players. A change to the simulator's bots changes live bots too.
- Rating handicaps (`rules.war.handicap`, off unless the host turns it on) are time odds for the
  weaker player: the rules are in `packages/rules/src/handicap.ts` (`clockFactors` in `war.ts`
  applies them), the server side in `apps/server/src/ratings/`. Ratings come from Lichess (kept on
  the user, read again through the injectable `ctx.lichess`), a bot's level, or the player's own
  number where the host allows it, and are frozen on the membership when the draft starts.
- `packages/sim` plays whole campaigns with bots for balance runs. It uses the rules package for
  every rule but mirrors the server's orchestration (round starts, the war lifecycle,
  `settleVictory`) in `src/engine/`: change one, change the other.
  `apps/server/test/sim-parity.test.ts` replays simulated campaigns through the server and fails
  on any drift.
- `apps/web` is Next.js 16. Its bundled docs in `apps/web/node_modules/next/dist/docs/` are the
  reference, since APIs differ from older versions (async `params`, `proxy.ts`, Turbopack default).
  Pages are thin server components that hand off to client screens in `src/components/`. The
  campaign screen lives in `app/c/[id]/layout.tsx`, so pages under it (an empire's statistics,
  every empire compared) open over the map room without resetting it; they read it with
  `useCampaignRoom()`.
- Local database is embedded PGlite (`apps/server/.data/`), so no setup is needed; set
  `DATABASE_URL` for Postgres.
- Production is https://geochess.xyz and deploys on every push to `main`: the web app on Vercel,
  the game server on Render (`render.yaml`, `api.geochess.xyz`), Postgres on Supabase. See
  `docs/deploy.md` before changing anything that touches origins, cookies or the server image.
- Visual language: see section 9 of the plan. Tokens are in `apps/web/src/app/globals.css`;
  empire colors and hatching are in `packages/rules/src/colors.ts`. Stencil type only for empire
  names and headlines; buttons use plain literal labels.
- Formatting: Prettier (`.prettierrc.json`, single quotes, 120 columns).
