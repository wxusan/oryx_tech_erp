# Cron Jobs

Oryx ERP runs one cron route. This is the operator reference for when it runs, what it does, and how to confirm it worked.

## `GET /api/cron/reminders`

| | |
|---|---|
| **Path** | `/api/cron/reminders` |
| **Source** | `src/app/api/cron/reminders/route.ts` |
| **Schedule (UTC)** | `35 6 * * *` — once daily, 06:35 UTC = **11:35 Asia/Tashkent** (`vercel.json`) |
| **Timezone for logic** | **Asia/Tashkent** (UTC+5, no DST) via `src/lib/timezone.ts` |
| **Auth** | `Authorization: Bearer <CRON_SECRET>` (required) |
| **Required env** | `CRON_SECRET`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, Supabase vars (for device photos) |
| **Max duration** | 60s |

> **Why once daily, not every 10 minutes:** this project runs on the Vercel **Hobby** plan, which only allows cron jobs to run at most once per day — a `*/10 * * * *` schedule fails Vercel's deploy-time validation (every push since it was introduced showed a failed "Vercel" GitHub check, and production silently kept serving the previous build). The single daily run is deliberately scheduled at 11:35 Tashkent, five minutes after the 11:00–11:30 jitter window closes, so every reminder generated and jittered for that day has already reached its `scheduledAt` and gets delivered in this one run. If sub-daily delivery is ever needed, upgrade to Vercel Pro and switch back to `*/10 * * * *`, or point an external scheduler (e.g. cron-job.org) at this URL every 10 minutes with the `CRON_SECRET` bearer token — the endpoint is idempotent and safe to call as often as you like.

### What it does

On every run (idempotent — safe to call more often than the schedule if needed):

1. **Generate due reminders** — `NasiyaSchedule` and `Sale` whose due date belongs to the durable generation window, still unpaid, `reminderEnabled = true`, ACTIVE shop. Normally the window is the current Tashkent day; after a missed/failed run it expands from the last completed boundary through today. Upserts a `REMINDER` / `SALE_REMINDER` notification per verified admin, keyed to the original due day.
2. **Generate overdue alerts** — schedules/sales past due and still unpaid. Upserts `OVERDUE` / `SALE_OVERDUE` notifications, marks the schedule + parent nasiya `OVERDUE`, and busts that shop's caches **only when a real transition happened**.
3. **Generate early reminders ("Ertaroq eslatilsinmi?")** — `NasiyaSchedule` / `Sale` rows with `earlyReminderEnabled = true` and `reminderEnabled = true`, due in the next ~61 days. The trigger day is computed as `due day - earlyReminderDays`; a catch-up window includes missed trigger days while the debt is still future-due. The due-day reminder from step 1 still fires separately.
4. **Supplier payable reminders ("Olib-sotdim")** — same due-today / overdue / early-reminder pattern as steps 1–3, on the `SupplierPayable` table (money we owe an external supplier). Upserts `SUPPLIER_PAYABLE_REMINDER` / `SUPPLIER_PAYABLE_OVERDUE` / `SUPPLIER_PAYABLE_EARLY_REMINDER`; marking a payable paid (`status = PAID`) removes it from every one of these queries, so reminders stop immediately with no separate cleanup. See `docs/olib-sotdim.md`.
5. **Drain the queue** — `processPendingNotifications()` atomically claims and sends due notifications in bounded batches (100 rows, concurrency 5, at most 5 batches / 8 seconds per invocation). A non-empty due/retry/processing remainder makes the cron response non-green instead of falsely reporting success.

### Outage and high-volume recovery

- `ReminderGenerationState` is the authoritative watermark (migration `202607130004_reminder_generation_watermark`). `OpsEvent` remains telemetry only.
- The nine generation phases (nasiya/sale/supplier × due/overdue/early) use stable-ID keyset pages of 100 rows. After each fully processed page the phase and cursor are committed; a timeout resumes after that cursor. If a page is interrupted before its checkpoint, it is safely repeated because notification writes use unique dedupe keys and overdue transitions are idempotent.
- A 55-second database lease prevents overlapping cron/external-scheduler invocations from racing the watermark. A busy invocation still drains the delivery queue and returns `503`/partial so monitoring does not show a false green run.
- Generation yields after a 40-second budget to leave time for Telegram delivery and cleanup. A partial page run releases its lease but retains phase/cursor. If a resumed stale window completes but still ends before the current-day boundary, the response also stays partial (with the old window complete) so monitoring requests another invocation instead of showing a false green. The next authorized invocation resumes or opens the following window; with the Hobby daily schedule that can be the following day, so operators who see `reminderGeneration.status = partial` should rerun the endpoint or use an external scheduler for faster recovery.
- The current Tashkent day is deliberately rescanned on repeated same-day calls. Dedupe keys make that safe and it catches debts created after an earlier run.

### When messages actually go out (11:00 jitter)

Planned reminders are **not** sent the second they are generated. Each is scheduled at:

```
scheduledAt = 11:00 Asia/Tashkent (today) + deterministicJitter(dedupeKey)   // 0–29 min
```

so they spread across **11:00–11:30 Asia/Tashkent** in theory. In practice, with the single daily 11:35 run (see the plan note above), every jittered `scheduledAt` in that window has already passed by the time the run fires, so all of that day's reminders go out together at ~11:35 rather than in real 10-minute waves. The jitter computation itself is unchanged (still deterministic and still recorded per-notification) so re-enabling a finer cadence later requires no code change — only the `vercel.json` schedule.

- **Immediate** (sent within ~seconds, via the `after()` hook on the mutating request itself — not dependent on cron): sale, nasiya, payment, nasiya completed, olib-sotdim created, supplier payable paid, device added/returned/restocked, `/start` replies.
- **Planned, generated and delivered by the once-daily 11:35 Tashkent cron run**: nasiya due-today, nasiya overdue, nasiya early reminder, sale due-today, sale overdue, sale early reminder, supplier payable due-today, supplier payable overdue, supplier payable early reminder.

### How to confirm it ran

- **Admin UI:** open **`/admin/ops`** (super admin). "Oxirgi cron" shows the last run time + counts; failures show in red. Queue counts show PENDING/SENT/FAILED/CANCELLED.
- **OpsEvents:** `cron.reminders.started` (INFO) at the start, `cron.reminders.completed` (INFO/WARN) at the end with reminder/delivery counts plus `generationStatus`, `generationPhase`, `generationCursor`, `generationWindowStart`, `generationWindowEnd`, `generationRowsProcessed`, queue remainder counts, and `durationMs`; `cron.reminders.failed` (ERROR) on crash.
- **Failures:** filter `/admin/ops` for ERROR, or check `recentFailedNotifications` (type/status/attempts/lastError). A notification retries up to 5 times with backoff, then becomes `CANCELLED` and raises `notification.cancelled`.

### Manual test

```bash
# Local / against a deployment (must send the secret):
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/reminders"
# → {"reminders":N,...,"reminderGeneration":{"status":"complete",...},"notificationDelivery":{"ok":true,...}}
```

Without the header you get `401 Unauthorized`; if `CRON_SECRET` is unset the route returns `503`. A `503` from an authorized call means generation or delivery is still partial/busy and must be retried; a queue-level crash returns `500`.

### Vercel config

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/reminders", "schedule": "35 6 * * *" }]
}
```
