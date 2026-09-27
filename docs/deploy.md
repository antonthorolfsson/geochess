# Production deployment

Empire Chess runs at **https://geochess.xyz**. Pushing to `main` deploys it.

| Part        | Where                                     | Plan                                            |
| ----------- | ----------------------------------------- | ----------------------------------------------- |
| Web app     | Vercel, `geochess.xyz` (www → apex)       | Pro (the account's existing plan)               |
| Game server | Render, `api.geochess.xyz`                | Free, Frankfurt ([render.yaml](../render.yaml)) |
| Database    | Supabase Postgres                         | Free, Frankfurt (eu-central-1)                  |
| Email       | Resend over SMTP, `no-reply@geochess.xyz` | Free (3,000 emails a month, 100 a day)          |
| DNS         | GoDaddy (registrar and DNS)               |                                                 |

## How requests flow

- The browser loads the web app from Vercel. Vercel proxies `/api/*` to
  `https://api.geochess.xyz/api/*` (the rewrite in `apps/web/next.config.ts`), so API calls and
  the session cookie are first-party.
- Vercel can't carry WebSockets through a rewrite, so the browser opens its socket straight to
  `wss://api.geochess.xyz/ws` (`NEXT_PUBLIC_WS_URL`). For that socket to be signed in, the server
  sets the session cookie on `geochess.xyz` and its subdomains (`COOKIE_DOMAIN`), and trusts
  `PUBLIC_URL` as an origin for writes and sockets.
- The game server is one long-running process: it holds every WebSocket, runs live clocks in
  memory and checks deadlines every 5 seconds. Run exactly one instance. Vercel Functions can't
  host it (connections end at the function's maximum duration and instances don't share memory).

## Settings

Web app (Vercel project, Root Directory `apps/web`, Production and Preview):

| Variable             | Value                       |
| -------------------- | --------------------------- |
| `API_ORIGIN`         | `https://api.geochess.xyz`  |
| `NEXT_PUBLIC_WS_URL` | `wss://api.geochess.xyz/ws` |

Both are read at build time, so changing them needs a redeploy.

Game server (Render): the fixed values are in `render.yaml`. The secrets were entered in the
Render dashboard and live only there:

| Variable                                | Value                                                                                                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | Supabase's **Session pooler** connection string plus `?sslmode=verify-full&sslrootcert=/app/certs/supabase-root-2021.crt`, which checks the database's certificate against Supabase's CA (committed in `apps/server/certs/`). |
| `SMTP_URL`                              | `smtps://resend:<Resend API key>@smtp.resend.com:2465`. Render's free plan blocks ports 465 and 587; Resend also listens on 2465.                                                                                             |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push keys from `npx web-push generate-vapid-keys`. Changing them invalidates every push subscription.                                                                                                                     |

Use the session pooler (port 5432), not the transaction pooler (6543): the server holds row locks
inside transactions. Supabase's direct connection is IPv6 only, which Render can't reach.

## DNS at GoDaddy

| Type    | Name                        | Points to                                           |
| ------- | --------------------------- | --------------------------------------------------- |
| A       | `@`                         | Vercel's IP, as shown in the Vercel domain settings |
| CNAME   | `www`                       | Vercel's CNAME target, as shown there               |
| CNAME   | `api`                       | The Render service's `onrender.com` host            |
| MX, TXT | `send`, `resend._domainkey` | Resend's records for sending mail (SPF and DKIM)    |

## Things to know

- **Render's free plan sleeps** after 15 minutes without inbound traffic, which would stall war
  deadlines. A Vercel cron job (`apps/web/vercel.json`) calls `/api/health` every 10 minutes to
  keep it awake; one always-on service fits in Render's 750 free hours a month. It also gets a
  tenth of a CPU, and Render may restart it at any time: deadlines live in the database and
  players' sockets reconnect, so games carry on. For the real playtest, switch the service to
  **Starter** ($7/month, in `render.yaml` or the dashboard) and drop the cron job.
- **Deploys** start the new server before stopping the old one. For a few seconds two schedulers
  run; the database row locks keep them from doing anything twice, and sockets reconnect to the
  new server. Avoid deploying the server during a live game anyway.
- **Supabase's free plan** allows 500 MB of data and 5 GB of egress a month, keeps no backups,
  and pauses a project after a week without database activity (the server's 5-second deadline
  check counts). Watch the usage page during the playtest; Pro is $25/month.
- **Previews:** Vercel preview deployments proxy to the production game server but can't sign in
  (the session cookie belongs to geochess.xyz), so they only show signed-out pages.
- **Lichess sign-in** needs no registration; its redirect goes to
  `https://geochess.xyz/api/auth/lichess/callback`.
