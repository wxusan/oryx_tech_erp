# Codebase review action plan — 2026-07-10

This plan is intentionally implementation-free. It prioritizes the review findings in `docs/codebase-review-2026-07.md`.

| Order | Priority | What to fix | Reason | Risk if delayed | Estimated effort |
|---:|---|---|---|---|---|
| 1 | P0 | **Implemented 2026-07-10:** replace legacy nasiya completion/overdue derivation with contract-currency derivation; remove unsafe GET self-heal; correct list/detail/export/payment/dashboard read paths. Historic-record repair remains a separately approved runbook. | Legacy UZS state could mark a USD plan completed while real contract debt remained | Debt forgiveness, blocked payment, false reports | Code complete; data repair pending |
| 2 | P0 | Validate sale payments against contract outstanding only | Exact USD final payment can be rejected after rate movement | Customer debt cannot be settled | Small/medium |
| 3 | P0 | Decide and design immutable return/refund/payment-adjustment ledger | Current partial/zero/full returns delete historic contracts rather than record financial reversal | Historic profit/revenue and retained/refunded money become untrustworthy | High |
| 4 | P0 | **Partially implemented 2026-07-10:** add P0-01 rate-rise/rate-fall/exact-payment/cent-boundary status regression coverage. P0-02/P0-03 coverage remains separate work. | Existing tests missed the real read-path contradiction | P0 defects return unnoticed | P0-01 complete |
| 5 | P1 | Drain notifications in batches until time budget; expose queue age; align actual cron cadence with reminder timing | Daily global `take: 100` leaves reminders stale at scale | Staff stop trusting reminders | Medium |
| 6 | P1 | Preserve payment input amount/currency/rate/breakdown for every initial sale/down payment | Initial payment history is not historically accurate | Audit and customer payment history drift | Medium |
| 7 | P1 | Make sale reminder, Olib-sotdim list and exports contract-currency-aware | These paths still render legacy amounts through current rate | Incorrect USD messages, profit and exports | Medium |
| 8 | P1 | Provision disposable Postgres integration environment and add tenant/idempotency/concurrency tests | Guard tests do not execute database behavior | Cross-tenant or race regressions escape | Medium |
| 9 | P1 | Replace 200-row stock pickers with server-backed searchable selection; paginate Olib-sotdim | Staff cannot select most stock at real inventory sizes | Daily operation slowdown/failure | Medium |
| 10 | P1 | Add distributed login rate limiting and enforce a production CSP after report review | Current login limit is instance-local and CSP is report-only | Brute force/XSS defense weaker than needed | Medium |
| 11 | P2 | Define supplier partial/corrective payment model | Current payable is an all-or-nothing state stamp | Supplier debt cannot match real settlement | High |
| 12 | P2 | Add contract fields/status to exports and fix nasiya detail progress | Reports/UI must share the same source of truth | Operator confusion | Medium |
| 13 | P2 | Require reason/audit context for trust override; decide owner/staff permissions | Prevent arbitrary credit signal changes and platform dependency | Governance/support friction | Medium |
| 14 | P2 | Rehearse migrations on staging and document online-index/rollback procedure | Raw index/backfill migrations can lock production tables | Deployment outage | Medium |
| 15 | P2 | Add browser E2E tests, then extract detail-page modal controllers | Current large components are hard to change safely | Regression cost grows | High |
| 16 | P3 | Replace hard-coded shop/admin shell identity and improve Olib navigation/mobile cards | Polish and everyday discoverability | Minor user confusion | Small |

## Release gates

### Before demo

- Item 1 code path and its P0-01 portion of item 4 are complete; run the
  approved historic-data reconciliation only after staging rehearsal.
- Complete items 2 and the remaining item 4 coverage.
- Either remove/label partial return capability as unsupported or complete item 3’s contained safe behavior.
- Do not demonstrate rate-change USD settlement or scale reminders until manually QA’d.

### Before first real client

- Complete items 1–10.
- Have a signed-off decision/design for item 3, even if its implementation is a separate approved delivery.
- Run all critical flows against a disposable database and a real Telegram test recipient.

### Do not implement casually

- Direct edits/deletes of payment records.
- “Quick fixes” that mutate historic sale/nasiya totals to make reports look right.
- Cross-tenant schema constraint changes without a migration/reconciliation plan.
- Large device/nasiya detail refactors without browser coverage.
