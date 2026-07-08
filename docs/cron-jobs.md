# Cron Jobs

Oryx ERP runs one cron route. This is the operator reference for when it runs, what it does, and how to confirm it worked.

## `GET /api/cron/reminders`

| | |
|---|---|
| **Path** | `/api/cron/reminders` |
| **Source** | `src/app/api/cron/reminders/route.ts` |
| **Schedule (UTC)** | `*/10 * * * *` — every 10 minutes (`vercel.json`) |
| **Timezone for logic** | **Asia/Tashkent** (UTC+5, no DST) via `src/lib/timezone.ts` |
| **Auth** | `Authorization: Bearer <CRON_SECRET>` (required) |
| **Required env** | `CRON_SECRET`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, Supabase vars (for device photos) |
| **Max duration** | 60s |

### What it does

On every run (all steps are idempotent, so running every 10 min is safe):

1. **Generate due-today reminders** — `NasiyaSchedule` and `Sale` whose due date is today (Tashkent), still unpaid, `reminderEnabled = true`, ACTIVE shop. Upserts a `REMINDER` / `SALE_REMINDER` notification per verified admin (deduped by Tashkent day).
2. **Generate overdue alerts** — schedules/sales past due and still unpaid. Upserts `OVERDUE` / `SALE_OVERDUE` notifications, marks the schedule + parent nasiya `OVERDUE`, and busts that shop's caches **only when a real transition happened**.
3. **Generate early reminders ("Ertaroq eslatilsinmi?")** — `NasiyaSchedule` / `Sale` rows with `earlyReminderEnabled = true` and `reminderEnabled = true`, due in the next ~61 days. Upserts `EARLY_REMINDER` / `SALE_EARLY_REMINDER` only on the day that is exactly `earlyReminderDays` before the due date — the due-day reminder from step 1 still fires separately on the day itself.
4. **Drain the queue** — `processPendingNotifications()` sends every notification whose `scheduledAt` has arrived (immediate events + any planned reminders now inside their window).

### When messages actually go out (11:00 jitter)

Planned reminders are **not** sent the second they are generated. Each is scheduled at:

```
scheduledAt = 11:00 Asia/Tashkent (today) + deterministicJitter(dedupeKey)   // 0–29 min
```

so they spread across **11:00–11:30 Asia/Tashkent** instead of all firing at once. The jitter is deterministic (same reminder → same minute every run), so re-runs never move or duplicate a message. A cron run inside the window delivers them; with the 10-minute cadence, delivery lands in ~10-minute waves across 11:00–11:30.

- **Immediate** (sent within ~seconds, on the next drain): sale, nasiya, payment, nasiya completed, device added/returned/restocked, `/start` replies.
- **Planned around 11:00 Tashkent**: nasiya due-today, nasiya overdue, nasiya early reminder, sale due-today, sale overdue, sale early reminder.

Expected Tashkent send window for planned reminders: **11:00 → 11:29**.

> **Plan note:** finer-than-daily cron needs **Vercel Pro**. On a daily-only plan, point an external scheduler (e.g. cron-job.org) at this URL every 10 minutes with the `CRON_SECRET` bearer token; the endpoint is safe to call as often as you like.

### How to confirm it ran

- **Admin UI:** open **`/admin/ops`** (super admin). "Oxirgi cron" shows the last run time + counts; failures show in red. Queue counts show PENDING/SENT/FAILED/CANCELLED.
- **OpsEvents:** `cron.reminders.started` (INFO) at the start, `cron.reminders.completed` (INFO/WARN) at the end with metadata `{ reminders, overdue, saleReminders, saleOverdue, notificationsSent, notificationsSentWithImage, notificationsFailed, notificationsCancelled, overdueTransitions, durationMs }`, `cron.reminders.failed` (ERROR) on crash.
- **Failures:** filter `/admin/ops` for ERROR, or check `recentFailedNotifications` (type/status/attempts/lastError). A notification retries up to 5 times with backoff, then becomes `CANCELLED` and raises `notification.cancelled`.

### Manual test

```bash
# Local / against a deployment (must send the secret):
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/reminders"
# → {"reminders":N,"overdue":N,"saleReminders":N,"saleOverdue":N}
```

Without the header you get `401 Unauthorized`; if `CRON_SECRET` is unset the route returns `503`.

### Vercel config

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/reminders", "schedule": "*/10 * * * *" }]
}
```
