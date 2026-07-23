# Olib-sotdim Nasiya and Qarzlar — implementation plan

Status: implemented and verified on the feature branch; production remains unchanged until an authorized release.

Date: 2026-07-20

Owners: product, engineering, QA, and release owner

## 1. Outcome

This work adds two related capabilities without changing the behavior of the existing standalone Nasiya feature:

1. Olib-sotdim becomes a two-outcome workflow:
   - Sotuv: keeps the current full, partial, and Pay Later sale behavior.
   - Nasiya: uses the existing Nasiya inputs, calculation rules, schedule generation, customer requirements, payment allocation, and protections.
2. A new Qarzlar area separates:
   - Bizning qarzlarimiz: money the shop owes suppliers for devices acquired Pay Later.
   - Bizga qarzlar: money customers owe the shop through ordinary Sale Pay Later only, never Nasiya.

The shop can also acquire a normal inventory device Pay Later. That creates a supplier liability even though there is no customer sale yet.

Both supplier and customer debts remain open after partial payment and close only when their remaining balance reaches zero. Payments may use one method or exactly two different methods in a split payment.

The new behavior must preserve the existing production performance, permission, tenant-isolation, audit, idempotency, currency, notification, and release contracts.

## 2. Product decisions that remove ambiguity

These decisions are part of the implementation contract:

1. Olib-sotdim contains two separate choices:
   - Customer outcome: Sotuv or Nasiya.
   - Supplier settlement: Hozir to‘landi or Keyin to‘lash.
2. Selecting Sotuv preserves the current Olib-sotdim customer payment modes:
   - To‘liq.
   - Qisman.
   - Keyin to‘lash.
3. Selecting Nasiya renders the same business inputs and produces the same calculation result as standalone Nasiya:
   - customer selection or creation;
   - required customer identity fields;
   - sale price;
   - down payment;
   - months;
   - interest or monthly-payment override;
   - start date;
   - payment method;
   - early-reminder settings;
   - generated payment schedule and review.
4. Existing standalone Nasiya calculations, dashboard figures, report figures, pages, and payment allocation behavior are not redefined. Shared code may be extracted only with parity tests proving unchanged behavior.
5. Bizga qarzlar contains open ordinary Sale balances only. It excludes every Nasiya contract and Nasiya schedule.
6. Bizning qarzlarimiz contains supplier liabilities created by:
   - Olib-sotdim with supplier settlement set to Keyin to‘lash;
   - normal inventory device creation with acquisition settlement set to Keyin to‘lash.
7. A supplier liability never prevents the device from being stocked, sold, or put on Nasiya. Paying the liability closes the shop’s debt; it does not change device ownership or lifecycle state.
8. A device return or customer-sale cancellation does not silently cancel the supplier liability. Those are separate financial relationships. Any future supplier release or write-off must be an explicit, owner-authorized, audited compensating action.
9. Supplier debt and customer debt are never netted against one another.
10. The dashboard adds only the new Bizning qarzlarimiz amount. It does not add or replace the already-existing Nasiya amount. The card totals every currently unpaid supplier balance regardless of due month and opens the all-due-date outgoing Qarzlar tab.
11. Hisobot shows separate figures for supplier debt and customer Pay Later debt while retaining all current Nasiya figures and formulas.
12. Month filtering follows the selected shop month:
    - an open supplier liability is attributed to its due-date month;
    - an open Sale Pay Later balance is attributed to its due-date month;
    - creation month does not matter: an item appears whenever its due month is selected and its current remaining balance is still positive;
    - existing Nasiya month behavior remains unchanged;
    - full payment removes the item from the open amount;
    - partial payment leaves the remaining amount in the original due-date month.
13. These figures are current outstanding balances scoped to a selected due month. They are not historical “as of month end” accounting snapshots.
14. The Qarzlar page defaults to all due dates so no open debt is hidden. It also permits explicit Tashkent due-month filtering, including future due months within the supported range.
15. All new user-facing copy, logs, statuses, empty states, validation messages, Telegram messages, and accessibility labels are Uzbek.

## 3. Current-state findings

The plan is grounded in the current repository rather than a greenfield design.

### 3.1 Olib-sotdim today

- The current form lives at src/app/(shop)/shop/olib-sotdim/new/page.tsx.
- It creates an externally sourced Device, Customer, Sale, and SupplierPayable.
- The customer side supports full, partial, or later payment through Sale.
- The supplier side supports paid now or later.
- The resulting Device is directly moved to SOLD_CASH or SOLD_DEBT.
- The creation idempotency key is currently anchored on Sale, so it cannot naturally represent an Olib-sotdim Nasiya outcome.
- The list at /shop/olib-sotdim fetches after hydration and uses exact count plus offset pagination.
- Its search text can enter the URL and client query key.
- Supplier payment is a binary PATCH operation that changes the header from open to paid. It has no partial-payment ledger.

### 3.2 Nasiya today

- Standalone Nasiya already has the required multi-step form, calculation, schedule preview, customer handling, down-payment payment, and allocation ledger.
- The server route atomically changes an in-stock device to SOLD_NASIYA and creates the Nasiya contract, schedules, payment, allocation, log, and notification records.
- This behavior is mature and must be shared rather than copied or reimplemented.

### 3.3 Supplier liabilities today

- SupplierPayable is tied to Device and a required Sale.
- Its amount has both legacy UZS and native contract-currency fields.
- It has PENDING, PAID, CANCELLED, and OVERDUE statuses.
- Payment information is stored only on the payable header.
- It cannot represent a normal inventory device acquired before any customer sale.
- It cannot represent partial payments or an append-only payment history.

### 3.4 Customer Pay Later today

- Ordinary Sale already stores paid and remaining amounts, due date, and payments.
- Sale payment already supports a split payment breakdown and idempotency.
- Device detail already exposes customer payment history and payment actions.
- Qarzlar should reuse this existing Sale payment domain behavior rather than create a second receivables ledger.

### 3.5 Dashboard and reports today

- Dashboard and Hisobot are server seeded.
- The stats layer uses bounded, set-based SQL and short-lived caching.
- Existing expected receivables combine current Nasiya and Sale concepts in established formulas.
- New Pay Later and supplier-liability fields must be added separately. Existing Nasiya and combined figures must not be silently changed.

### 3.6 Permissions today

