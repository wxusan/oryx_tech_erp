# Telegram & Cron Audit

_Snapshot of every live Telegram message, its trigger, image behavior, privacy, and the cron that delivers scheduled ones. Updated alongside the "image notifications + jittered cron" change._

## How delivery works

Every business event writes a row to the `Notification` table (`type`, `message`, `telegramId`, `scheduledAt`, `relatedType`/`relatedId`, `dedupeKey`). A single processor — `processPendingNotifications()` in `src/lib/notification-service.ts` — drains due rows and delivers each via Telegram:

1. Resolve a **safe image** for the row (`resolveNotificationImageUrl`, send-time signed URL of the related device's first photo, or `null`).
2. `chooseTelegramDelivery` → **photo + caption** when an image exists and the caption ≤ 1024 chars, otherwise a plain **message**.
3. If a photo send fails, it retries once as a text message so the notification is never dropped.

Recipients are **always** filtered to active, non-deleted shop admins with a **verified** Telegram ID (`telegramVerifiedAt != null`). Unverified IDs never receive anything.

**Currency in Telegram text (deliberate, pre-existing convention — not changed by the currency-consistency fix):** every money value in a Telegram message goes through `telegramMoney()` → `formatMoneyWithBase()`. For a UZS shop this is a plain `"2 450 000 so'm"`. For a USD shop it is **`"$196.00 (~2 450 000 so'm)"`** — both currencies together, on purpose, because Telegram is an internal admin channel where the UZS reference is useful even when the shop displays USD in its UI. This is different from shop UI pages (`/shop/*`), which show **only** the shop's selected currency with no UZS reference — see `docs/nasiya-payment-allocation.md` §9 and `docs/nasiya-payment-scoring.md` for the UI-side rule. Do not "fix" the `$X (~Y so'm)` pattern in Telegram text; it is intentional and covered by `tests/currency.test.ts`.

## Message inventory

| # | Type | Template | Trigger | Immediate / Scheduled | Image now | relatedType |
|---|------|----------|---------|-----------------------|-----------|-------------|
| 1 | `DEVICE_CREATED` | `deviceAddedMessage` | Device added (`POST /api/devices`) | Immediate | Device photo → text | `Device` |
| 2 | `SALE` | `deviceSoldMessage` | Device sold (`.../sell`) | Immediate | Device photo → text | `Sale` |
| 3 | `NASIYA` | `nasiyaCreatedMessage` | Nasiya created (`.../nasiya`) | Immediate | Device photo → text | `Nasiya` |
| 4 | `NASIYA_IMPORTED` | `nasiyaImportedMessage` | Old nasiya import | Immediate | Device photo → text | `Nasiya` |
| 5 | `PAYMENT_RECEIVED` (nasiya) | `nasiyaPaymentMessage` | Nasiya payment — includes a per-schedule allocation breakdown line ("X joriy oy uchun yopildi" / "Y N-oyga oldindan qo'llandi") when the payment spans more than one schedule (overpayment) | Immediate | Device photo → text | `NasiyaSchedule` / `Nasiya` |
| 6 | `PAYMENT_RECEIVED` (sale) | `salePaymentMessage` | Sale debt payment | Immediate | Device photo → text | `Sale` |
| 7 | `RETURN` | `deviceReturnedMessage` | Device returned | Immediate | Device photo → text | `DeviceReturn` |
| 8 | `RESTOCK` | `deviceRestockedMessage` | Device restocked | Immediate | Device photo → text | `Device` |
| 9 | `REMINDER` | `nasiyaDueTodayMessage` | Nasiya schedule due today | **Scheduled 11:00–11:30** | Device photo → text | `NasiyaSchedule` |
| 10 | `OVERDUE` | `nasiyaOverdueMessage` | Nasiya schedule overdue | **Scheduled 11:00–11:30** | Device photo → text | `NasiyaSchedule` |
| 11 | `SALE_REMINDER` | `saleDueTodayMessage` | Sale debt due today | **Scheduled 11:00–11:30** | Device photo → text | `Sale` |
| 12 | `SALE_OVERDUE` | `saleOverdueMessage` | Sale debt overdue | **Scheduled 11:00–11:30** | Device photo → text | `Sale` |
| 13 | `EARLY_REMINDER` | `nasiyaEarlyReminderMessage` | Nasiya schedule due in N days ("Ertaroq eslatilsinmi?") | **Scheduled 11:00–11:30** | Device photo → text | `NasiyaSchedule` |
| 14 | `SALE_EARLY_REMINDER` | `saleEarlyReminderMessage` | Later-payment sale due in N days ("Ertaroq eslatilsinmi?") | **Scheduled 11:00–11:30** | Device photo → text | `Sale` |
| 15 | `NASIYA_COMPLETED` | `nasiyaCompletedMessage` | Nasiya's last schedule fully paid (status → COMPLETED) | Immediate | Device photo → text | `Nasiya` |
| 16 | `OLIB_SOTDIM_CREATED` | `olibSotdimCreatedMessage` | Olib-sotdim operation saved (`POST /api/olib-sotdim`) | Immediate | Device photo → text | `Sale` |
| 17 | `SUPPLIER_PAYABLE_REMINDER` | `supplierPayableDueTodayMessage` | Supplier payable due today | **Scheduled 11:00–11:30** | Device photo → text | `SupplierPayable` |
| 18 | `SUPPLIER_PAYABLE_OVERDUE` | `supplierPayableOverdueMessage` | Supplier payable overdue | **Scheduled 11:00–11:30** | Device photo → text | `SupplierPayable` |
| 19 | `SUPPLIER_PAYABLE_EARLY_REMINDER` | `supplierPayableEarlyReminderMessage` | Supplier payable due in N days ("Ertaroq eslatilsinmi?") | **Scheduled 11:00–11:30** | Device photo → text | `SupplierPayable` |
| 20 | `SUPPLIER_PAYABLE_PAID` | `supplierPayablePaidMessage` | Supplier payable marked paid (`PATCH /api/olib-sotdim/[id]/pay`) | Immediate | Device photo → text | `SupplierPayable` |
| 21 | Bot `/start` replies | `startSuperAdminMessage` / `startShopAdminMessage` / `startUnknownMessage` / `unknownCommandMessage` | Telegram webhook | Immediate (direct reply) | None (no device context) | — |

"Device photo → text" = attaches the related device's first photo as a short-lived signed URL when one exists; otherwise sends the message as text.

## What image is attached

- **Device-related messages (1–20):** the related **device's first photo** (`Device.imageUrls[0]`), signed at send time (10-min TTL). Resolved via the `relatedType`/`relatedId` on the notification — `SupplierPayable` resolves through its linked `Device.imageUrls`, same as every other case.
- **No device photo:** falls back to a plain text message. (No branded default raster assets are shipped — see _Limitations_.)
- **Bot `/start` replies (21):** text only; there is no device/entity context and an image would add nothing.

## Privacy

- Only `Device.imageUrls` are ever attached. **Passport / customer document images are never referenced** by the resolver, and a regex guard rejects any key that is not under `shops/<shopId>/devices/`.
- The image is a **short-lived signed URL** generated at send time — no permanent/public private URL is ever stored or sent.
- The signed URL is passed as the **photo argument only**, never embedded in the caption. Message bodies remain free of URLs/IDs/secrets (enforced by `tests/telegram.test.ts`).
- `recordOpsEvent` metadata and logs never include signed URLs or message bodies.

## Cron

- **Route:** `GET /api/cron/reminders` (`src/app/api/cron/reminders/route.ts`).
- **Auth:** requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it automatically). Returns 401 without it, 503 if the secret is unconfigured.
- **Schedule:** `35 6 * * *` (once daily, 06:35 UTC = 11:35 Tashkent) — see `vercel.json`. This project is on the Vercel **Hobby** plan, which rejects sub-daily cron schedules at deploy time; a `*/10 * * * *` schedule caused every deployment to fail its "Vercel" GitHub check for 3 days before this was caught and fixed. See `docs/cron-jobs.md` for the full explanation and the Pro/external-scheduler alternative.
- **Timezone:** all day/window math is **Asia/Tashkent** (`src/lib/timezone.ts`, UTC+5, no DST). Never uses server-local time.
- **What it processes:** `NasiyaSchedule` (due today / overdue), `Sale` (due today / overdue), and `SupplierPayable` (due today / overdue — "Olib-sotdim" supplier debt) for ACTIVE shops with `reminderEnabled = true`, then drains the whole notification queue.
- **Idempotency:** each reminder row has a `dedupeKey` = `TYPE:<TashkentDay>:<telegramId>:<entityId>` with a unique constraint, so repeated runs never duplicate. OVERDUE status writes are idempotent, and cache busts fire only on real transitions.
- **Scheduled send time:** planned reminders get `scheduledAt = 11:00 Asia/Tashkent + deterministic jitter (0–29 min)` (`scheduledReminderSendAt`). The drain only sends rows whose `scheduledAt` has arrived. With the once-daily 11:35 cron run, the whole 11:00–11:30 window has already elapsed by run time, so all of a day's reminders deliver together at ~11:35 rather than in real-time waves — the per-notification jitter value is still computed and stored either way, so nothing needs to change if the cron cadence is later increased.
- **Early reminders ("Ertaroq eslatilsinmi?"):** an opt-in extra reminder N days before a nasiya schedule's or later-payment sale's due date, IN ADDITION to (not instead of) the due-day reminder above. Set per-nasiya/per-sale via `earlyReminderEnabled` + `earlyReminderDays` (1–60). The cron fetches unpaid schedules/sales due in the next ~61 days (bounded), then in JS computes `daysUntil` (via `tashkentDayRange` on the due date) and only creates a notification when it exactly equals `earlyReminderDays` — so it fires once, on the correct day, per schedule. Dedupe keys `EARLY_REMINDER:<day>:<telegramId>:<scheduleId>` / `SALE_EARLY_REMINDER:<day>:<telegramId>:<saleId>` make re-runs idempotent. If the early date has already passed when the feature is turned on, it's silently skipped (no backfill) — the due-day reminder is unaffected.

## Ops visibility

`/admin/ops` (super admin) already shows: last cron run + metadata (`reminders`, `overdue`, `saleReminders`, `saleOverdue`, `notificationsSent`, `notificationsSentWithImage`, `notificationsFailed`, `notificationsCancelled`, `overdueTransitions`, `durationMs`), last cron failure, notification queue counts (PENDING/PROCESSING/SENT/FAILED/CANCELLED), and recent failed/cancelled notifications. Cron start/complete/fail are recorded as `cron.reminders.started` / `.completed` / `.failed` OpsEvents. See `docs/cron-jobs.md`.

## Risks / limitations

1. **No branded default raster assets.** Telegram `sendPhoto` needs a raster (JPEG/PNG) image, and the repo ships no branded PNG. Rather than commit low-quality placeholder binaries, messages without a device photo remain text. Recommendation: add real branded PNGs (`default-device`, `default-sale`, …) to a public bucket and extend `resolveNotificationImageUrl` to fall back to them per `type`.
2. **Running on Vercel Hobby: cron is once daily (06:35 UTC / 11:35 Tashkent), not every 10 minutes.** Sub-daily cron requires Vercel Pro, or an external scheduler (e.g. cron-job.org) hitting the endpoint every ~10 min with `CRON_SECRET` — the route is idempotent and safe to call as often as desired. Documented in `docs/cron-jobs.md`.
3. **Per-notification image lookup.** Delivery does one device lookup + one signed-URL call per row (bounded by the 100-row batch). Fine at Malika Bazar volume; batch-resolve if volume grows.
