# Return/refund accounting decision

Status: **approval required before F-001 implementation**.

The current return route restocks the device and deletes/cancels the active
contract. That is not an immutable accounting reversal. This document isolates
the product decisions that must be approved before schema or behavior changes.

## Recommended default policy

1. Original Sale, Nasiya, schedules and payment rows remain immutable and visible.
2. A return creates one immutable return event plus explicit financial
   adjustment/refund allocations.
3. `refundAmount` is the cash/value actually returned to the customer.
4. `retainedAmount = total customer receipts - refundAmount`.
5. Unpaid contract principal/interest is cancelled explicitly; it is not treated
   as refunded cash.
6. Refund allocations reference original payments and methods. The operator may
   not refund more through a method than was received through it without an
   explicit approved override and reason.
7. Inventory returns to stock only if the financial adjustment and audit records
   commit in the same serializable, idempotent transaction.
8. Reports record reversal effects in the return period while preserving the
   original transaction period. Historic revenue is never rewritten silently.
9. A completed return is corrected through a compensating adjustment, never by
   editing/deleting the return.

## Approval questions

The accounting/product owner must approve one answer for each item:

| Decision | Recommended answer | Alternatives/impact |
|---|---|---|
| Partial refunds | Allowed only with retained amount shown and reason required | Disallowing is simpler but may not match operations |
| Zero refund | Allowed with explicit retained amount and reason | Disallow if legally/business inappropriate |
| Remaining debt | Cancel on completed physical return | Keeping debt requires a non-return repossession workflow |
| Interest already received | Allocate separately from principal and show retained/refunded portions | Treating all receipts alike loses margin explanation |
| Refund method | Allocate against original payment methods | Unrestricted method creates cash/card reconciliation gaps |
| Inventory cost | Device returns to inventory at frozen original purchase-cost snapshot, subject to approved impairment | Revaluing requires a separate inventory adjustment |
| Profit reporting | Original period remains; return-period reversal/retained value is explicit | Rewriting history breaks closed-period auditability |
| Return correction | Compensating adjustment only | Editing/deleting destroys the audit chain |
| Repeat return | Idempotency blocks duplicates; a resold device can have a later distinct return | One lifetime return would block valid resale cycles |

## Required invariant and examples

For every returned contract:

`original receipts - refunds = retained cash`

Separately:

`cancelled unpaid debt + retained cash + refunded cash` must reconcile to the
contract disposition without inventing receipts.

Implementation cannot begin until the approval table is signed off. Integration
tests must cover full, partial and zero refund; open Qarz; nasiya principal and
interest; concurrent payment/return; duplicate request; and report/export
reconciliation.