- Owners receive package-bounded capabilities implicitly.
- Staff receive explicit grants.
- Delegated staff managers may grant only routine capabilities, not financial ones.
- Olib-sotdim already has view/create and supplier payment permissions.
- Incoming customer collection already uses Sale view and Sale payment-receive permissions.
- Every new screen and mutation still needs live server authorization and shop scoping; hiding a button is not authorization.

### 3.7 Performance baseline today

The current production report dated 2026-07-17 records:

| Area | p50 | p75 | p95 |
|---|---:|---:|---:|
| Dashboard | 610 ms | 883 ms | 883 ms |
| Qurilmalar | 626 ms | 2,104 ms | 2,104 ms |
| Sotuvlar | 551 ms | 809 ms | 809 ms |
| Nasiyalar | 498 ms | 792 ms | 792 ms |
| To‘lovlar | 462 ms | 484 ms | 484 ms |
| Mijozlar | 503 ms | 537 ms | 537 ms |
| Logs | 482 ms | 483 ms | 483 ms |
| Xodimlar | 576 ms | 604 ms | 604 ms |
| Settings | 466 ms | 530 ms | 530 ms |
| Nasiya payment context, cold | 679 ms shell | — | 761 ms usable |
| Nasiya payment context, warm | 307 ms shell | — | — |
| Nasiya defer | 327 ms | — | 478 ms |

The existing report does not contain a comparable Olib-sotdim, Qarzlar, or supplier-payment baseline. Phase 0 must record those paths before implementation.

## 4. Target user experience

### 4.1 Olib-sotdim creation

Keep the current review-oriented flow but make its branches explicit.

#### Step 1 — Device and supplier

Fields:

- device model and specifications;
- IMEI and serial information;
- optional images;
- purchase amount and purchase currency;
- supplier name;
- supplier phone;
- supplier location or note;
- supplier settlement:
  - Hozir to‘landi;
  - Keyin to‘lash;
- if Keyin to‘lash:
  - original debt amount, prefilled from purchase price;
  - due date;
  - reminder configuration;
  - optional initial partial supplier payment;
  - one payment method or two-method split for that initial payment.

The supplier contract currency belongs to the purchase leg. It must not be implicitly coupled to the customer sale or Nasiya contract currency.

#### Step 2 — Customer outcome

Large accessible segmented cards:

- Sotuv.
- Nasiya.

The choice must be keyboard accessible, expose selected state to assistive technology, and preserve valid values if the user goes back.

#### Sotuv branch

Keep the current fields and outcomes:

- customer;
- customer sale price and currency;
- full, partial, or later payment;
- amount paid;
- due date when a balance remains;
- one or two payment methods;
- reminders;
- review totals.

#### Nasiya branch

Render a shared Nasiya terms component with the same behavior as standalone Nasiya:

- existing/new customer;
- the same required identity-photo policy;
- optional identity identifier or trust fields only when the current permission allows them;
- sale price and contract currency;
- down payment;
- duration;
- interest or monthly-payment override;
- start date;
- down-payment method or two-method split where existing Nasiya permits it;
- early reminder;
- live calculation;
- schedule preview;
- total financed, total payable, monthly installments, final installment, and due dates.

The branch must call the shared Nasiya calculator and validation schema. It must not maintain an Olib-specific copy of the formula.

#### Step 3 — Review and submit

The review must visibly separate:

- device acquisition;
- supplier settlement;
- customer outcome;
- immediate cash movements;
- remaining supplier debt;
- remaining customer Sale debt or Nasiya schedule;
- currencies and frozen exchange-rate snapshots;
- due dates;
- reminder settings.

The submit action uses AsyncButton, produces feedback within 100 ms, prevents double submission, supports safe retry with the same idempotency key, and navigates to the created operation or device only after confirmed success.

### 4.2 Normal device creation

Add an acquisition settlement section to the existing device form:

- Hozir to‘landi remains the default and preserves current behavior.
- Keyin to‘lash reveals supplier, amount, due date, reminders, and optional initial payment fields.

On success:

- the Device remains IN_STOCK;
- a SupplierPayable with origin DEVICE_PURCHASE is created atomically;
- an optional initial partial payment is written to the payment ledger;
- the device can immediately be used by existing inventory, sale, and Nasiya flows.

The Pay Later branch is visible only to a principal with the complete device-on-credit capability described in the permission matrix.

### 4.3 Qarzlar page

Route: /shop/qarzlar

The page has exactly two primary tabs:

1. Bizning qarzlarimiz.
2. Bizga qarzlar.

The active tab and non-sensitive filters may be represented in the URL. Private free-text search must never be placed in the URL.

Shared controls:

- selected month;
- status: all open, pending, partial, overdue;
- search;
- next-page continuation;
- retry;
- visible refresh activity without clearing existing rows.

Optional paid history may be exposed behind a separate status filter after open-debt delivery is complete. Open debt remains the default and the dashboard links only to open outgoing debt.

#### Outgoing card — Bizning qarzlarimiz

Each card shows:

- first device image when available, with a stable placeholder otherwise;
- device model;
- useful specifications;
- masked IMEI or serial according to permission;
- supplier name;
- supplier phone only when permitted;
- origin: Olib-sotdim or Omborga Pay Later;
- original amount;
- total paid;
- current remaining amount;
- contract currency;
- due date;
- days remaining or days overdue;
- status;
- created date;
- most recent payment date and method, when available;
- reminder state;
- To‘lov qilish action;
- device-profile link;
- compact payment-history disclosure.

#### Incoming card — Bizga qarzlar

Each card shows:

- first device image when available;
- device model and useful specifications;
- masked IMEI or serial according to permission;
- customer name;
- customer phone only when permitted;
- source: ordinary sale or Olib-sotdim Sotuv;
- sale price;
- total collected;
- current remaining amount;
- contract currency;
- due date;
- days remaining or days overdue;
- status;
- last payment;
- To‘lov qabul qilish action;
- device and customer links when permitted.

No Nasiya contract may appear in this tab.

#### Responsive and accessible behavior

- Cards are optimized for one-handed mobile use first.
- Important amount, due date, and action remain above the fold.
- Desktop may use a denser grid without switching to an inaccessible data table.
- Tabs use the tabs pattern with keyboard navigation.
- Loading skeletons preserve card dimensions.
- The list retains old rows during refetch and exposes aria-busy plus QueryActivity.
- Empty, filtered-empty, error, offline, and retry states are distinct.
- Images have meaningful device alt text or empty alt when decorative.

