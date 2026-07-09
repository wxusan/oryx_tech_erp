# Telegram notifications

## Architecture

1. **Templates** (`src/lib/telegram-templates.ts`) — pure functions, no DB
   access, no Markdown (messages are sent as plain text — `parse_mode` is
   never set, so literal `*`/`_` would render as-is). Every template uses
   the same small builder helpers: `compose()`/`block()`/`optionalLine()`
   for consistent spacing, `formatMoney`/`telegramMoney`/
   `formatContractMoneyWithDisplay`/`formatNativeAmount` for consistent,
   currency-aware money formatting, and `formatPaymentMethod`/
   `formatPaymentBreakdown` for payment-method wording. Never include a raw
   URL, DB id, or passport reference — enforced by
   `tests/telegram.guard.test.ts`'s "item 14" describe block.

2. **Queueing** (`Notification` model + `src/lib/notification-service.ts`)
   — API routes create a `Notification` row (shop-scoped, one per
   recipient admin) inside the same transaction as the business action, then
   call `processPendingNotifications()` via `after()` (Next.js — runs after
   the response is sent, non-blocking). A Telegram send failure never rolls
   back or blocks the underlying sale/payment/nasiya action.

3. **Delivery** (`src/lib/telegram.ts` + `src/lib/telegram-delivery.ts` +
   `src/lib/server/notification-image.ts`) — `chooseTelegramDelivery({
   imageUrl, caption })` picks `sendTelegramPhoto` when an image URL is
   available AND the caption fits Telegram's 1024-char photo-caption limit,
   otherwise falls back to `sendTelegramMessage` (plain text, no length
   limit issue). `resolveNotificationImageUrl(notification)` resolves a
   **device** image only — it switches on `notification.relatedType` (one
   of `Device`/`Sale`/`DeviceReturn`/`Nasiya`/`NasiyaSchedule`/
   `SupplierPayable`), looks up that record's linked Device, and only signs
   a URL if the storage key matches `/^shops\/[^/]+\/devices\/[^/]+$/` — a
   passport photo lives under a different path and can never match. The
   signed URL is short-lived (10 minutes) and any resolution failure returns
   `null` (falls back to text), never throws. `sendTelegramPhoto` itself is
   wrapped so an actual Telegram API failure (bad URL, rate limit, etc.)
   also falls back to `sendTelegramMessage` — a `sentWithImage` counter
   tracks how often the photo path actually succeeds.

4. **Cron reminders** (`src/app/api/cron/reminders/route.ts`) — three
   reminder classes per deal type (Nasiya schedule, Sale, SupplierPayable):
   due-today, overdue (daily), and early (N days before, opt-in per deal via
   `earlyReminderEnabled`/`earlyReminderDays`). Day-math is centralized in
   `src/lib/timezone.ts`'s `tashkentDaysUntil`/`matchesEarlyReminderDay` (Tashkent
   calendar-day comparison, not raw millisecond difference — a payment due
   late in its Tashkent day and "now" early in Tashkent's day still compare
   as the same number of whole days apart). Every reminder type has its own
   `Notification.upsert`-by-dedupe-key (never `.create`), so re-running the
   cron never double-sends. Send times are jittered (`scheduledReminderSendAt`)
   so all of a shop's reminders don't fire in the exact same second.

## Split-payment breakdown

`salePaymentMessage`/`nasiyaPaymentMessage`/`deviceSoldMessage` accept an
optional `paymentBreakdown?: { method, amount }[]`. When present (a split
cash+card payment), the "To'lov usuli" line renders
`formatPaymentBreakdown()` — e.g. `Naqd: 250 000 so'm, Karta: 250 000 so'm`
— instead of the single-method label. Never both at once.

## Portal banner (not Telegram, but the other half of "reminders")

`src/components/shop/due-overdue-banner.tsx` — a persistent, shop-wide
banner (not a Telegram message) shown in the shop layout whenever the shop
has any currently-overdue nasiya schedule or sale. See
`docs/remaining-deferred-items-followup.md` item 10 for the design
rationale (no dismiss button — "persistent until paid" — and links directly
to the one overdue deal when there is exactly one, otherwise to the
filtered nasiyalar list).

## Rate limiting on notification-triggering routes

Every route that creates a `Notification` also goes through
`checkRateLimitDistributed` (`src/lib/rate-limit-adapter.ts`) before doing
any work — see `docs/rate-limiting.md`. This bounds how fast a single
admin can trigger new Telegram sends, independent of Telegram's own rate
limits.

## Where to look when adding a new notification type

1. Add a pure template function to `telegram-templates.ts` (reuse
   `compose()`/`block()`/`optionalLine()`, format all money through the
   shared helpers, never embed a URL/passport reference).
2. Add a guard test asserting the new function exists and formats money via
   the shared helpers (follow the pattern in `tests/telegram.test.ts` /
   `tests/telegram.guard.test.ts`).
3. If the new type has a natural device image, add its `relatedType` case to
   `resolveNotificationImageUrl` in `notification-image.ts` — never add a
   customer/passport case there.
4. Queue it via `notifyShopAdmins`/`prisma.notification.create` inside the
   same transaction as the business action, and flush with
   `after(() => processPendingNotifications())`.
