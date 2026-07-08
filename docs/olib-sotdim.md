# Olib-sotdim ("source and flip") workflow

A common bazaar pattern: a customer asks for a device the shop doesn't have in
stock. The shop gets it from another nearby shop/person, sells it to the
customer immediately, and settles with the external supplier now or later.

## 1. What this workflow means

Quick action **"Olib-sotdim"** on `/shop/yangi-operatsiya` → guided form at
`/shop/olib-sotdim/new`. In one submit it records:
- the device (model/IMEI/color/storage/battery/condition/photo/note),
- who it was sourced from ("kimdan olindi": name/phone/location/note),
- who it was sold to (customer, looked up or created exactly like the normal
  sale flow),
- the buy price (supplier) and sell price (customer), and
- whether the supplier was paid immediately or later (with an optional
  reminder + early reminder).

## 2. Difference from a normal inventory sale

A normal sale is two separate steps: add the device to stock
(`POST /api/devices`, status `IN_STOCK`), then sell it later
(`POST /api/devices/[id]/sell`). Olib-sotdim is **one atomic operation**
(`POST /api/olib-sotdim`) that creates the `Device` **directly as
`SOLD_CASH`** — it never passes through `IN_STOCK`, so it:
- never shows up in the "Naqd sotish" / "Nasiyaga berish" device pickers,
- never enters `inventoryPurchaseCost` (that stat only sums
  `IN_STOCK`/`RESERVED` devices — see `shop-stats.ts`),
- can only return to stock through the existing, explicit
  Return → Restock flow (same as any other sold device) — never implicitly.

`Device.isExternalSourced = true` marks it for reporting/UI clarity.
`Device.condition` is a new optional field (generally useful, not
olib-sotdim-specific).

## 3. Data recorded

Reuses existing tables so reporting works for free:
- **`Device`** — the sourced device (`isExternalSourced: true`, `purchasePrice`
  = what we paid the supplier).
- **`Customer`** — looked up by phone/normalizedPhone or created, same as
  `/api/devices/[id]/sell`.
- **`Sale`** — the customer-facing sale (`salePrice`, `paidFully`/
  `amountPaid`/`remainingAmount`/`dueDate`/`reminderEnabled` — identical shape
  to a normal cash sale, so existing sale-payment, sold-devices, and profit UI
  all work unchanged).
- **`SupplierPayable`** (new model) — what **we** owe the external supplier.
  Deliberately free-text (`supplierName`/`supplierPhone`/`supplierLocation`/
  `supplierNote`) rather than the formal `Supplier` model, which represents a
  registered long-term inventory supplier tied to `Device.supplierId` — an
  ad-hoc bazaar contact for a one-off flip is a different concept and
  shouldn't pollute that list.

**Customer debt (`Sale.remainingAmount`) and supplier debt
(`SupplierPayable`) are two separate tables and never mixed.**

## 4. Supplier paid now vs. pay later

- **Paid now**: `SupplierPayable.status = PAID` immediately, `paidAt` +
  `paymentMethod` stamped from the form. No reminders.
- **Pay later**: `status = PENDING`, `dueDate` required, `reminderEnabled`
  defaults true, optional `earlyReminderEnabled` + `earlyReminderDays` (1–60,
  same "Ertaroq eslatilsinmi?" mechanism as nasiya/sale). Marking it paid later
  (`PATCH /api/olib-sotdim/[id]/pay`) flips it to `PAID` — the cron reminder
  queries only select `PENDING`/`OVERDUE` rows, so reminders stop the instant
  it's marked paid, with no separate cancellation step.

## 5. Reminder behavior

Mirrors the nasiya/sale early-reminder cron blocks exactly (see
`docs/cron-jobs.md`): due-today reminder, overdue alert (flips status to
`OVERDUE`), and an optional early reminder N days before, all planned/jittered
and delivered by the same once-daily 11:35 Asia/Tashkent cron run.

## 6. Telegram behavior

Every message includes the device photo when available (same
`resolveNotificationImageUrl` pipeline — a `SupplierPayable` case was added
that resolves through its linked `Device.imageUrls`), falling back to text.
Never attaches passport/private customer images. Messages:
- `OLIB_SOTDIM_CREATED` — immediate, on save.
- `SUPPLIER_PAYABLE_REMINDER` / `SUPPLIER_PAYABLE_OVERDUE` /
  `SUPPLIER_PAYABLE_EARLY_REMINDER` — planned, cron-delivered. Wording is
  explicitly "yetkazib beruvchiga to'lov" (payment TO the supplier) so it can
  never be mistaken for a customer payment reminder.
- `SUPPLIER_PAYABLE_PAID` — immediate, when marked paid.

## 7. Reporting behavior

No changes needed to `shop-stats.ts`. Because olib-sotdim creates a real
`Sale` row joined to a real `Device.purchasePrice`, this month's revenue, cost,
and profit already include it exactly like a normal cash sale
(`cashSalesThisMonth` scans `Sale` joined to `device.purchasePrice`). Because
the device is never `IN_STOCK`, it's automatically excluded from
`inventoryPurchaseCost` — no double-counting. An unpaid `SupplierPayable`
represents a liability ("Yetkazib beruvchiga qarz") tracked on its own list at
`/shop/olib-sotdim`, deliberately not folded into the existing debt/report
totals (which are customer-owes-us figures) to avoid conflating the two
directions of money.

## 8. Device lifecycle behavior

`IN_STOCK` is never reached. Created as `SOLD_CASH` → can be `RETURNED` via
the existing return flow → can be explicitly restocked to `IN_STOCK` via the
existing restock flow, same as any other sold device. No olib-sotdim-specific
lifecycle branching.

## 9. Example

Customer wants an iPhone 13 Pro. Shop doesn't have one. Owner buys one from
"Ali aka, 21-do'kon" for 6,500,000 so'm, sells it to the customer for
7,500,000 so'm on the spot, and agrees to pay Ali aka in 5 days.
- `Device` created: model "iPhone 13 Pro", `purchasePrice` 6,500,000,
  `status` SOLD_CASH, `isExternalSourced` true.
- `Sale` created: `salePrice` 7,500,000, `paidFully` true.
- `SupplierPayable` created: `amount` 6,500,000, `status` PENDING, `dueDate`
  +5 days, `reminderEnabled` true.
- Telegram: "🔄 Olib-sotdim: yangi operatsiya" sent immediately, showing
  "Kutilayotgan foyda: 1 000 000 so'm (yetkazib beruvchiga hali to'lanmagan)".
- 5 days later (cron, 11:35 Tashkent): "⏰ Eslatma: yetkazib beruvchiga
  to'lov" sent. Owner pays Ali aka, marks the payable paid in
  `/shop/olib-sotdim` → "✅ Yetkazib beruvchiga to'lov qilindi" sent, profit
  is now realized.