### 4.4 Paying a supplier debt

The same payment sheet or dialog opens from:

- an outgoing debt card;
- the related device profile.

Fields:

- remaining balance;
- amount to pay, defaulting to the full remaining balance;
- Qisman to‘lash affordance;
- payment date;
- payment method;
- Ikki usulda to‘lash toggle;
- when split is enabled, exactly two distinct methods and an amount for each;
- optional note;
- review summary.

Rules:

- amount must be greater than zero;
- amount must not exceed the confirmed current balance;
- split amounts must be positive and sum exactly to the submitted amount;
- the two methods must differ;
- currency precision is 1 UZS or 0.01 USD;
- partial payment leaves the payable open;
- full payment sets remaining to zero and closes it;
- no client-side optimistic balance is presented as final;
- a stale balance returns a conflict with refreshed context rather than silently overpaying;
- retries use the same idempotency key and command hash.

### 4.5 Receiving a customer Pay Later payment

The incoming card opens the existing Sale-payment flow and domain service. Qarzlar may provide a new presentation, but it must not fork payment accounting.

The current one-method, split-method, idempotency, currency, receipt, log, and device-detail behavior remains authoritative.

### 4.6 Device profile

Add a supplier-liability card only when the device has a related payable and the viewer has permission.

It contains the same safe projection as the outgoing debt card, a bounded payment history, and To‘lov qilish.

Permission behavior:

- a normal inventory viewer sees the card only if also allowed to view supplier payables;
- a payable-only staff member may open a limited device context from Qarzlar;
- limited context must not leak purchase margin, unrelated customer identity, passport data, or unrestricted inventory cost;
- server-side DTO shaping, not CSS, enforces this restriction.

The existing customer Sale and Nasiya sections are not replaced.

## 5. Domain model

### 5.1 OlibSotdimOperation

Introduce a durable aggregate root instead of treating Sale as the identity of an Olib-sotdim operation.

Proposed fields:

- id;
- shopId;
- deviceId;
- customerId;
- customerDealType: SALE or NASIYA;
- saleId, nullable and unique;
- nasiyaId, nullable and unique;
- createdBy;
- creationIdempotencyKey;
- commandHash;
- createdAt;
- updatedAt.

Database invariants:

- SALE requires saleId and forbids nasiyaId.
- NASIYA requires nasiyaId and forbids saleId.
- exactly one outcome relation is populated.
- all related records belong to the same shop.
- the device belongs to exactly one Olib-sotdim operation.
- the idempotency key is unique within the shop.

This aggregate allows one atomic command to create either outcome and gives lists, logs, links, and retries a stable identity.

### 5.2 SupplierPayable

Evolve SupplierPayable from a Sale-only binary flag into a generic device-acquisition liability.

Add or change:

- origin: OLIB_SOTDIM or DEVICE_PURCHASE;
- saleId becomes nullable for backward compatibility;
- olibSotdimOperationId becomes nullable and unique;
- supplierId remains optional;
- immutable supplier name/phone/location snapshot remains on the payable;
- original native contract amount remains immutable;
- contractPaidAmount;
- contractRemainingAmount;
- legacy UZS paidAmount and remainingAmount for compatibility;
- ledgerVersion for concurrency control;
- PARTIAL status;
- paidAt only when fully settled;
- lastPaymentAt;
- createdBy and updatedBy where absent.

The source of truth for payment history becomes the append-only payment table. Header totals are transactionally maintained projections for bounded reads.

Display status is derived from both amounts and date:

- PAID when remaining is zero;
- OVERDUE when remaining is positive and due date has passed;
- PARTIAL when remaining is positive, some amount is paid, and it is not overdue;
- PENDING otherwise;
- legacy CANCELLED remains readable but no new general cancellation action is introduced in this scope.

### 5.3 SupplierPayablePayment

Add an append-only ledger record:

- id;
- shopId;
- supplierPayableId;
- amount in legacy UZS compatibility representation;
- submitted amount;
- submitted currency;
- exchange rate;
- rate source;
- rate observed and recorded timestamps;
- applied amount in payable contract currency;
- representative paymentMethod;
- paymentBreakdown JSON;
- paidAt;
- optional note;
- createdBy;
- idempotencyKey;
- commandHash;
- createdAt.

Constraints:

- unique shopId plus idempotencyKey;
- positive applied amount;
- payment amount respects currency minor units;
- paymentBreakdown totals the submitted amount;
- one-method breakdown contains one entry;
- split breakdown contains exactly two positive entries with distinct methods;
- every relation is tenant-consistent;
- ledger records cannot be edited or deleted through application APIs.

### 5.4 Existing Sale and Nasiya models

- Do not replace SalePayment.
- Do not replace NasiyaPayment or NasiyaPaymentAllocation.
- Add only the minimum source relation needed to identify an Olib-sotdim outcome.
- Open incoming Pay Later is determined from ordinary Sale remaining balance and due date.
- Nasiya is excluded structurally, not by UI text.

### 5.5 Currency rules

- Supplier purchase and customer outcome have independent input currencies.
- Every contract freezes the accepted creation exchange rate and metadata.
- Every cross-currency payment freezes its accepted payment-time rate and metadata.
- Financial math uses Decimal or the existing minor-unit helpers, never JavaScript floating point.
- A native currency amount is never recalculated using today’s rate.
- Dashboard and report values remain partitioned by currency when an honest scalar conversion is unavailable.
- UI never silently adds UZS and USD.

## 6. Database migration

Use an expand, backfill, validate, switch, and later-cleanup sequence. It must be safe for the previously deployed application until the verified new artifact is promoted.

### 6.1 Expand

1. Add the Olib outcome, payable-origin, and partial-status enum values.
2. Create OlibSotdimOperation.
3. Create SupplierPayablePayment.
4. Add nullable SupplierPayable origin/reference/paid/remaining/version fields.
5. Make saleId nullable without removing compatibility indexes or constraints prematurely.
6. Add tenant-consistent composite foreign keys as not-valid where PostgreSQL permits.
7. Add new permission catalog rows and change-event domain values.
8. Do not rename or drop an existing production column in this phase.

### 6.2 Deterministic backfill

For each existing SupplierPayable:

