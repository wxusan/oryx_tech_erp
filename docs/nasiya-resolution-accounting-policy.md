# Nasiya archive and restore policy

This is the operational and accounting contract for current Oryx ERP behavior.
New debt write-offs are retired. Historical `WRITTEN_OFF` contracts and
`WRITE_OFF` events remain immutable, read-only audit evidence.

## Current commands

| Command | From | To | Financial meaning |
| --- | --- | --- | --- |
| Archive | `ACTIVE` | `ARCHIVED` | Remove the remaining contract from normal collection and expected/debt statistics without deleting it. |
| Restore | `ARCHIVED` | `ACTIVE` | Return the remaining unpaid schedule to normal collection and expected/debt statistics. |

Both commands require a reason, an idempotency key, an authorized actor, and a
serializable transaction. Each command appends a `NasiyaResolutionEvent` with
the actor and time. It never deletes or edits the contract, schedule, or
payment history.

Shop owners have archive/restore access by default. Staff do not. A staff
member receives both actions only when the owner enables the **Can archive
Nasiya** checkbox while creating or editing the staff profile. UI visibility
and the resolution API enforce the same permission.

## Accounting effect

- Cash, device margin, and Nasiya interest already recognized on payment dates
  remain in their original historical actual statistics.
- An archived contract's unpaid principal, margin, and interest are excluded
  from active debt, amount due, expected income, and expected-profit metrics.
- Restoring a contract reintroduces only its remaining unpaid schedule in the
  applicable due periods. It does not move or duplicate historical receipts.
- Archive and restore are not payments, refunds, or profit events.
- A contract remains visible in the authorized `Arxivlangan` view and can be
  inspected with its full payment and resolution history.

## Legacy written-off evidence

- The normal UI and API cannot create `WRITE_OFF` events or restore a
  `WRITTEN_OFF` contract.
- `NASIYA_WRITE_OFF` is a retired, inactive permission and grants no runtime
  access. The old `WRITEOFF_MANAGE` bundle maps only to archive/restore for
  compatibility.
- Existing `WRITTEN_OFF` contracts remain available under a clearly labelled
  legacy-history filter. Their events, frozen native balance, rate context,
  actor, and timestamps are not rewritten.
- Historical receipts remain in actual cash/profit. The historically written-
  off unpaid balance remains excluded from active and expected statistics.
- Legacy write-off totals may appear only in audit/reconciliation detail and
  exports, never as a normal action or main statistics card.

## Surface behavior

| Surface | Archived | Restored | Legacy written off |
| --- | --- | --- | --- |
| Active Nasiya list | Excluded | Included | Excluded |
| Authorized history | `Arxivlangan` | Resolution event retained | Read-only legacy filter |
| Due/overdue/reminders | Excluded | Eligible again | Excluded |
| Payments/deferrals | Blocked | Allowed when otherwise eligible | Permanently blocked |
| Historical actual cash/profit | Preserved | Preserved | Preserved |
| Expected debt/profit | Remaining unpaid amount excluded | Remaining schedule restored | Unpaid amount excluded |

## Migration and verification

Migration `202607150004_complete_accounting_redesign` deactivates the legacy
write-off permission without deleting permission definitions or resolution
events. Production postflight blocks if the permission remains active. The
monthly component-ledger migration and historical reconstruction rules are
documented in `docs/accounting/monthly-profit-recognition.md`.

Any repair of historical states is a separate, explicitly approved data-repair
operation. Deployment never guesses which old contracts should be archived or
written off.
