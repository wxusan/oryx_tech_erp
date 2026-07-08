# Nasiya payment allocation

## 1. Why allocation exists

A nasiya's debt lives in two places: the parent `Nasiya.remainingAmount` (a
single running total) and per-month `NasiyaSchedule` rows (`expectedAmount`,
`paidAmount`, `status`). A payment must update **both** consistently — if a
client overpays this month, the extra must reduce a *specific future
schedule's* remaining balance, not just the parent total. Otherwise reminders,
the schedule table, and the payment score would all keep expecting the full
original monthly amount even though part of it was already prepaid.

## 2. Chronological allocation rule

`POST /api/nasiya/[id]/payment` (`src/app/api/nasiya/[id]/payment/route.ts`)
allocates one payment across schedule rows in a single serializable
transaction:

1. The schedule the admin selected in the payment modal (defaults to the
   earliest unpaid one — see below) is allocated first.
2. Any leftover amount then flows into the remaining unpaid schedules
   (`PENDING`/`PARTIAL`/`OVERDUE`/`DEFERRED`), **sorted by effective due date**
   (`delayedUntil ?? dueDate`, then `monthNumber`) — oldest first.
3. Each schedule receives `min(remainingPayment, outstandingForThatSchedule)`,
   updates its own `paidAmount`/`status`/`paidAt`, and the loop continues until
   the payment is exhausted.

The payment modal's schedule picker defaults to the earliest unpaid
installment (`firstPending`, sorted by `monthNumber`), so in the common case
— the admin just accepts the default and enters an amount — this already
satisfies "oldest overdue first, then current, then future" exactly. An admin
can still deliberately select a *different* month (e.g. to reconcile a
specific historical installment); the overflow from that payment still lands
on the next unpaid schedules in date order.

## 3. Overpayment example

Monthly payment 500 000 so'm, 5 months, all unpaid. Client pays 600 000 so'm
against month 1:

| Month | Before | Payment | After |
|---|---|---|---|
| 1 | 500 000 due, 0 paid | 500 000 | **PAID** |
| 2 | 500 000 due, 0 paid | 100 000 | **PARTIAL** — 100 000 paid, 400 000 remaining |
| 3–5 | unchanged | 0 | unchanged |

Total remaining drops by the full 600 000. Month 2's own `expectedAmount`
never changes — its *outstanding balance* (`expectedAmount - paidAmount`) is
what reminders and the schedule table read, so month 2 now correctly shows
400 000 owed, not 500 000.