- set origin to OLIB_SOTDIM;
- create one OlibSotdimOperation with SALE outcome from its existing shop, device, sale, customer, creator, and timestamps;
- generate deterministic identifiers so rerunning the migration is safe;
- PAID rows receive paid equal to original and remaining zero;
- open rows receive paid zero and remaining equal to original;
- preserve current native amount, currency, rate, and legacy UZS snapshots;
- create one synthetic migration payment for a paid row only when its paid timestamp and header payment evidence are sufficient;
- mark synthetic rows with a migration source and deterministic idempotency key;
- do not invent a missing exchange rate or split breakdown;
- quarantine and report inconsistent rows instead of guessing.

Preflight counts must reconcile:

- source payables;
- created operations;
- outcome links;
- paid headers;
- migrated payment rows;
- open and paid native totals by currency;
- shop/device/sale tenant relationships;
- duplicates and orphans.

### 6.3 Validate

After backfill:

- validate tenant foreign keys;
- validate exact-one-outcome checks;
- validate original equals paid plus remaining for non-cancelled rows;
- validate PAID implies zero remaining;
- validate positive amounts and currency precision;
- validate payment-ledger sums against header paid amounts;
- validate that normal device-purchase payables do not require a Sale.

### 6.4 Indexes

Add indexes only after EXPLAIN evidence on restored production-like data. Expected candidates:

- open SupplierPayable by shopId, dueDate, id;
- SupplierPayablePayment by shopId, supplierPayableId, paidAt, id;
- OlibSotdimOperation by shopId, createdAt, id;
- customer Sale open balance by shopId, dueDate, id if an existing partial index is not already sufficient.

Prefer partial indexes limited to non-deleted, positive-remaining rows. Do not add a redundant index just because it appears in this plan.

### 6.5 Compatibility and rollback

- Old application writes remain valid during schema expansion.
- The new application dual-reads migrated and new payment history during the transition.
- The new application always dual-writes compatibility header fields.
- Application rollback remains possible until promotion verification completes.
- Database migration rollback is not attempted after financial ledger writes; use forward fixes.
- Destructive cleanup, enum removal, and compatibility-column removal require a separate later release.

## 7. Transaction and API design

### 7.1 Shared service boundaries

Create server-only domain services:

- createOlibSotdimOperation;
- createNasiyaContractCore;
- createSupplierPayable;
- recordSupplierPayablePayment;
- queryOutgoingDebts;
- queryIncomingPayLaterDebts;
- getDebtStats;
- getDevicePayableContext.

Routes authenticate, validate, authorize, rate-limit, and call these services. Business invariants stay in server-only modules and database constraints, not React components.

### 7.2 Olib-sotdim create command

POST /api/olib-sotdim accepts a discriminated command:

- common device and supplier acquisition;
- supplier settlement;
- customerDealType;
- sale payload when SALE;
- Nasiya payload when NASIYA;
- idempotency key and matching command hash.

Inside one retryable transaction:

1. resolve shop and live permissions;
2. validate package feature for the selected branch;
3. normalize phone and device identifiers;
4. verify currency snapshots and minor units;
5. conditionally create the Device with database-backed uniqueness;
6. create or resolve the Customer;
7. for SALE:
   - create Sale;
   - create its initial payment when positive;
   - set Device to SOLD_CASH or SOLD_DEBT;
8. for NASIYA:
   - call the shared calculation and contract service;
   - create schedules;
   - create down-payment payment and allocation when positive;
   - set Device to SOLD_NASIYA;
9. create SupplierPayable and any initial supplier payment;
10. create OlibSotdimOperation;
11. write the audit event and outbox/change event;
12. commit before asynchronous Telegram delivery.

Any failure rolls back the full operation. A same-key, same-command retry returns the original result. A same-key, different-command retry is rejected.

### 7.3 Normal device Pay Later command

Extend device creation with a discriminated acquisition settlement.

The entire Device, Supplier, SupplierPayable, initial payment, log, and change event is one transaction. The idempotency scope covers the full compound command.

### 7.4 Supplier payment command

New endpoint:

POST /api/supplier-payables/[id]/payments

Requirements:

- exact server permission and feature checks;
- shop resolution from session, never request trust;
- bounded payable lookup with tenant predicate;
- positive amount and split validation;
- Idempotency-Key plus command hash;
- serializable transaction with bounded retry;
- conditional update using ledgerVersion and current remaining amount;
- append ledger record;
- update header paid and remaining projections;
- set PARTIAL, OVERDUE, or PAID correctly;
- set paidAt only on final settlement;
- audit log and change event in the same unit of work;
- notification queued after commit;
- conflict response includes a fresh safe context;
- no overpayment and no negative remaining balance.

The old binary PATCH endpoint temporarily becomes a compatibility adapter that pays the full confirmed remaining balance through the new service. New UI never calls it. Remove it only in a later cleanup release.

### 7.5 Debt query endpoint

Initial data is loaded directly by the server page through the DAL.

Client refetch and private search use a POST read endpoint so private search text stays out of the URL:

POST /api/debts/query

Body:

- tab;
- month;
- status;
- opaque cursor;
- private search text;
- result limit within a server cap.

Rules:

- take plus one keyset pagination ordered by dueDate and id;
- no exact count;
- no offset pagination;
- a bounded safe card DTO;
- abortable requests;
- 275 ms search debounce unless measured evidence supports another existing standard;
- query keys contain only a search revision token, never raw search;
- logs contain query timing and result size, never search text;
- URL may contain tab, month, status, and cursor, but not search.

### 7.6 Server-seeded rendering

- /shop/qarzlar returns the first bounded result set from the server.
- Dashboard and Hisobot receive new values in their existing server-seeded payload.
- Device detail receives an authorized payable projection from its server data path where possible.
- No initial browser render should wait for a new same-origin API waterfall.
- Client query state uses initialData with matching freshness metadata.

## 8. Statistics and month semantics

### 8.1 New independent measures

Add these currency-partitioned measures:

- supplierPayablesDueSelectedMonth;
- supplierPayablesDueSelectedMonthCount;
- supplierPayablesOverdueWithinSelectedMonth;
- customerPayLaterDueSelectedMonth;
- customerPayLaterDueSelectedMonthCount;
- customerPayLaterOverdueWithinSelectedMonth.

Hisobot may also show, as separate context:

