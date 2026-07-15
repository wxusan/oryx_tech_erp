# Return/refund accounting policy

Status: **implemented in the remediation branch; production deployment and
historic-data review are still pending**.

This file records the policy implemented by migration
`202607130001_immutable_return_ledger` and
`src/app/api/devices/[id]/return/route.ts`. It replaces the earlier design-only
version of this document. It does not authorize rewriting historic records.

## Implemented policy

1. The original Sale or Nasiya, schedules, and payment rows remain present.
   A returned Sale receives `returnedAt`; a returned Nasiya and its unpaid
   schedules become `CANCELLED`. Payment rows are not deleted or rewritten.
2. Every completed return creates one immutable `DeviceReturn` for the
   shop-scoped idempotency key.
3. `refundAmount` is the value actually returned to the customer. Both its
   submitted currency/value and its UZS accounting snapshot are frozen.
4. The return freezes contract-native receipts, refund, retained value, and
   cancelled debt. It also freezes UZS revenue reversal, inventory-cost
   recovery, and retained-value snapshots. `ReturnProfitReversal` separately
   freezes only the margin and interest actually recognized from payment
   allocations before the return; future agreement interest is not reversed.
5. A non-zero refund cannot exceed receipts and must be allocated to immutable
   original Sale/Nasiya payment rows using the same payment method. Split
   payments are allocated by their stored breakdown. There is no unrestricted
   cross-method override.
6. Partial and zero refunds are allowed. A reason of 5–1,000 characters is
   always required, and retained value is explicit rather than being mistaken
   for a refund.
7. Unpaid contract debt is cancelled on a completed physical return. It is
   recorded separately from refunded and retained money.
8. Inventory returns to `IN_STOCK`, the return event, allocations, contract
   disposition, audit log, and notification enqueue all commit in one
   serializable transaction. Retryable serialization failures and PostgreSQL
   deadlocks are retried up to three attempts.
9. Duplicate requests replay the same completed event. Reusing an idempotency
   key with different inputs is rejected.
10. Reports and exports exclude returned contracts from current operational
    sales/debt while preserving their original rows and exposing the immutable
    return-period ledger.

## Reconciliation invariant

For every returned contract:

`contract receipts - contract refund = contract retained value`

Separately, cancelled unpaid debt remains a disposition field; it is never
invented as a receipt or refund. For a non-zero refund, the sum of immutable
refund allocations must equal the recorded contract refund and UZS refund.

## Proven behavior

- Pure allocation tests cover frozen USD values, newest-first allocation,
  split-payment allocation, and rejection of an unsupported refund method.
- PostgreSQL route tests cover a Sale return, a Nasiya return, a zero-refund
  return, method rejection, legacy `RETURNED` restock control, and a Nasiya
  payment racing a return.
- The disposable-database suite applied all 36 migrations and passed 73/73
  integration tests on 2026-07-13.

## Deliberate limits and separate approvals

- This migration does not invent return events for old deleted/cancelled rows.
  Historic candidate detection and any repair require the production repair
  procedure in `docs/operations/recovery-and-release-runbook.md`.
- A completed return has no edit/delete endpoint. If an operator later needs to
  correct one, an approved compensating-adjustment workflow must be designed;
  the immutable row must not be changed in place.
- The profit-reversal ledger is aggregate per return. Receipt-level principal,
  margin, and interest evidence remains in `NasiyaPaymentAllocation`; a refund
  is still allocated to original payment methods, not reclassified as a new
  principal/interest payment.
- Production behavior is not claimed until the exact commit passes CI, preview
  browser verification, the guarded Vercel migration sequence, and post-release
  smoke checks.
