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
SEED_SUPER_ADMIN_PASSWORD='ChangeMe!123' npm run seed:super-admin   # one super admin (idempotent)
npm run dev
```

Open `http://localhost:3000`.

> Never run `prisma db push` on this project — it drops the migration-managed
> partial unique indexes. See [Database & Migrations](#database--migrations).

## Verification

```bash
npm run typecheck
npm run lint
npm run build
```

## Data Operations

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
email: demo.admin@oryx.local
password: Demo12345!
```

## Database & Migrations

This project is **migration-managed**. Schema changes live in `prisma/migrations/`
and are applied with `prisma migrate deploy`.

### Rules

- **Use `prisma migrate deploy` only.** Never run `prisma db push` or
  `prisma migrate dev` against a real (dev/QA/prod) database.
- **Why:** active-only uniqueness for device IMEI and customer phone is enforced
  by **raw-SQL partial unique indexes** (`... WHERE "deletedAt" IS NULL`) that
  Prisma cannot represent in `schema.prisma`. `db push` / `migrate dev` see them
  as drift and would **drop** them, silently removing dedup protection. These
  indexes are created in `prisma/migrations/202607020002_integrity_return_ledger`
  and must always be preserved.
- If unsure about a database's state, **use a fresh Supabase database for QA.**

### Fresh database (recommended)

```bash
npm run prisma:migrate:deploy   # applies all migrations to an empty DB
SEED_SUPER_ADMIN_PASSWORD='...' npm run seed:super-admin
```

The super-admin seed is **idempotent** — re-running with the same email does not
create duplicates. `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_NAME` are
optional (defaults shown in `.env.example`); `SEED_SUPER_ADMIN_PASSWORD` is
required and never defaulted.

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

- Set `TELEGRAM_BOT_TOKEN` to a real bot and link an admin (`/link <CODE>` in the
  bot) so `telegramId` + `telegramVerifiedAt` are populated. Outbound sends
  (sale/nasiya/payment/reminder) then reach that Telegram account directly —
  no inbound webhook required.
- To flush queued notifications on demand:
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/telegram/send`
- To exercise the inbound webhook (`/start`, `/link`) locally, expose the dev
  server with a tunnel (e.g. `ngrok http 3000`) and register the webhook with
  `setWebhook` + `secret_token=$TELEGRAM_WEBHOOK_SECRET`. Optional for QA.

> Migrations are never run automatically during a Vercel build (see below). Run
> them deliberately with `npm run prisma:migrate:deploy`.

## Vercel Deployment

Set the variables from `.env.example` in Vercel. Production must include
`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET` (or `AUTH_SECRET`), `NEXTAUTH_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`.

**Migrations are NOT run during the Vercel build.** `vercel.json` builds only
(`npm run build`) so that **preview deployments never mutate a shared/production
database.** Run migrations deliberately as a controlled production step:

```bash
# From a trusted environment pointed at the PRODUCTION database:
npm run prisma:migrate:deploy
```

Use `DIRECT_URL` (non-pooled) for migrations. Scope preview deployments to a
separate database, or run migrations only against production out-of-band.

### Cron auth

Vercel's built-in cron does **not** send an `Authorization` header, but
`/api/cron/reminders` requires `Authorization: Bearer <CRON_SECRET>` (it returns
401/503 otherwise). Either configure Vercel Cron to send the header, or trigger
the endpoint from an external scheduler (e.g. cron-job.org) that sends the
bearer token. Without this, reminders/overdue alerts will not run.