- supplierPaymentsMadeSelectedMonth;
- supplierPaymentsMadeSelectedMonthCount.

Do not subtract supplier payments from existing Sof tushum or profit formulas in this feature. That accounting-policy change is outside scope and could rewrite historical meaning.

### 8.2 Row inclusion

Outgoing open balance:

- SupplierPayable belongs to the selected shop;
- remaining is positive;
- not deleted or cancelled;
- dueDate is within the selected Tashkent month.

Incoming Pay Later open balance:

- ordinary Sale belongs to the selected shop;
- remaining is positive;
- not returned or deleted;
- dueDate is within the selected Tashkent month;
- no Nasiya join or schedule is included.

Time boundaries use the existing Tashkent business-date helpers and half-open month ranges.

### 8.3 Dashboard

Add one financial card:

- label: Bizning qarzlarimiz;
- current Tashkent business-month outstanding amount, partitioned by currency;
- open item count;
- clear unavailable state when the user lacks financial-dashboard permission;
- link to /shop/qarzlar?tab=outgoing&month=YYYY-MM using that current business month when the user can view outgoing debts.

The amount may remain visible under the existing dashboard-financial permission even if the user cannot open detail, matching the existing separation between summary permission and module access. In that case the card is not an active link.

Do not add a new Nasiya card and do not alter the existing one.

### 8.4 Hisobot

Add separate cards and monthly series for:

- Bizning qarzlarimiz;
- Bizga Pay Later qarzlar.

Keep current Nasiya values unchanged. Labels and help text must explain that the figures are current remaining balances attributed to due month, not historical closing balances.

Extend the current set-based query instead of adding per-card requests or loops. Attribute outstanding balances to the shop, not arbitrarily to the last payment employee. Where a creator breakdown is shown, label it as creation activity rather than debt ownership.

### 8.5 Cache invalidation

Introduce a debts change domain and tag. Relevant mutations invalidate:

- debts;
- devices;
- sales or nasiyas for the selected Olib outcome;
- dashboard stats;
- report stats;
- logs;
- the specific device and customer projections;
- Olib-sotdim lists.

Invalidation happens after commit and uses the existing cross-instance change-event synchronization.

## 9. Permissions and tenancy

### 9.1 Proposed capabilities

| Capability | Purpose | Financial | Delegable by staff manager |
|---|---|---:|---:|
| OLIB_VIEW | View Olib-sotdim operations | No | Yes |
| OLIB_CREATE | Create a complete Olib-sotdim operation, including its selected customer outcome and supplier terms | Yes | No |
| DEVICE_PURCHASE_ON_CREDIT | Create a new inventory device together with a supplier liability | Yes | No |
| SUPPLIER_PAYABLE_VIEW | View outgoing debt cards and safe supplier-liability context | No | Yes |
| SUPPLIER_PAYMENT_RECORD | Record partial, split, or full supplier payments | Yes | No |
| SALE_VIEW | View incoming ordinary Sale Pay Later cards | Existing policy | Existing policy |
| SALE_PAYMENT_RECEIVE | Receive customer Sale Pay Later payments | Yes | No |
| DASHBOARD_FINANCIAL_VIEW | View dashboard amount | Existing policy | Existing policy |
| REPORT_VIEW | View Hisobot debt figures | Existing policy | Existing policy |
| LOG_VIEW | View authorized debt audit events | Existing policy | Existing policy |

Transition:

- map existing SUPPLIER_PAYMENT_MARK_PAID grants to SUPPLIER_PAYMENT_RECORD;
- keep the old code as a compatibility alias for one release;
- do not broaden any staff user who did not already have the old supplier payment authority;
- owner and super-admin behavior remains package bounded;
- staff get only explicitly saved capabilities.

### 9.2 Feature entitlements

- Olib Sotuv needs the OLIB_SOTDIM and cash-sale package features.
- Olib Nasiya needs OLIB_SOTDIM plus NASIYA package entitlement.
- The OLIB_CREATE capability owns the complete Olib operation and does not depend on a second staff capability.
- Normal device Pay Later uses the complete DEVICE_PURCHASE_ON_CREDIT capability, so ordinary DEVICE_CREATE is not silently expanded into financial-liability authority.
- Incoming Pay Later uses existing Sale capabilities and never grants Nasiya access.
- Qarzlar does not become a back door around package features. Its outgoing tab requires an enabled acquisition path such as OLIB_SOTDIM or inventory purchase plus the outgoing view capability; its incoming tab requires cash-sale entitlement plus the existing Sale capability.
- If a principal can open only one tab, the route selects that authorized tab and does not query, count, prefetch, or reveal the other one. If neither tab is authorized, the route is denied.

### 9.3 Request matrix

Every page, query, mutation, file/image projection, notification recipient, and log link must check:

- authenticated actor;
- active membership;
- resolved shop;
- shop entitlement;
- exact capability;
- resource shopId;
- resource state;
- DTO field-level permission.

Super-admin routes require explicit shop context. A supplied shopId, deviceId, payableId, saleId, customerId, or operationId never substitutes for a tenant predicate.

### 9.4 Revocation and concurrency

- Do not rely on stale client permission state.
- Recheck permissions inside every mutation request.
- Recheck payable state and ledger version inside the payment transaction.
- A revoked staff user must fail even if a payment dialog was already open.
- Two simultaneous full-payment submissions produce at most one financial effect.

### 9.5 Permission assignment experience

- Add the new capabilities to the owner and authorized staff-management screens with clear Uzbek descriptions.
- Group viewing separately from creating liabilities and recording money movement.
- Owners can grant staff the exact operational subset needed by the shop.
- Delegated staff managers may grant the routine outgoing-view capability only when they possess it themselves.
- They cannot grant device-on-credit creation or supplier/customer payment authority.
- Super-admin shop access remains explicit and audited rather than inheriting an ambiguous global shop context.
- Permission summaries, sidebar visibility, route guards, APIs, and background projections must all use the same catalog source.

## 10. Security and privacy

### 10.1 Data minimization

- Debt list DTOs include only card fields.
- Passport photos and identifiers never enter Qarzlar.
- Private phone and IMEI data are masked or omitted based on existing permissions.
- Signed device image previews are short lived and authorized.
- Supplier cost and margin are not exposed to payable-only staff unless an existing financial permission allows them.

### 10.2 Search privacy

