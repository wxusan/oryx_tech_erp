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

## Vercel Deployment

Set the variables from `.env.example` in Vercel. Production must include `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`.

`vercel.json` runs `npm run migrate:deploy && npm run build`, so Prisma migrations are applied before the production build. Use `DIRECT_URL` for migrations when your database provider requires a non-pooled migration connection.
