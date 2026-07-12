# oryx_tech_erp

Oryx ERP is a Next.js SaaS dashboard for Malika tech shops: inventory, direct sales, nasiya/installments, shop subscriptions, audit logs, Telegram reminders, and admin/shop portals.

## Local Development

Use a **fresh Supabase (or local Postgres) database** for QA. See
[Database & Migrations](#database--migrations) before running anything.

```bash
npm install
cp .env.example .env.local            # then fill in the values
npm run prisma:generate
npm run prisma:migrate:deploy         # apply migrations (creates all tables + indexes)
SEED_SUPER_ADMIN_PASSWORD='ChangeMe!123' npm run seed:super-admin   # creates/updates super admins
npm run dev
```

Open `http://localhost:3000`.

> Never run `prisma db push` on this project — it drops the migration-managed
> partial unique indexes. See [Database & Migrations](#database--migrations).

## Verification

```bash
npm test
npm run test:integration # requires an explicitly disposable TEST_DATABASE_URL
npm run typecheck
npm run lint
npm run prisma:validate
npm run build
git diff --check
```

`npm run test:integration` applies every checked-in migration and runs real
PostgreSQL tests. For a local disposable database, set `TEST_DATABASE_URL`. To
reset its `public` schema first, also set:

```bash
INTEGRATION_DB_RESET=yes \
TEST_DATABASE_CONFIRM=reset-disposable-integration-database \
npm run test:integration
```

Remote test databases are rejected unless `ALLOW_REMOTE_TEST_DATABASE=yes` is
explicitly set. Never point this command at production.

## Data Operations

Read-only production/staging diagnostics live in
`scripts/sql/production-diagnostics.sql`. Run them on a restored staging copy
first. The SQL opens a repeatable-read, read-only transaction and rolls it back:

```bash
psql "$DIAGNOSTICS_DATABASE_URL" \
  --set ON_ERROR_STOP=on \
  --file scripts/sql/production-diagnostics.sql
```

Do not paste the expanded database URL into logs or committed scripts.

Shop admins can export CSV data from `/api/export/devices`, `/api/export/customers`, `/api/export/sales`, `/api/export/nasiya`, and `/api/export/logs`.

Validated customer imports are available through `POST /api/import/customers` with `{ "customers": [{ "name": "...", "phone": "..." }] }`.

## Demo Data

Use demo data only for a preview or demo database. It creates realistic Malika Bazar shops, customers, suppliers, inventory, sales, nasiya plans, payments, notifications, and logs.

```bash
SEED_DEMO_CONFIRM=yes npm run seed:demo
```

To replace previously seeded demo shops:

```bash
SEED_DEMO_CONFIRM=yes SEED_DEMO_RESET=yes npm run seed:demo
```

All generated demo shop admins use `Demo12345!` unless `SEED_DEMO_PASSWORD` is set.

Demo super admin:

```text
login: demo-admin
password: Demo12345!
```

## Database & Migrations

This project is **migration-managed**. Schema changes live in `prisma/migrations/`
and are applied with `prisma migrate deploy`.

### Rules

- **Use `npm run prisma:migrate:deploy` only.** Never run `prisma db push` or
  `prisma migrate dev` against a real (dev/QA/prod) database.
- **Why:** active-only uniqueness for device IMEI and customer phone is enforced
  by **raw-SQL partial unique indexes** (`... WHERE "deletedAt" IS NULL`) that
  Prisma cannot represent in `schema.prisma`. `db push` / `migrate dev` see them
  as drift and would **drop** them, silently removing dedup protection. These
  indexes are created in `prisma/migrations/202607020002_integrity_return_ledger`
  and must always be preserved.
- If unsure about a database's state, **use a fresh Supabase database for QA.**

#### Guarded scripts (enforced, not just documented)

`scripts/check-db-safety.mjs` inspects `DIRECT_URL`/`DATABASE_URL` and the
environment before any destructive Prisma command:

| Command | Behaviour |
| --- | --- |
| `npm run db:push` | **Always blocked** with a clear message. |
| `npm run db:push:local` | Allowed **only** when the DB host is `localhost`/`127.0.0.1`. Blocked for any remote/prod host or when `VERCEL`/`NODE_ENV=production` is set. |
| `npm run prisma:migrate:dev` | Blocked against a remote/prod DB; allowed for a local DB in dev. |
| `npm run prisma:migrate:deploy` | The one explicit way to apply migrations to a real DB. |

The **build never runs migrations**: `prebuild`/`postinstall` run only
`prisma generate`; Vercel's `buildCommand` is `npm run build` (= `next build`).
Production releases use the manually approved artifact-first workflow in
`.github/workflows/release-production.yml`: build first, apply a rehearsed
backward-compatible migration, then deploy the exact prebuilt artifact. See
`docs/operations/recovery-and-release-runbook.md`.

### Fresh database (recommended)

```bash
npm run prisma:migrate:deploy   # applies all migrations to an empty DB
SEED_SUPER_ADMIN_PASSWORD='...' npm run seed:super-admin
```

The search-performance migration enables `pg_trgm` and creates raw-SQL GIN
indexes for search screens. On a fresh or small QA database, `migrate deploy` is
fine. On a large existing production database, create those indexes with
`CREATE INDEX CONCURRENTLY` during a planned DB maintenance step instead,
because Prisma migrations run inside a transaction.

The super-admin seed is **idempotent** — re-running with the same login does not
create duplicates. By default it creates/updates two equal-permission logins:
`oryx_abdulloh` and `wxusan`. `SEED_SUPER_ADMIN_LOGIN`,
`SEED_SUPER_ADMIN_NAME`, `SEED_SUPER_ADMIN_2_LOGIN`, and
`SEED_SUPER_ADMIN_2_NAME` are optional (defaults shown in `.env.example`);
`SEED_SUPER_ADMIN_PASSWORD` is required and never defaulted.

### Existing / non-empty database (P3005)

If the target DB already has tables but **no** `_prisma_migrations` history
(e.g. it was created with `prisma db push` or by hand), `prisma migrate deploy`
fails with **P3005 "The database schema is not empty."** Baseline it carefully —
mark already-applied migrations as applied, in order, then deploy the rest:

```bash
# Only if the DB already matches these migrations. Verify first.
npx prisma migrate resolve --applied 202607010001_initial
npx prisma migrate resolve --applied 202607010002_global_shop_admin_login
npx prisma migrate resolve --applied 202607020001_super_admin_telegram
npx prisma migrate resolve --applied 202607020002_integrity_return_ledger
npm run prisma:migrate:deploy   # applies remaining migrations (e.g. cron indexes)
```

If you cannot confirm the DB matches, prefer a fresh database instead of guessing.

## Telegram integration

### Bot setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token into
   `TELEGRAM_BOT_TOKEN`.
2. Generate `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) and
   `CRON_SECRET` (used to authorize `/api/telegram/send` and `/api/cron/reminders`;
   `INTERNAL_API_SECRET` overrides it if set).
3. Register the webhook so Telegram can deliver `/start` to the app:

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://<your-domain>/api/telegram/webhook \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```

   The webhook route validates the `X-Telegram-Bot-Api-Secret-Token` header
   against `TELEGRAM_WEBHOOK_SECRET` before processing any update. **Inbound
   commands only work once the webhook is registered** — outbound notifications
   (sale/return/restock/nasiya/reminder) do not need a webhook.

### Linking an account

Enter the numeric Telegram ID in the admin/shop settings page, then send
`/start` to the bot from that Telegram account. The bot looks the ID up in both
the `SuperAdmin` and `ShopAdmin` tables (`findTelegramOwner`), stamps
`telegramVerifiedAt` if it was missing, and replies with a role/shop-specific
welcome. Unknown IDs get a "not linked" reply telling the user to check their
Telegram ID in the panel.

> There is **no `/link CODE` flow** — it was removed. See
> [docs/telegram-messages.md](docs/telegram-messages.md) for the full message
> catalog and the removed/future items.

> Note: manually entering an ID marks it verified immediately (so notifications
> start flowing without waiting for `/start`). The typed ID is trusted as-is —
> there is no reachability check at save time, so a typo could target a stranger.
> `/start` is the authoritative confirmation. See "Remaining risks" in the
> integration notes if you want to harden this to require `/start` before sends.

### Notification coverage

Telegram messages are sent to the shop's active, verified admins after:
device create · sell (cash/partial/later) · **return (Qaytarish)** ·
**restock (Sotuvga chiqarish)** · nasiya create · nasiya payment · sale payment.
Daily cron sends due-today and overdue reminders (nasiya + sale), deduped once
per Tashkent day per admin. Super admins do **not** receive shop-level events.

## Local QA Testing

### Trigger the reminder cron manually

`/api/cron/reminders` is protected — it requires the bearer secret and returns
401/503 otherwise. With the dev server running and `CRON_SECRET` set:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
# → { "reminders": n, "overdue": n, "saleReminders": n, "saleOverdue": n }
```

Overdue nasiya schedules keep alerting on each run (deduped once per Tashkent
day per admin), so running it on consecutive days re-notifies chronic debtors.

### Test Telegram without a public webhook

Telegram's webhook needs a public HTTPS URL, so it can't reach `localhost`.
For local QA you can still exercise delivery:

- Set `TELEGRAM_BOT_TOKEN` to a real bot and link an admin (enter the Telegram
  ID in settings, then send `/start`) so `telegramId` + `telegramVerifiedAt` are
  populated. Outbound sends (sale/return/restock/nasiya/payment/reminder) then
  reach that Telegram account directly — no inbound webhook required.
- To exercise event notifications, perform the action in the UI and watch the
  bot chat: add/sell a device, **click Qaytarish (return)**, then **Sotuvga
  chiqarish (restock)** on the returned device, create a nasiya, and record a
  nasiya/sale payment. Each produces one message to the shop's verified admins.
- To flush queued notifications on demand:
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/telegram/send`
- To exercise the inbound webhook (`/start`) locally, expose the dev
  server with a tunnel (e.g. `ngrok http 3000`) and register the webhook with
  `setWebhook` + `secret_token=$TELEGRAM_WEBHOOK_SECRET`. `/start` must welcome a
  linked user; if it stays silent, confirm the webhook is registered (inbound
  updates require `bot.init()`, which the route now performs automatically).

> Migrations are never run automatically during a Vercel build (see below). Run
> them deliberately with `npm run prisma:migrate:deploy`.

## Observability & Ops

- **Structured logging** — `src/lib/logger.ts` emits JSON logs in production
  (readable lines in dev) and **redacts** secrets (passwords, tokens, cookies,
  connection strings, Telegram bot tokens, signed storage URLs). Use it instead
  of `console.*` for operational logging.
- **OpsEvent table** — system health/failure telemetry, separate from the
  business audit `Log`. Written via `recordOpsEvent` for: cron start/complete/
  fail, notification cancellations after retries, notification/webhook/send
  failures. Never stores secrets or notification bodies (customer PII).
- **Health check** — `GET /api/health` is public and minimal: `ok`, `timestamp`,
  short `commit`, and a `database` probe. Returns `503` if the DB is unreachable.
- **Super-admin ops** — `GET /api/admin/ops` (super admin only) returns recent
  OpsEvents, level counts, the notification-queue breakdown, recent
  failed/cancelled notifications (no message bodies), and the last cron run. The
  UI lives at **`/admin/ops`** ("Tizim").
- Cron (`/api/cron/reminders`) records an OpsEvent when it starts, completes
  (with reminder/overdue/notification counts + `durationMs`), or fails.

## Vercel Deployment

Set the variables from `.env.example` in Vercel. Production must include
`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET` (or `AUTH_SECRET`), `NEXTAUTH_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`.

### Database URLs, region, and pool

- `DATABASE_URL`: use the Supabase **transaction pooler** URL for the app
  runtime, normally port `6543`.
- `DIRECT_URL`: use the non-pooled direct/session URL for migrations and seeds,
  normally port `5432`.
- `DATABASE_POOL_MAX`: per Vercel function instance pg-adapter pool size. Start
  at `5`; test `1` if you want a conservative baseline. The value is clamped in
  code from `1` to `20`.
- Capacity rule of thumb:
  `max concurrent Vercel instances × DATABASE_POOL_MAX <= Supabase pool size`.
  If you see connection saturation, lower `DATABASE_POOL_MAX` first.
- Put Vercel and Supabase in nearby regions when possible. The current Vercel
  build region shown in logs was Washington, D.C. (`iad1`), while the Supabase
  host shown earlier was `ap-south-1`; that distance adds latency to every DB
  round trip. Co-locating them is a deployment setting, not a code change.

**Migrations run automatically on `Production` builds only.** `vercel.json`'s
`buildCommand` is `if [ "$VERCEL_ENV" = "production" ]; then npx prisma migrate
deploy; fi && npm run build` — `VERCEL_ENV` is set by Vercel itself, so preview
deployments (which may point at the same shared database) never run
migrations, only the actual `Production` build does. This was previously a
fully manual step (see history), which meant migrations could silently go
un-applied for days if nobody remembered to run them — the schema and the
deployed code then drift apart with no build failure to signal it. You can
still run it manually against production out-of-band if needed:

```bash
# From a trusted environment pointed at the PRODUCTION database:
npm run prisma:migrate:deploy
```

Use `DIRECT_URL` (non-pooled) for migrations. Scope preview deployments to a
separate database if you want an extra layer of isolation beyond the
`VERCEL_ENV` gate above.

### Cron auth

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when the
`CRON_SECRET` environment variable is configured. `/api/cron/reminders` requires
that bearer token and returns 401/503 otherwise. External schedulers can also
trigger the route if they send the same header.

`vercel.json` schedules `/api/cron/reminders` at `35 6 * * *` UTC (once daily —
Vercel Hobby doesn't allow sub-daily cron), which is 11:35 in Asia/Tashkent,
five minutes after the 11:00–11:30 jitter window closes. See
`docs/cron-jobs.md`.
