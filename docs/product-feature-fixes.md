# Product feature fixes — batch pass

Date: 2026-07-09. Scope: 17-item product/UX/reminder/search/logs/payment
batch requested before client demo/onboarding. This is a large batch —
several items are fully implemented, several are implemented with a
deliberately scoped-down (but real, working) foundation, and a few are
documented as deferred with an exact reason and next step rather than
silently skipped or faked, per the ticket's explicit instruction.

> **Update (follow-up pass, same day)**: items 2, 9, 10, and 13 below were
> DEFERRED at the end of this pass. A follow-up ticket picked them back up —
> see `docs/remaining-deferred-items-followup.md` for the full resolution
> (item 9 turned out to already be built in an earlier, unrelated commit;
> items 2, 10, 13 were implemented from scratch with tests). Item 1's
> hisobot month-selection gap was also closed in that same follow-up pass.
> The rows below are left as-is for history; each has a short "Resolved" note.

## Item-by-item table

| Item | Requirement | What was implemented | Files changed | Tests | Status |
|---|---|---|---|---|---|
| 1 | Stats sorted by month/admin | Logs page (real per-action admin attribution via `Log.actorId`) gained an admin filter dropdown, built from real seen actors, never invented. Month-range filtering already existed on the logs page (`from`/`to`). The `/shop/hisobot` dashboard itself is hardcoded to the current month in `shop-stats.ts` (a heavily-tested, business-critical accounting engine) — adding true month-selection there is a larger, riskier change than fits this pass | `src/app/api/logs/route.ts`, `src/app/(shop)/shop/logs/logs-client.tsx` | `tests/logs-admin-filter.guard.test.ts` (4) | **PARTIAL** (at the time) — admin filter done; hisobot month-selection deferred (see below). **Resolved in the follow-up pass** — `getShopStats` now takes an optional `{ monthKey, adminId }`, `/shop/hisobot` has a real month selector + admin filter with an explicit non-attribution note. See `docs/remaining-deferred-items-followup.md` item 8 |
| 2 | Telegram payment reminders (3-day/due-day/daily overdue) + portal toast | **Not implemented this pass.** Audited: the reminder cron (`src/app/api/cron/reminders/route.ts`) already sends a due-day and a daily-overdue Telegram reminder with dedupe keys, jitter, and Tashkent-timezone date math (confirmed correct in an earlier audit pass this project). A 3-day-before reminder and a portal-visible toast/banner (persistent until paid) do not exist yet. Building the portal toast requires a new notification-state UI system (nothing currently renders a persistent "unpaid" banner in the shop portal); extending the cron for a 3-day-before window is more contained but still touches the same business-critical, heavily-tested reminder engine. Given the size and risk of both pieces together, this was not attempted blind in this already very large pass | — | — | **DEFERRED at the time.** **Resolved in the follow-up pass**: the pre-existing per-deal `earlyReminderDays` cron logic was extracted to tested pure functions (`tashkentDaysUntil`/`matchesEarlyReminderDay`), and a persistent shop-wide overdue banner now lives in the shop layout. See `docs/remaining-deferred-items-followup.md` items 9 and 10 |
| 3 | Phone auto-998 prefix | `applyPhonePrefix()` pure function + a `<PhoneInput>` component wrapping it; swapped in on customer/nasiya/sale/olib-sotdim phone fields | `src/lib/phone.ts`, `src/components/ui/phone-input.tsx`, `sotuv/new`, `nasiyalar/new`, `olib-sotdim/new`, `mijozlar` pages | `tests/phone.test.ts` (+14) | **DONE** |
| 4 | Additional phone numbers everywhere | `Customer.additionalPhones String[]` (additive migration); `normalizeAdditionalPhones()` helper; wired into `/api/customers/[id]` PATCH + the mijozlar edit modal (add/remove extra numbers); search matches additional phones too (see item 7/14) | `prisma/schema.prisma`, migration `202607090001_product_feature_fixes`, `src/lib/phone.ts`, `src/app/api/customers/[id]/route.ts`, `src/app/(shop)/shop/mijozlar/page.tsx` | `tests/phone.test.ts` (+6) | **DONE** — no dedicated customer detail page exists in this app (confirmed), so "customer profile" additional-phone display is the same edit modal, not a separate page |
| 5 | Old price read-only, Sotilish narxi renamed + empty + bold | Nasiya/cash-sale creation forms no longer prefill the selling price from the device's own purchase price; purchase price now shown as a separate read-only "Kelish narxi" reference; "Jami narxi" renamed to "Sotilish narxi" everywhere (creation form + nasiya detail summary card); selling-price input is bold | `nasiyalar/new/page.tsx`, `nasiyalar/[id]/page.tsx`, `sotuv/new/page.tsx` | `tests/price-ui-labels.guard.test.ts` (10), 4 existing guard tests updated for the new (intentional) behavior | **DONE** |
| 6 | Monthly payment change recalculates foiz | `calculateNasiyaAmountsFromMonthlyPayment()` — exact reverse of the existing forward formula; nasiya creation form's "Oylik to'lov" field is now editable (was read-only) and drives interest when used; server route mirrors the same reverse calc via an explicit `useMonthlyPaymentOverride` flag so client preview and stored values never drift | `src/lib/nasiya-utils.ts`, `src/lib/validations.ts`, `src/app/api/devices/[id]/nasiya/route.ts`, `nasiyalar/new/page.tsx` | `tests/nasiya-utils.test.ts` (+9), `tests/nasiya-monthly-payment-override.guard.test.ts` (8) | **DONE** |
| 7 | Search by comment/izoh everywhere | Client-side matchers (`matchesDeviceSearch`/`matchesNasiyaSearch`) already searched `note`; server-side `/api/customers`, `/api/devices`, `/api/nasiya` GET routes were missing a `note` clause — added | `src/app/api/customers/route.ts`, `src/app/api/devices/route.ts`, `src/app/api/nasiya/route.ts` | `tests/search-comment-name-coverage.guard.test.ts` (8) | **DONE** for devices/nasiya/customers (the three list surfaces with a search box). Sale/olib-sotdim payment history and logs already search their own note fields (confirmed, no gap) |
| 8 | Log click opens sale/nasiya profile | `GET /api/logs/[id]/link` resolves a log's targetType+targetId to a shop-scoped href (Device→qurilmalar profile, Nasiya/NasiyaSchedule→nasiyalar profile via parent lookup, Sale→ device profile via parent lookup, SupplierPayable→olib-sotdim list). Logs page rows are clickable for these types; a missing target or no-detail-page type (Customer, Shop, account, ...) resolves to `null` and does nothing rather than crashing | `src/app/api/logs/[id]/link/route.ts` (new), `src/app/(shop)/shop/logs/logs-client.tsx` | `tests/log-click-navigation.guard.test.ts` (10) | **DONE** — Customer has no detail page in this app, so a Customer-target log row is intentionally non-clickable (documented, not a bug) |
| 9 | Images to Telegram bot | **Not implemented this pass.** Audited: `notification-service.ts`/Telegram send path currently sends text-only messages via Grammy's `bot.api.sendMessage`; adding image support (`sendPhoto`) safely requires: resolving a signed/short-lived URL for the device's private-storage image (same pattern as `/api/uploads/device`), a fallback to text-only on any image-send failure (must never block or roll back the underlying sale/payment), and auditing every message call site to ensure passport/customer images are never eligible. This is a real, contained feature but touches the shared notification pipeline used by every message type in this app — not attempted blind in this pass | — | — | **DEFERRED at the time — but was WRONG.** The follow-up pass discovered this was already fully built in an earlier, unrelated commit (`88978e9`, before this doc was even written): `chooseTelegramDelivery`, `resolveNotificationImageUrl` (device-only, signed 10-min URL, never passport), `sendTelegramPhoto`, all wired into `processPendingNotifications`, with existing test coverage (`tests/telegram-delivery.test.ts`, `tests/telegram-images.guard.test.ts`). See `docs/remaining-deferred-items-followup.md` item 11 for full evidence |
| 10 | Nasiya client rating system | **Not implemented this pass.** Designed but not built: a shop-scoped, explainable trust score computed from real behavior (completed on-time nasiyas, current overdue amount, max days late, active nasiya count) — deliberately NOT a raw badge, and NOT overrated from a single payment. This needs a new pure scoring function (safe to add) plus new UI surfaces on 3 pages (customer profile equivalent, nasiya creation, nasiya detail) — a genuinely new feature, not a bug fix, and the scoring thresholds are a product decision worth a dedicated pass with the user rather than an invented cutoff buried in a 17-item batch | — | — | **DEFERRED at the time.** **Resolved in the follow-up pass**: `src/lib/nasiya-customer-trust.ts` — 5-tier system (Yangi mijoz / Past ishonch / O'rtacha ishonch / Ishonchli / Juda ishonchli), explainable `reasons[]`, optional admin override, shown on the mijozlar list/edit dialog, nasiya creation form, and nasiya detail page. See `docs/remaining-deferred-items-followup.md` item 12 |
| 11 | Logs: nasiya vs nasiya to'lovlari separated | New `nasiya_payment` and `supplier_payment` log categories, split out of the old overloaded `nasiya`/`payment` buckets (also fixed a pre-existing mismatch where `SupplierPayable` logs were miscategorized against the actual filter). `NASIYA_DEFER` correctly stays under "Nasiya" (a nasiya-management action, not a payment) despite sharing `NasiyaSchedule` as its target type | `src/lib/log-categories.ts` | `tests/log-categories.test.ts` (rewritten, 10) | **DONE** |
| 12 | Split payment (half cash, half card) | `SalePayment.paymentBreakdown`/`NasiyaPayment.paymentBreakdown`/`SupplierPayable.paymentBreakdown` (additive JSON columns); `validatePaymentBreakdown`/`representativePaymentMethod` pure helpers; wired into both sale and nasiya payment API routes (validates sum-equals-total, stores the breakdown, keeps the legacy `paymentMethod` enum populated with a representative value so no existing reader breaks); Telegram messages show the breakdown when present; payment-history tables show it; **UI built for the nasiya payment modal** (checkbox + second-method selector, second amount auto-computed) | `prisma/schema.prisma`, `src/lib/payment-breakdown.ts` (new), `src/lib/validations.ts`, `src/app/api/sales/[id]/payment/route.ts`, `src/app/api/nasiya/[id]/payment/route.ts`, `src/lib/telegram-templates.ts`, `src/components/shop/nasiya-payment-modal.tsx`, `nasiyalar/[id]/page.tsx`, `qurilmalar/[id]/page.tsx` | `tests/payment-breakdown.test.ts` (9), `tests/split-payment.guard.test.ts` (16) | **DONE for nasiya payments at the time; PARTIAL for sale payments.** **Resolved in the follow-up pass** — the sale-payment modal on the device detail page now has the same split-payment checkbox + second-method UI as the nasiya modal. Reports-by-method aggregation is still not built (documented future work, per the ticket's own escape hatch) |
| 13 | Telegram message design improvement | **Not implemented this pass** beyond the split-payment breakdown line added to `salePaymentMessage`/`nasiyaPaymentMessage` as part of item 12. A full design pass across all 8 message templates (sale/nasiya/reminder/overdue/supplier/olib-sotdim/device-added) was audited briefly — the existing templates already use a consistent `compose()`/`block()`/`optionalLine()` builder with contract-currency-aware money formatting (confirmed clean in earlier audit passes) — but a genuine "make it look nicer" pass (spacing, emoji use, section ordering) is a subjective design task better done as its own reviewable change than bundled invisibly into this batch | `src/lib/telegram-templates.ts` (split-payment line only) | (see item 12 tests) | **PARTIAL at the time.** **Resolved in the follow-up pass**: audited every template's money/URL/Uzbek-wording consistency (confirmed already clean — no changes needed there) and closed the one real content gap found, a missing profit ("Foyda") line on `deviceSoldMessage`, wired from the sell route via `computeSaleContractMargin`. A full stylistic rewrite of every template's emoji/label/layout was deliberately NOT done — see `docs/remaining-deferred-items-followup.md` item 14 for the reasoning |
| 14 | Search by name everywhere | Nasiya search already matched customer name; device search (both client matcher and `/api/devices`) was missing sold-to customer name — added | `src/lib/search-match.ts`, `src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx`, `src/app/api/devices/route.ts` | `tests/search-match.test.ts` (+2), `tests/search-comment-name-coverage.guard.test.ts` (name assertions) | **DONE** |
| 15 | SOLD_NASIYA device profile currency bug | **Root cause found and fixed**: `GET /api/devices/[id]` never selected the Nasiya's contract-currency fields at all — the device detail page's nasiya card read only the legacy UZS ledger through a single-currency formatter, so a USD-native nasiya showed stuck in so'm. Fixed by selecting the contract fields and switching every money value + the profit calculation to the same contract-currency-aware pattern already used for Sale on the same page | `src/app/api/devices/[id]/route.ts`, `src/app/(shop)/shop/qurilmalar/[id]/page.tsx` | `tests/device-nasiya-currency-fix.guard.test.ts` (8), `tests/sold-device-profit.test.ts` (updated) | **DONE** |
| 16 | Receive nasiya payment from device profile | Device detail page now shows a "To'lov qabul qilish" button (only while the nasiya is ACTIVE/OVERDUE) that opens the exact same shared `NasiyaPaymentModal` used by the nasiya list/detail pages — no payment logic duplicated | `src/app/(shop)/shop/qurilmalar/[id]/page.tsx` | `tests/device-nasiya-currency-fix.guard.test.ts` (button-visibility assertions) | **DONE** |
| 17 | Tavsiya button visibility | The recommended-payment-amount button inside the nasiya payment modal was plain gray underlined text with no border/background — easy to miss, especially on mobile. Changed to a visible bordered/backgrounded chip, same click behavior | `src/components/shop/nasiya-payment-modal.tsx` | `tests/nasiya-payment-tavsiya-button.guard.test.ts` (2) | **DONE** |

## Item 2: exact next step (Telegram reminders + portal toast)

1. Confirm the existing cron (`src/app/api/cron/reminders/route.ts`) already
   sends due-day + daily-overdue reminders correctly (already true today).
2. Add a 3-day-before window: one more `Notification` dedupe key
   (`3day-<scheduleId>-<date>`) alongside the existing due-day/overdue keys,
   gated by the schedule's own `earlyReminderEnabled`/`earlyReminderDays` if
   the shop wants a different lead time than 3 days (the fields already
   exist on Nasiya/Sale).
3. Portal toast: needs a small new "unresolved reminders" query (schedules
   currently due/overdue for the logged-in shop admin's shop) plus a
   persistent banner/toast component rendered in the shop layout — reuses
   the exact same `deriveNasiyaOverdue`/`scheduleDisplayStatus` predicates
   already used elsewhere, so no new business logic, just a new UI surface
   and a `dismissedUntilPaid` semantics (never dismissible except by paying).
4. Manual test: mark a schedule paid from both the shop panel and the super
   admin panel; confirm both the cron reminder and the portal toast stop.

## Item 9: exact next step (Telegram images)

1. Extend `notification-service.ts`'s send path to accept an optional image
   key/URL alongside the text message.
2. Resolve a short-lived signed URL for the device's FIRST `imageUrls[0]`
   entry (same signed-URL pattern as `/api/uploads/device`'s GET handler) —
   never a passport or customer image (those live in a different storage
   path and must be explicitly excluded by an allowlist check, not just "not
   sent by omission").
3. Call Grammy's `bot.api.sendPhoto(telegramId, url, { caption: message })`
   instead of `sendMessage`; on ANY failure (network, invalid image, rate
   limit), catch and fall back to `sendMessage(telegramId, message)` — the
   underlying sale/payment must never roll back or block on a Telegram
   image failure (already true for the text-only path today; must stay true).
4. Apply to: device sold message, nasiya created message (both have a clear
   "this device" context); skip payment/reminder messages (no natural
   single-image context, and would need a new "is this worth the image"
   product decision).

## Item 10: exact next step (Nasiya client rating)

This needs a product decision before implementation, not just an engineer's
guess at thresholds:
1. Confirm the rating buckets and their exact Uzbek labels with the user
   (the ticket suggests 5 buckets; either English-style UNKNOWN/LOW/MEDIUM/
   GOOD/HIGH or Uzbek Yangi/Past/O'rtacha/Ishonchli/Juda ishonchli — pick one).
2. Implement as a **pure, shop-scoped computed function** (no new schema) —
   inputs: count of completed nasiyas, on-time vs. late count, current
   overdue amount, max days late ever recorded, active nasiya count — output:
   bucket + a list of reason strings (e.g. "3 ta nasiya vaqtida to'langan",
   "hozircha 1 ta muddati o'tgan to'lov bor"). A brand-new customer with zero
   history must default to the lowest/"new" bucket, never anything higher,
   even after one on-time payment (explicit ticket requirement).
3. Surface it as a small badge + "why" tooltip on: the mijozlar edit modal,
   the nasiya creation form's customer-lookup step, and the nasiya detail
   page header (next to the existing status badge).
4. Add tests for every rule (new customer = lowest bucket; one payment ≠
   high trust; overdue reduces the bucket; repeated late payments reduce it;
   reasons are always non-empty).

## Item 13: exact next step (Telegram message design)

1. Get explicit visual/tone direction from the user (which messages feel
   cluttered today, preferred emoji density, whether Uzbek wording should
   change) — this is a subjective design pass, not a bug fix, and doing it
   invisibly inside a 17-item functional batch risks the user not noticing
   or being able to review the change on its own.
2. Once direction is given: add Telegram-text snapshot tests (the ticket's
   own requirement) for every template in `src/lib/telegram-templates.ts`
   BEFORE changing formatting, so the "before" state is locked in and every
   change is a reviewable diff.

## Deferred items and whether they block the demo

None of items 2, 9, 10, or 13's deferred scope blocks a client demo:
- Item 2: the cron ALREADY sends due-day and daily-overdue Telegram
  reminders correctly (confirmed by reading the existing route, not
  changed this pass) — only the 3-day-early reminder and the portal toast
  are missing, both "nice to have earlier warning," not "reminders don't
  work."
- Item 9: text-only Telegram messages already show full device/customer/
  amount context — an image is a polish improvement, not a missing
  capability.
- Item 10: no rating exists today either; this batch doesn't make anything
  worse, it just doesn't add the new feature yet.
- Item 13: the existing message templates are already correct and
  currency-safe (confirmed, not touched this pass) — only their visual
  polish is deferred.

## Docs updated

- `docs/currency-accounting-model.md` — no changes; none of this pass's
  currency-accounting invariants changed (item 15's fix made the device
  detail page START correctly reading the ALREADY-existing contract-currency
  fields — it did not change what those fields mean or how they're computed).
- `docs/audits/dashboard-stat-formulas.md` — no changes; the accrual/cash
  formulas were not touched this pass (item 1's admin filter is a Logs-page
  feature, not a hisobot formula change).
- `docs/telegram-notifications.md` — did not exist; not created this pass,
  since items 2/9/13 (the Telegram-touching items) were deferred rather than
  implemented. Creating this doc now, before any of that lands, would
  describe a system that doesn't fully exist yet.

**Follow-up pass update**: `docs/telegram-notifications.md` now exists (see
that file), `docs/currency-accounting-model.md` gained a new §24 (the nasiya
allocation rate-drift fix), and `docs/remaining-deferred-items-followup.md`
is the authoritative record of what changed after this doc was written.
