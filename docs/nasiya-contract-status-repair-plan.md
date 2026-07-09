# Nasiya contract-status repair plan

## Purpose and safety boundary

P0-01 makes new reads and payments derive Nasiya schedule/parent status from
the native contract ledger. It intentionally does **not** alter historic
production records on a GET/list/export/dashboard read. This runbook is the
separate, operator-approved path for finding and repairing rows that were
previously marked `COMPLETED` from a legacy UZS mirror even though the
contract-currency balance remains.

Do not run this plan against production without a database backup, a staging
rehearsal, a named operator, and approval of the dry-run sample. Do not
change payment amounts, exchange rates, or historical payment records as
part of this repair.

## Detection query (read-only)

Run the following on staging first. It flags every non-deleted, non-cancelled
schedule whose native balance is a meaningful amount, plus its parent status.
The threshold is strict: `$0.01` / `500 so'm` remain real debt; only values
below those values are dust.

```sql
WITH schedule_balances AS (
  SELECT
    n.id AS nasiya_id,
    n."shopId",
    n.status AS parent_status,
    n."contractCurrency",
    n."contractRemainingAmount" AS stored_contract_remaining,
    s.id AS schedule_id,
    s."monthNumber",
    s.status AS schedule_status,
    s."dueDate",
    s."delayedUntil",
    s."contractExpectedAmount",
    s."contractPaidAmount",
    GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0) AS raw_contract_outstanding,
    CASE WHEN n."contractCurrency" = 'USD' THEN 0.01 ELSE 500 END AS meaningful_threshold
  FROM "Nasiya" n
  JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
  WHERE n."deletedAt" IS NULL
    AND n.status <> 'CANCELLED'
)
SELECT *
FROM schedule_balances
WHERE raw_contract_outstanding >= meaningful_threshold
ORDER BY "shopId", nasiya_id, "monthNumber";
```

The P0-01 priority subset is `parent_status = 'COMPLETED'`. Export that result
with the parent and schedule IDs before any write. Also group it by shop and
manually inspect at least one record per currency and status combination.

## Repair sequence

1. Take a restorable backup and capture the detection-query result as a
   timestamped artifact. Record the deployed application revision and exchange
   rate source; this repair must not recompute any historic payment conversion.
2. Rehearse on a restored staging copy. Compare the pre/post list, detail,
   dashboard count, export, and payment eligibility for every sampled row.
3. For each reviewed parent, derive each schedule state from
   `contractExpectedAmount - contractPaidAmount` and its effective due date
   (`delayedUntil ?? dueDate`): `PAID` only when the native outstanding is
   below its strict currency threshold; otherwise `OVERDUE` when past due,
   `PARTIAL` when native paid amount is positive, and `PENDING`/`DEFERRED`
   otherwise.
4. Recompute the parent state from those repaired schedules: `COMPLETED` only
   when every schedule is contract-paid; otherwise `OVERDUE` if any remaining
   schedule is past its effective due date, else `ACTIVE`. Recompute
   `contractPaidAmount` and `contractRemainingAmount` from schedule contract
   values. Leave legacy UZS mirror values unchanged unless a separately
   approved reconciliation proves an update is safe.
5. In the same transaction, add an immutable `Log` row per repaired parent
   with actor, reason `P0-01 contract-status reconciliation`, before/after
   parent and schedule states, and the dry-run export reference. Do not write
   a generic completion log for a status correction.
6. Invalidate the shop nasiya/stat/export cache tags (or restart the
   deployment cache scope), re-run the detection query, and archive the
   before/after results with the change approval.

## Stop conditions

Stop and escalate instead of auto-repairing a record if any of these are
found:

- missing/invalid `contractCurrency`, `contractExpectedAmount`, or
  `contractPaidAmount`;
- parent native balance materially disagrees with the sum of its schedules;
- payments reference a different shop, deleted schedule, or impossible
  negative/overpaid native amount;
- a disputed return, refund, reversal, or manually adjusted contract is
  involved.

Those cases require an explicit accounting decision and a linked adjustment;
status repair alone must not rewrite financial history.

## Verification checklist

- The detection query returns zero raw-`COMPLETED` parents with meaningful
  native schedule debt, or every excluded record has a documented exception.
- A rate-rise sample remains `ACTIVE`/`OVERDUE` and accepts its final native
  payment.
- A rate-fall/overpayment sample is `COMPLETED` only from native schedule
  settlement.
- List, detail, dashboard active count, CSV/XLSX export, and payment gate
  agree on status.
- No NasiyaPayment amount, historical input currency, or exchange-rate field
  changed during the repair.