- Search text is kept in local component state.
- It is sent only in the POST body.
- It is absent from browser history, URLs, query keys, Server-Timing descriptions, logs, analytics, and error reporting.
- Search requests are debounced, aborted on change, length limited, normalized, and rate limited.
- The database query remains tenant scoped and bounded.

### 10.3 Mutation safety

- Validate commands with discriminated schemas.
- Normalize device identifiers and phone numbers once.
- Apply request size and array-length limits.
- Verify image ownership before connecting it to a device.
- Use database uniqueness for IMEI and idempotency.
- Use command hashes to reject accidental key reuse.
- Never trust totals, schedules, remaining balances, status, rates, or shop IDs calculated by the browser.
- Escape all Telegram HTML and log display values.
- Apply current CSRF/origin protections to cookie-authenticated mutations.

### 10.4 Financial invariants

- original amount equals paid plus remaining for every active payable;
- the payment ledger sum equals header paid;
- remaining never becomes negative;
- full payment is the only normal path to PAID;
- partial payment never sets paidAt;
- the contract currency is immutable;
- every rate is frozen with provenance;
- no existing ledger row is updated or deleted;
- no return automatically erases a supplier liability;
- no customer payment settles a supplier payable;
- no notification or cache event can create a financial effect.

## 11. Logs and activity presentation

Add Uzbek presentation for at least:

- Olib-sotdim Sotuv yaratildi;
- Olib-sotdim Nasiya yaratildi;
- Qurilma keyin to‘lashga olindi;
- Yetkazib beruvchi qarzi yaratildi;
- Yetkazib beruvchi qarzi qisman to‘landi;
- Yetkazib beruvchi qarzi to‘liq to‘landi;
- Pay Later to‘lovi qabul qilindi;
- Ikki usulda to‘lov qilindi.

Log payloads include:

- public resource identity;
- deal type or payable origin;
- amount paid;
- remaining amount;
- currency;
- due date;
- payment-method summary;
- actor;
- status transition;
- idempotent replay indicator when useful.

They exclude:

- passport data;
- full private search text;
- raw authentication data;
- full private phone where the viewer lacks access;
- hidden cost or margin;
- unrestricted request bodies.

Logs link to the authorized Qarzlar tab, operation, or limited device context. Link resolution must not leak whether another shop owns a resource.

## 12. Telegram

### 12.1 Events

Support:

- OLIB_SOTDIM_CREATED with SALE or NASIYA outcome;
- SUPPLIER_PAYABLE_CREATED;
- SUPPLIER_PAYABLE_PAYMENT_RECORDED for partial payment;
- SUPPLIER_PAYABLE_PAID for final payment;
- existing Sale payment events for incoming Pay Later;
- existing supplier due-soon and overdue reminders using remaining balance.

Avoid duplicate messages for the same compound operation. An Olib Nasiya creation should produce one coherent creation message with Nasiya summary and supplier terms, followed by normal schedule/reminder behavior.

### 12.2 Message content

All messages:

- use one bold Uzbek title;
- clearly say who owes whom;
- show the device;
- show amount paid now and remaining amount where relevant;
- show due date;
- show one currency without mixing totals;
- show two payment methods when split;
- escape dynamic HTML;
- never include passport information, internal IDs, or private search data;
- attach only an authorized device image, never a customer passport image.

### 12.3 Reminder correctness

- Due and overdue queries include pending, partial, and overdue payables with positive remaining.
- Queries are bounded and use existing watermark/keyset patterns.
- A partial payment invalidates a stale queued reminder.
- Delivery revalidates shop, feature, member, Telegram recipient, payable state, and current remaining amount.
- Full payment cancels future supplier reminders.
- Partial payment keeps future reminders active at the new remaining balance.
- Retry and deduplication use the existing notification delivery guarantees.

## 13. Performance implementation contract

The authoritative contracts remain:

- docs/shop-portal-performance-plan.md
- docs/shop-portal-performance-report.md

Required targets:

- normal authenticated route p50 at or below 700 ms;
- route p95 at or below 1,500 ms, with every slower outlier investigated;
- click or pending feedback at or below 100 ms;
- Nasiya payment/defer shell at or below 700 ms;
- Nasiya context usable at or below 1,000 ms;
- debounced search result at or below 700 ms after debounce;
- no important affected flow more than 15 percent slower than its recorded comparable baseline.

### 13.1 Data-path rules

- server-seed every initial critical view;
- no hydration/API waterfall;
- take plus one bounded pagination;
- no exact list counts;
- no unbounded histories;
- one set-based stats statement rather than N plus one queries;
- select card DTO fields only;
- fetch at most the first authorized image projection;
- use the process-global Prisma client;
- preserve Server-Timing phases and safe structured timing logs;
- retain rows during refetch;
- debounce and abort search;
- prefetch safe navigation targets;
- keep functions in bom1 unless database placement is deliberately reverified.

### 13.2 Interaction rules

- AsyncButton for financial actions;
- immediate pending label;
- disabled duplicate submit;
- accessible route loading and card skeletons;
- aria-busy and QueryActivity;
- error details appropriate to the viewer;
- retry that reuses the same idempotency key only for the same command;
- success only after confirmed server response;
- no false optimistic amount changes.

### 13.3 Baseline before implementation

Record three comparable runs for owner and representative staff where applicable:

- Dashboard;
- Olib-sotdim list;
- Olib-sotdim new-form shell;
- Olib Sotuv branch change;
- standalone Nasiya form and calculation;
- Qurilmalar new-form shell;
- device profile;
- current customer Sale payment dialog;
- Hisobot;
- Logs.

Record:

- p50, p75, and p95;
- HTML/server duration;
- query phases;
- browser navigation and usable time;
- click-to-pending feedback;
- search debounce-to-result;
- SQL EXPLAIN ANALYZE for the comparable debt-list/stats shapes.

Do not create or pay financial records during performance measurements.

### 13.4 New-flow performance acceptance

Measure at least three runs for:

- Qarzlar outgoing initial route;
- Qarzlar incoming initial route;
- outgoing/incoming tab switch;
- month switch;
- private search;
- load-more continuation;
- supplier payment context shell;
- partial/split/full payment UI shell without submitting;
- Olib Nasiya form and schedule calculation;
- device-profile supplier card;
- Dashboard, Hisobot, Logs, and standalone Nasiya regression paths.

