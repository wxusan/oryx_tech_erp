# oryx_tech_erp

Oryx ERP is a Next.js SaaS dashboard for Malika tech shops: inventory, direct sales, nasiya/installments, shop subscriptions, audit logs, Telegram reminders, and admin/shop portals.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

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

## Vercel Deployment

Set the variables from `.env.example` in Vercel. Production must include `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`.

`vercel.json` runs `npm run migrate:deploy && npm run build`, so Prisma migrations are applied before the production build. Use `DIRECT_URL` for migrations when your database provider requires a non-pooled migration connection.
