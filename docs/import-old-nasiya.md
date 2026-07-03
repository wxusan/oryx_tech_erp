# Importing existing (pre-Oryx) nasiyas

Shops that sold on installment **before** using Oryx already have running
nasiyas: the customer bought a device, paid some money, and still owes the rest.
This feature imports **only the remaining debt and future payments** — it is
**not** a new sale.

## Golden rule

> An imported old nasiya is **existing debt**, not a new sale.
> The original sale and the money paid before import happened *before* Oryx, so
> they must **never** count as this month's gross, income, or profit.

## Manual import (available now)

Nasiyalar page → **“+ Eski nasiya kiritish”** → `/shop/nasiyalar/import`.

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `customerName`, `customerPhone` | ✅ | Customer (found/created by normalized phone, shop-scoped) |
| `deviceModel` | ✅ | Device model |
| `imei`, `storage`, `color`, `batteryHealth` | optional | Device details. If IMEI is blank a unique `IMPORT-xxxx` placeholder is stored (the active-IMEI unique index can't hold duplicate blanks); it is omitted from messages |
| `originalTotalAmount` | ✅ | **Informational.** Full original price of the old sale. Never counted as current gross/profit |
| `alreadyPaidBeforeImport` | default 0 | **Informational.** Money paid before import. Never counted as current income; **no `NasiyaPayment` row is created for it** |
| `remainingDebt` | ✅ (>0) | Debt still owed at import. Drives the future schedule and receivables |
| `monthlyPayment` | ✅ (>0) | Agreed monthly instalment |
| `nextPaymentDate` | ✅ | Due date of the first future instalment |
| `originalSaleDate`, `totalMonths`, `importNote` | optional | Extra context |

The form shows a live preview (number of future months, first/last dates, last
instalment amount) and a **“Bu yangi sotuv emas.”** warning before submit.

## What happens on import (`POST /api/nasiya/import`)

Inside one transaction:
1. Find/create the **Customer** by normalized phone (same shop only).
2. Create a **Device** as `SOLD_NASIYA`, `isImported=true`, `purchasePrice=0` —
   so it never enters sellable stock or inventory-cost stats.
3. Create a **Nasiya** with `isImported=true`, `importSource='MANUAL'`,
   `importedAt`, `importedById`, and the informational amounts. The tracked debt
   (`finalNasiyaAmount`, `remainingAmount`) equals `remainingDebt`.
4. Generate **future-only** `NasiyaSchedule` rows (see below).
5. Write an **audit Log** (`IMPORT_NASIYA`).
6. Invalidate caches and queue an **“Eski nasiya import qilindi”** Telegram
   message (never “Yangi nasiya”).

No `Sale` row and no `NasiyaPayment` for already-paid money are created.

## Schedule generation

```
count = ceil(remainingDebt / monthlyPayment)
every instalment = monthlyPayment, EXCEPT the last = remainder
due dates start at nextPaymentDate, +1 month each
all instalments unpaid (paidAmount = 0)
```

The schedule always sums **exactly** to `remainingDebt`. If `nextPaymentDate` is
already in the past, the shared overdue derivation marks it overdue everywhere
(dashboard, list, detail) — same logic as normal nasiyas.

## Accounting rules

**Counted (real, current):**
- `remainingDebt` → active receivable / debt (expected-this-month + overdue).
- Overdue imported schedules → overdue totals.
- **Payments collected after import** → real collected money by payment date,
  exactly like a normal nasiya payment; they reduce the remaining debt.

**NOT counted (informational only):**
- `originalTotalAmount` → **not** current-month gross or new-sale revenue.
- `alreadyPaidBeforeImport` → **not** current-month income or today's cash.
- Old product margin → **not** current profit.
- Imported device → **not** in sellable stock or inventory cost, **not** in the
  device count.

Enforced in `src/lib/server/shop-stats.ts`: the created-this-month nasiya query
(which feeds gross/interest/profit) filters `isImported: false`.

### Example

```
Original old nasiya:        5,200,000
Already paid before import: 1,500,000
Remaining debt:             3,700,000
Monthly payment:              740,000
```

Oryx:
- shows **3,700,000** as active remaining debt and builds 5 future instalments,
- does **not** add 5,200,000 to this month's gross,
- does **not** add 1,500,000 to this month's income,
- counts only future payments (after import) as collected money.

## Reporting limitations (MVP)

- There is no separate "historical/imported profit" report yet; imported old
  profit is simply excluded from current profit.
- Exports include `isImported`, `importSource`, `originalTotalAmount`,
  `alreadyPaidBeforeImport`, `remainingAtImport`, `importedAt`,
  `originalSaleDate` so imported rows are never mistaken for new sales.

## Excel import — Phase 2 (planned, not yet implemented)

Bulk import for 100+ old nasiyas. Deferred until it can be done safely with
preview + row-level validation; manual import covers the common case now.

**Planned flow:** download template → fill → upload → **preview with row-level
errors** → confirm → import.

**Columns:** `customerName`, `customerPhone`, `deviceModel`, `imei`, `storage`,
`color`, `batteryHealth`, `originalSaleDate`, `originalTotalAmount`,
`alreadyPaidBeforeImport`, `remainingDebt`, `monthlyPayment`, `nextPaymentDate`,
`note`.

**Validation:** duplicate active IMEI rejected, invalid phones/dates rejected,
`remainingDebt > 0`, `monthlyPayment > 0`. Nothing is imported until the user
confirms the preview. Import mode (all-or-nothing vs. valid-rows-only) to be
decided and documented when built; **all-or-nothing** is recommended for
accounting safety.