For every affected area report:

- before;
- after p50, p75, p95;
- milliseconds saved or added;
- percentage faster or slower;
- score out of 100;
- whether the 15 percent guard passes.

Fix any violation before completion.

## 14. Implementation sequence

### Phase 0 — Freeze behavior and measure

Deliverables:

- trace current Olib, device-create, Sale-payment, stats, logs, and Telegram request paths;
- capture owner and staff baseline evidence;
- record current SQL plans;
- turn ambiguous policies in section 2 into acceptance tests;
- confirm no unrelated worktree edits are touched.

Exit:

- baseline artifact reviewed;
- affected-query risk list reviewed;
- no code behavior change yet.

### Phase 1 — Shared Nasiya core and schema expansion

Deliverables:

- extract shared Nasiya form sections, schemas, calculator calls, and server service without changing standalone output;
- add OlibSotdimOperation;
- add generic SupplierPayable fields;
- add SupplierPayablePayment;
- add enums, constraints, permission rows, and change domain;
- implement deterministic backfill and preflight checks.

Exit:

- standalone Nasiya golden tests are byte-for-byte or value-for-value equivalent;
- migration passes on restored production-like data;
- old application remains compatible.

### Phase 2 — Supplier payment ledger

Deliverables:

- server-only payment service;
- idempotent payment endpoint;
- one-method and exactly-two-method validation;
- partial/full status projection;
- concurrency handling;
- logs, change events, notifications;
- compatibility adapter for old full-pay endpoint.

Exit:

- overpayment, replay, stale balance, cross-tenant, revoked permission, and concurrent payment tests pass;
- ledger/header reconciliation passes.

### Phase 3 — Normal device Pay Later

Deliverables:

- settlement choice in device creation;
- DEVICE_PURCHASE_ON_CREDIT permission;
- compound atomic command;
- supplier liability and optional initial payment;
- profile payable card and action.

Exit:

- device remains IN_STOCK;
- debt is visible in outgoing Qarzlar;
- device remains sellable/Nasiya-eligible;
- paid-now behavior is unchanged.

### Phase 4 — Olib-sotdim branching

Deliverables:

- customer outcome selector;
- unchanged Sotuv branch;
- shared Nasiya branch;
- separated purchase and customer currencies;
- atomic aggregate creation;
- branch-aware review, success, operation list, logs, and Telegram;
- safe idempotent retry.

Exit:

- existing Sotuv parity tests pass;
- Olib Nasiya creates the same schedule as standalone Nasiya for identical terms;
- exactly one outcome exists;
- supplier paid-now/pay-later works independently in both outcomes.

### Phase 5 — Qarzlar UI and data path

Deliverables:

- navigation entry;
- server-seeded route;
- two accessible tabs;
- outgoing and incoming safe DTOs;
- month/status filters;
- private search;
- take-plus-one keyset pagination;
- debt cards;
- supplier payment dialog;
- incoming Sale payment reuse;
- mobile and desktop states.

Exit:

- incoming contains Sale Pay Later and excludes Nasiya;
- outgoing contains Olib and normal-device liabilities;
- partial and full payment behavior is correct;
- private search never reaches URL/query key/log/analytics.

### Phase 6 — Dashboard, Hisobot, logs, sync, and Telegram

Deliverables:

- dashboard outgoing card and link;
- separate report measures;
- unchanged Nasiya results;
- set-based stats extension;
- Uzbek log presentation;
- debts invalidation domain;
- remaining-balance Telegram templates and reminder revalidation.

Exit:

- totals reconcile to source ledgers by currency;
- selected-month semantics pass;
- dashboard link preserves month and opens outgoing;
- no stale reminder sends after full payment.

### Phase 7 — Hardening and complete verification

Deliverables:

- accessibility review at 390, 768, 1,024, and 1,440 px;
- owner and representative staff end-to-end flows;
- security and tenant tests;
- performance measurements;
- production build;
- updated manual QA and operator runbooks;
- release evidence template.

Exit:

- all acceptance gates below pass;
- no important flow regresses more than 15 percent;
- remaining risk is explicit and non-blocking.

### Phase 8 — Branch, PR, exact-main verification, and production

Deliverables:

1. Create a focused branch.
2. Commit only scoped files.
3. Open a PR with migration, security, UX, stats, and performance evidence.
4. Require PR CI.
5. Merge only after review.
6. Require exact-main CI on the exact commit.
7. Run production preflight, including new ledger and migration guards.
   Never bypass the existing duplicate-deployment guard.
8. Build one unaliased production artifact.
9. Verify HTTP health.
10. Verify database health and migration state.
11. Verify exact commit SHA.
12. Verify bom1 region.
13. Run non-mutating smoke tests.
14. Promote only that verified artifact.
15. Keep the existing live deployment if any check fails.

No direct production deployment is part of plan-writing or ordinary implementation without release authorization.

## 15. Test matrix

### 15.1 Unit and validation

- Sotuv/Nasiya discriminated commands;
- supplier paid-now/pay-later commands;
- currency precision;
- split-payment exact sum and distinct methods;
- partial/full status projection;
- due/overdue display;
- command hashing;
- idempotent replay;
- remaining-balance math;
- Nasiya calculation parity;
- month boundary in Asia/Tashkent;
- safe DTO redaction;
- Uzbek log labels;
- Telegram escaping and remaining amounts.

### 15.2 Database and integration

- existing Olib Sotuv full;
- existing Olib Sotuv partial;
- existing Olib Sotuv later;
- Olib Nasiya with and without down payment;
- Olib Nasiya schedule parity;
- supplier paid now;
- supplier Pay Later;
- supplier initial partial payment;
- normal device Pay Later;
- one-method supplier partial;
- two-method supplier partial;
- final supplier payment;
- replay of the same payment;
- same key with changed payload;
- concurrent final payments;
- overpayment;
- stale ledger version;
- IMEI race;
- full transaction rollback on any child failure;
- customer Pay Later incoming query;
- Nasiya exclusion from incoming query;
- due-month filtering;
- partial item remains;
- full item disappears from open results;
- currency-partitioned totals;
- device return leaves supplier liability intact;
- cross-shop ID rejection;
- revoked permission rejection;
- staff DTO redaction;
- cache and change-event invalidation;
- no duplicate Telegram notification.

### 15.3 Migration