A payment spanning 3+ months (e.g. 1,300,000 so'm on a 500,000/month plan)
allocates the same way: month 1 and 2 fully paid, month 3 gets 300,000 with
200,000 remaining.

## 4. Overdue-first

If an earlier month is overdue and unpaid, selecting it (or accepting the
default earliest-unpaid selection) means the overdue amount is paid before
any overflow reaches the current/future month — the allocation loop always
processes the selected schedule, then strictly the rest in due-date order, so
a later month can never absorb payment while an earlier one the admin
selected/defaulted-to remains unpaid within the same request.

## 5. Final-overpayment validation

A payment may never exceed the nasiya's total outstanding balance across all
unpaid schedules:

```ts
if (amountUzs > totalOutstanding) {
  throw { status: 409, message: "To'lov qolgan nasiya summasidan oshib ketdi" }
}
```

The payment modal mirrors this client-side (before the request is even sent)
by comparing the typed amount, converted to UZS, against the nasiya's
`remainingAmount`, showing "To'lov summasi qolgan qarzdan oshmasligi kerak."
and disabling Save — the server check remains the source of truth.

## 6. Reminder behavior

Cron reminders (`src/app/api/cron/reminders/route.ts`) read
`outstandingAmount(schedule.expectedAmount, schedule.paidAmount)` per
schedule — never the flat monthly amount — so a partially-prepaid month's
due-today/overdue reminder already shows the *remaining* balance (e.g. 400,000
after a 100,000 prepayment), and a fully-prepaid month is excluded entirely
(its `status` becomes `PAID`, which the due-today/overdue queries never
select).

## 7. Payment score behavior

`computeNasiyaPaymentScore` (`src/lib/nasiya-payment-score.ts`) looks at
`schedule.status === 'PAID' && schedule.paidAt` regardless of *why* a
schedule reached PAID — a schedule paid off early via overflow from an
earlier month's overpayment has `paidAt` = the payment date and `dueDate` =
its own future due date, so `paidAt < dueDate` and it counts as an **early
payment**, improving the score exactly like a dedicated on-time payment
would. A currently-overdue schedule still overrides everything to red,
and the confidence gates (0/1/2/3+ payments) are unaffected. See
`docs/nasiya-payment-scoring.md`.

## 8. Telegram behavior

`nasiyaPaymentMessage` accepts an optional `allocations: { monthNumber,
amount }[]`. When a payment spans more than one schedule, the message adds a
line per allocation:

```
💰 Nasiya to'lovi qabul qilindi
...
To'langan: 600 000 so'm
Qolgan qarz: 1 900 000 so'm
500 000 so'm joriy oy uchun yopildi
100 000 so'm 2-oyga oldindan qo'llandi
```

A single-schedule payment shows no breakdown (unchanged from before). Photo
attachment, verified-recipient filtering, and the passport-image exclusion
are all unchanged (same centralized notification pipeline as every other
message — see `docs/telegram-cron-audit.md`).

## 9. Currency behavior

DB storage is always UZS. Every UI/Telegram surface that shows a money value
derived from this flow — the payment modal's "Jami qolgan qarz" line, the
overpayment explanation, the payment score reason, and the Telegram
breakdown — uses the shop's selected display currency via the shared
`formatMoneyByCurrency` (`src/lib/currency.ts`), never a hardcoded "so'm".
See the "Currency consistency" section below.

## 10. "Izoh" is optional

The payment modal's note field is **optional** for a regular payment — there
is no minimum length and no required-field star. Only the carry-over/defer
flow ("Mijoz bu oy to'lamadi, muddatni uzaytirish") still requires a short
reason, since that changes the debt schedule itself rather than just
recording a routine payment. `addNasiyaPaymentSchema` (`src/lib/validations.ts`)
enforces this: the blanket "note must be ≥5 chars" refine was removed; only
the defer-specific refine (`!deferredToNext || note.length >= 5`) remains.
An empty note is stored as `null`/omitted everywhere — the payment history
table, "Amallar tarixi", and Telegram all render the event cleanly without a
note line rather than a broken empty one (`optionalLine()` /
conditional-render, not a fallback placeholder string).

## 11. Rounding tolerance and completion detection

**Root cause of a fully-paid nasiya staying "Faol":** the payment modal's
"Tavsiya" (pay-the-full-remaining-amount) button converts the true UZS
balance to USD (rounded to cents) for display, and that USD amount is
converted back to UZS on submit — a round trip that can undershoot the true
remaining balance by up to roughly a cent's worth of UZS. The nasiya then sits
with a few-hundred-so'm balance forever, even though every card on screen
already rounds to $0.00 / reads as fully paid.

**Fix:** `COMPLETION_ROUNDING_TOLERANCE_UZS = 500` (`src/lib/nasiya-utils.ts`)
— a schedule's outstanding balance (`scheduleOutstanding()`) snaps to 0 once
it's this close to fully paid. 500 so'm is a few US cents at typical rates,
far below any real amount a customer would still owe. This one helper is the
single source of truth consumed by:
- `isScheduleOverdue()` / `deriveNasiyaOverdue()` — so overdue detection,
  the nasiyalar list's displayStatus, and the payment score's
  "currently overdue" signal never treat rounding dust as real debt.
- `isNasiyaEffectivelyComplete()` — a nasiya whose every schedule is within
  tolerance is treated as COMPLETED for **display** purposes even before its
  stored `status` column is updated (self-heals a nasiya stuck showing
  "Faol" purely from past rounding dust, immediately, with no data
  migration — the moment its list row or detail page is next rendered).
- The payment route's own completion check (`allFullyPaid`), which also
  **snaps** a schedule's stored `paidAmount` up to its exact `expectedAmount`
  when a new payment brings it within tolerance, so the ledger doesn't
  dangle a few-hundred-so'm remainder forever, and snaps the nasiya's stored
  `remainingAmount` to exactly 0 once effectively complete (clean in UZS-mode
  display too, not just USD's rounding-away-the-dust).
- `scheduleDisplayStatus()` — a schedule row within tolerance displays "To'landi"
  even if its stored `status` is still a stale `PARTIAL` from before this fix.

**Self-heal on read:** `GET /api/nasiya/[id]` computes the same derivation
server-side and, if it finds a nasiya that's effectively complete but whose
stored `status` isn't `COMPLETED` yet, opportunistically persists the
correction in the background (`after()`, never blocks the response) — so
simply opening the affected nasiya's detail page repairs its `status` column
for good (which matters beyond display: `shop-stats.ts`'s active-nasiya count
reads the raw column directly).

**Blocking further payment:** once a nasiya's stored status is `COMPLETED`,
`POST /api/nasiya/[id]/payment` rejects any further attempt immediately with
`"Bu nasiya yakunlangan"` (409) — checked before any allocation logic runs.
A nasiya that's effectively-but-not-yet-formally complete is still caught by
the existing per-schedule "already fully paid" check for the same effect.
