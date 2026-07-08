# Nasiya payment behavior scoring

Every nasiya gets a professional 0–100 payment-behavior score, computed by the
pure function `computeNasiyaPaymentScore` in
[`src/lib/nasiya-payment-score.ts`](../src/lib/nasiya-payment-score.ts). It is
NOT a simple 3-line rule — it weighs current overdue status, payment timing
history, consistency, and confidence (how much real history exists) before
ever labeling a client "green".

Shown as a colored badge on `/shop/nasiyalar` (next to the customer name, with
the `reason` as a tooltip) and as a score card on the nasiya detail page.

## Inputs

For each nasiya, every `NasiyaSchedule` row: `status`, `dueDate`,
`delayedUntil`, `expectedAmount`, `paidAmount`, `paidAt`.

**Imported (pre-Oryx) nasiyas need no special-casing.** `alreadyPaidBeforeImport`
is a lump sum recorded directly on the `Nasiya` row — it never creates a
`NasiyaSchedule` with `status: 'PAID'` and a real `paidAt`. Only genuine
payments made through the app (which do set `paidAt`) ever enter the timing
history, so old pre-Oryx debt can affect the *remaining amount* but never the
*payment behavior score*.

## Grace window

**1 day.** A schedule paid on or before `dueDate + 1 day` counts as on-time,
not late — enough to absorb same/next-day bank clearing without rewarding
real lateness. `daysEarlyLate = (paidAt - effectiveDueDate) / 1 day`:
`< 0` early, `0..1` on-time, `> 1` late.

`effectiveDueDate` is `delayedUntil ?? dueDate` — the same predicate the rest
of the app uses (`scheduleEffectiveDueTime` in `nasiya-utils.ts`), so an
agreed carry-over/defer is judged against its new date, not the original one.

## Formula

Baseline `score = 70`, then:

| Factor | Adjustment |
|---|---|
| Currently has an overdue unpaid schedule | `-35` |
| Each currently-overdue schedule | `-10`, capped at `-30` total |
| Average days early ≤ -2 | `+10` |
| Average days late 1–5 | `-10` |
| Average days late 5–10 | `-20` |
| Average days late > 10 | `-30` |
| Max lateness > 7 days | `-10` |
| Max lateness > 15 days | `-20` |
| Max lateness > 30 days | `-35` |
| On-time ratio ≥ 80% and ≥ 3 paid installments | `+15` |
| On-time ratio ≥ 60% and ≥ 2 paid installments | `+5` |
| On-time ratio < 50% | `-10` |
| Paid ratio > 70% and not currently overdue | `+5` |
| Paid ratio < 20% and at least one late payment | `-5` |

Clamped to `0..100`.

"Currently overdue" is computed from the exact same predicate the dashboard
and nasiyalar list use (`isScheduleOverdue` / `deriveNasiyaOverdue`), so the
score's red/overdue signal always agrees with the rest of the app. That
predicate is also rounding-tolerance-aware (`COMPLETION_ROUNDING_TOLERANCE_UZS`,
500 so'm — see `docs/nasiya-payment-allocation.md` §11): a schedule left with
only a few hundred so'm of cross-currency rounding dust is never treated as
"currently overdue", so a fully-paid nasiya can never show
"Hozir $X muddati o'tgan" once its real debt is gone. Once a nasiya is
COMPLETED, its score card is retitled "To'lov tarixi bahosi" in the UI so a
strong or weak historical score never reads as an active/current risk
signal — the underlying score/reason computation is unchanged either way.

## Confidence gating

Sample size gates how far the raw score can push the label — a single lucky
payment can never earn "Ishonchli mijoz":

| Paid installments | Rule |
|---|---|
| 0 | Gray ("Yangi mijoz") unless currently overdue (then red) |
| 1 | Capped at yellow/red — never green, regardless of score |
| 2 | Green only if score ≥ 80 **and** both payments were early/on-time |
| 3+ | Normal scoring — green possible at score ≥ 80 |

## Labels / colors / risk

| Condition | Color | Label | Risk |
|---|---|---|---|
| Currently overdue (always wins, overrides everything else) | Red | Kechiktiradi | HIGH |
| 0 paid installments, not overdue | Gray | Yangi mijoz | UNKNOWN |
| 1 paid installment, score ≥ 55 | Yellow | Vaqtida to'laydi | MEDIUM |
| 1 paid installment, score < 55 | Red | Kechiktiradi | HIGH |
| ≥ 2 paid installments, confidence-gated green eligible, score ≥ 80 | Green | Ishonchli mijoz | LOW |
| Otherwise, score ≥ 55 | Yellow | Vaqtida to'laydi | MEDIUM |
| Otherwise | Red | Kechiktiradi | HIGH |

## Examples

- **New client, no payments yet, nothing overdue** → gray, "Hali to'lov tarixi
  yetarli emas".
- **3 payments, all paid 2+ days early, no overdue** → score ~100 → green,
  "3 ta to'lovdan 3 tasi vaqtida".
- **1 payment paid 5 days late** → capped at yellow/red (never green) even
  though it's the only data point — "1 ta to'lovdan 1 tasi kechikkan (eng
  ko'pi 5 kun)".
- **Currently has an overdue unpaid schedule of 2,400,000 so'm**, even with a
  spotless history → red, "Hozir 2 400 000 so'm muddati o'tgan" in UZS mode,
  or "Hozir $195.65 muddati o'tgan" in USD mode (same underlying amount — see
  Currency below).
- **Completed nasiya with all on-time payments** → still green (the score
  only looks at schedule history, not the parent nasiya's terminal status).
- **Completed nasiya with several late payments** → yellow/red, not green.
- **Overpayment prepaying a future schedule** — if an earlier month's
  overpayment allocates enough to fully pay a later month before its own due
  date (see `docs/nasiya-payment-allocation.md`), that later schedule's
  `paidAt` (the payment date) is before its `dueDate`, so it counts as an
  **early payment** for that schedule exactly like a dedicated on-time
  payment would — it can improve the score, subject to the same confidence
  gates above. A currently overdue schedule elsewhere still overrides
  everything to red regardless of how well the prepaid schedule scores.

## Currency

`computeNasiyaPaymentScore` takes an optional third argument,
`currency: CurrencyContext` (defaults to UZS if omitted). The score, label,
color, and factors are always computed from raw UZS amounts and never change
with currency — **only the human-readable `reason` string's money formatting
does**, via the shared `formatMoneyByCurrency` (`src/lib/currency.ts`). The
literal string `"so'm"` is never hardcoded inside `nasiya-payment-score.ts`
itself. Both server call sites (`src/lib/server/shop-lists.ts` for the
nasiyalar list badge, and `src/app/api/nasiya/[id]/route.ts` for the detail
page's score card) fetch the shop's `CurrencyContext` and pass it through, so
the badge tooltip and the score card reason always match every other money
value on the same page.

## Notes

- Deterministic: same schedules + same `now`/`currency` always produce the
  same score (no randomness, no wall-clock side effects beyond the `now`
  parameter).
- Wording is kept professional/neutral in the UI — no harsh or shaming
  language, even for the red label.
