# Return/refund accounting policy

Status: **implemented; production release remains gated by the guarded workflow**.

This file records the policy implemented by migration
`202607130001_immutable_return_ledger`, refined by
`202607230001_return_currency_refund_method`, and both Sale and Nasiya return
routes. It replaces the earlier design-only version of this document. It does
not authorize rewriting historic records.

## Implemented policy

1. The original Sale or Nasiya, schedules, and payment rows remain present.
   A returned Sale receives `returnedAt`; a returned Nasiya and its unpaid
   schedules become `CANCELLED`. Payment rows are not deleted or rewritten.
2. Every completed return creates one immutable `DeviceReturn` for the
   shop-scoped idempotency key.
3. The shop's current `preferredCurrency` is the only accepted refund input
   currency and the only currency shown in the return form. The exact entered
   value/currency, governed FX rate, rate source/effective/fetched timestamps,
   contract-native refund, and UZS accounting snapshot are frozen separately.
4. The return freezes contract-native receipts, refund, retained value, and
   cancelled debt. It also freezes UZS revenue reversal, inventory-cost
   recovery, and signed net-retained snapshot. A negative
   `retainedValueAmountUzs` is valid when a later-rate refund creates a real FX
   loss; it must reach profit reporting rather than being clamped to zero.
   `ReturnProfitReversal` separately
   freezes only the margin and interest actually recognized from payment
   allocations before the return; future agreement interest is not reversed.
5. A non-zero contract-native refund cannot exceed verified receipts and must
   be allocated to immutable original Sale/Nasiya payment rows. The original
   receipt method and the chosen refund method are independent audit facts:
   card receipt → cash refund is valid. Split receipt methods are preserved
   when known; a legacy unknown source method is stored as `NULL` and does not
   block a refund whose amount evidence is otherwise verified.
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

`reversed sale value = money refunded + amount retained + unpaid debt cancelled`

and, for the cash portion:

`contract receipts - money refunded = amount retained`

Separately, cancelled unpaid debt remains a disposition field; it is never
invented as a receipt or refund. For a non-zero refund, the sum of immutable
refund allocations must equal the recorded contract refund and UZS refund.
The contract-native retained amount remains non-negative. The UZS net-retained
snapshot may be negative because historical receipt UZS and return-time refund
UZS use different frozen rates; that signed difference is the FX gain/loss.
`Sof tushum` subtracts only money actually refunded during the reporting
period. A completely unpaid Pay Later return therefore cancels expected debt
without inventing a refund or a recognized-profit reversal.

## Proven behavior

- Pure allocation tests cover frozen USD values, newest-first allocation,
  split-payment evidence, cross-method refunds, and unknown legacy methods.
- PostgreSQL route tests cover a Sale return, a Nasiya return, a zero-refund
  return, USD-shop/UZS-contract and UZS-shop/USD-contract flows, stale quote
  rejection, signed FX loss, legacy `RETURNED` restock control, and a Nasiya
  payment racing a return.

## Deliberate limits and separate approvals

- This migration does not invent return events for old deleted/cancelled rows.
  Historic candidate detection and any repair require the production repair
  procedure in `docs/operations/recovery-and-release-runbook.md`.
- A completed return has no edit/delete endpoint. If an operator later needs to
  correct one, an approved compensating-adjustment workflow must be designed;
  the immutable row must not be changed in place.
- The profit-reversal ledger is aggregate per return. Receipt-level principal,
  margin, and interest evidence remains in `NasiyaPaymentAllocation`; a refund
  remains linked to original payment rows but is not forced to reuse their
  payment methods or reclassified as a new principal/interest payment.
- Production behavior is not claimed until the exact commit passes CI, preview
  browser verification, the guarded Vercel migration sequence, and post-release
  smoke checks.
