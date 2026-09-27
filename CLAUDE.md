# Empire Chess

Friends claim countries on a world map and settle wars with chess. The design and phased roadmap
are in `empire-chess-implementation-plan.md`; read the relevant section before building a feature.

**Current status, open decisions and what to build next are in `docs/handover.md`. Read it first
when starting new work.**

## Commands

- `pnpm dev`: game server (port 4000) and web app (port 3000) with live reload
- `pnpm test`, `pnpm typecheck`, `pnpm build`: run across all packages
- `pnpm data:build`: rebuild the country dataset (downloads are cached in `packages/data/raw/`)
- `pnpm db:generate`: new SQL migration after editing `apps/server/src/db/schema.ts`

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
- Diplomacy lives in `apps/server/src/diplomacy/`. Accords go through `mutate()`; the event log is
  public to every member, so private changes (proposals, declines) log no events and call
  `scope.notifyOnly()`. Chat doesn't change the campaign: `chat.ts` skips the campaign lock and
  pushes `chat.message` only to the players who can read it.
- `apps/web` is Next.js 16. Its bundled docs in `apps/web/node_modules/next/dist/docs/` are the
  reference, since APIs differ from older versions (async `params`, `proxy.ts`, Turbopack default).
  Pages are thin server components that hand off to client screens in `src/components/`.
- Local database is embedded PGlite (`apps/server/.data/`), so no setup is needed; set
  `DATABASE_URL` for Postgres.
- Visual language: see section 9 of the plan. Tokens are in `apps/web/src/app/globals.css`;
  empire colors and hatching are in `packages/rules/src/colors.ts`. Stencil type only for empire
  names and headlines; buttons use plain literal labels.
- Formatting: Prettier (`.prettierrc.json`, single quotes, 120 columns).