- clean database;
- representative restored database;
- rerunnable deterministic backfill;
- legacy paid, pending, overdue, and cancelled rows;
- inconsistent-row quarantine;
- source-to-target counts;
- native totals by currency;
- ledger/header reconciliation;
- old application compatibility before switch;
- new application compatibility after switch.

### 15.4 Component and browser

- keyboard tabs;
- branch switching without invalid stale fields;
- form back/forward state;
- review clarity;
- loading, empty, error, offline, retry;
- search debounce and abort;
- retained rows while refetching;
- payment dialog validation;
- immediate pending state;
- double-click protection;
- conflict refresh;
- mobile card layout;
- device image fallback;
- dashboard deep link;
- profile payment action;
- owner complete flow;
- representative staff allowed flow;
- representative staff denied flow;
- live permission revocation;
- browser console and network errors absent.

### 15.5 Standard repository gates

Run:

- typecheck;
- ESLint;
- relevant unit tests;
- component tests;
- guard tests;
- integration tests;
- migration and preflight tests;
- production build;
- release preflight;
- exact-main CI.

## 16. File-level implementation map

Expected existing areas to modify:

- prisma/schema.prisma
- prisma/migrations
- src/app/(shop)/shop/olib-sotdim/new/page.tsx
- src/app/(shop)/shop/olib-sotdim/page.tsx
- src/app/api/olib-sotdim/route.ts
- src/app/api/olib-sotdim/[id]/pay/route.ts
- src/app/(shop)/shop/nasiyalar/new/page.tsx
- src/app/api/devices/[id]/nasiya/route.ts
- src/app/(shop)/shop/qurilmalar/new/page.tsx
- src/app/api/devices/route.ts
- src/app/(shop)/shop/qurilmalar/[id]/page.tsx
- current Sale payment service and route
- shop stats and range-report DAL modules
- dashboard and Hisobot server/client components
- permission catalog, feature, sidebar, and route-guard modules
- audit-log presentation modules
- change-event/cache invalidation modules
- Telegram templates, recipient resolution, cron queries, and send-time revalidation
- release preflight and migration guard scripts

Expected new areas:

- server-only Olib-sotdim aggregate service;
- shared Nasiya form/domain modules;
- supplier-payable payment service;
- debt query/stats DAL;
- /shop/qarzlar server page, client shell, loading, and error states;
- POST /api/debts/query;
- POST /api/supplier-payables/[id]/payments;
- outgoing and incoming debt card components;
- supplier payment dialog;
- dedicated unit, component, guard, integration, migration, and performance fixtures.

Exact filenames should follow the repository’s existing module boundaries during implementation; avoid a broad unrelated reorganization.

## 17. Acceptance checklist

### Product

- [ ] Olib-sotdim visibly offers Sotuv and Nasiya.
- [ ] Sotuv behaves exactly as before.
- [ ] Olib Nasiya uses the established Nasiya calculation and schedule.
- [ ] Supplier settlement is independent from customer outcome.
- [ ] Normal device creation supports Pay Later acquisition.
- [ ] Qarzlar has the two required tabs.
- [ ] Incoming is Sale Pay Later only and excludes Nasiya.
- [ ] Outgoing contains both Olib and inventory acquisitions.
- [ ] Cards contain image, device, person, balance, due date, status, and action.
- [ ] Useful origin, paid, recent-payment, contact, and reminder details are present safely.
- [ ] Supplier debt is payable from card and device profile.
- [ ] Partial payment leaves debt open.
- [ ] Exactly-two-method payment works.
- [ ] Full payment closes debt.

### Dashboard and reports

- [ ] Dashboard adds only Bizning qarzlarimiz.
- [ ] Dashboard link opens outgoing Qarzlar with the selected month.
- [ ] Hisobot adds separate supplier and customer Pay Later figures.
- [ ] Existing Nasiya figures are unchanged.
- [ ] All new amounts use selected due-month semantics.
- [ ] Currency partitions reconcile.

### Safety

- [ ] Tenant scoping is enforced at every layer.
- [ ] Owners, super-admin, and staff follow the exact permission matrix.
- [ ] Financial permissions are not delegated by staff managers.
- [ ] Revocation is live.
- [ ] Payment ledger is append only.
- [ ] Idempotency and concurrency protections pass.
- [ ] No overpayment or negative balance is possible.
- [ ] Search and private data do not leak.
- [ ] Returns do not erase supplier debt.
- [ ] Logs and Telegram are Uzbek and safely redacted.

### Performance and release

- [ ] Initial pages are server seeded.
- [ ] Lists use take plus one and keyset cursors.
- [ ] No exact counts or unbounded critical queries were introduced.
- [ ] Search is debounced, abortable, and at or below 700 ms after debounce.
- [ ] Click feedback is at or below 100 ms.
- [ ] Three-run p50/p75/p95 evidence exists.
- [ ] Every affected area has before/after, percentage, and score.
- [ ] No important regression exceeds 15 percent.
- [ ] Typecheck, lint, tests, guards, integration, and build pass.
- [ ] Owner and representative staff flows pass.
- [ ] PR CI and exact-main CI pass.
- [ ] Unaliased production artifact, health, database, commit, and bom1 are verified before promotion.

## 18. Explicit non-goals

This work does not:

- rewrite existing Nasiya accounting or dashboard behavior;
- combine Nasiya into the incoming Pay Later tab;
- net supplier liabilities against customer receivables;
- turn supplier payment into a new profit formula;
- create historical month-end accounting snapshots;
- auto-cancel supplier debt on a customer return;
- delete or rewrite financial ledger history;
- expose private search through URLs;
- redesign unrelated shop pages;
- deploy directly to production without the release process.

## 19. Completion report template

The implementation is not complete until the final report contains:

### What changed

- concise product, schema, permission, UI, notification, and release summary.

### Before speed

- comparable p50, p75, and p95 for every affected existing area.

### After p50/p75/p95

- at least three-run measurements for every affected and new area.

### Time saved and percentage faster/slower

- absolute milliseconds and percentage against the comparable baseline.

### Score out of 100

- one score per affected area with the scoring rule stated.

### Tests and production evidence

- typecheck, lint, unit, component, guard, integration, migration, build, owner/staff browser flows, CI, artifact, health, database, commit, and region.

### Remaining risks or unmeasured gaps

- explicit gaps only; never “it seems faster.”
