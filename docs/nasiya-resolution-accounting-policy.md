# Nasiya archive, write-off, and reopen policy

This document is the accounting and operational contract for Oryx ERP 2.0. It describes current code behavior; it is not a historic-data repair instruction.

## States and commands

| Command | New operational state | Financial meaning |
| --- | --- | --- |
| Archive | `ARCHIVED` | Remove the contract from normal collection work without changing its financial balance. |
| Write off | `WRITTEN_OFF` | Close the remaining receivable as uncollectible and report it separately. This is not a payment. |
| Reopen | `ACTIVE` | Add a compensating event that returns an archived or written-off contract to collection. |

Only an active Nasiya may receive a payment or deferral. Archive, write-off, and reopen require a reason, an idempotency key, an authorized actor, and a serializable transaction. The command records an immutable `NasiyaResolutionEvent`; it never deletes or edits a contract, schedule, or payment row.

Shop owners and super admins have archive and reopen access by default. A staff member receives both actions only when the owner enables the **Nasiyani arxivlash mumkin** checkbox while creating or editing that staff profile. This checkbox does not grant write-off access.

## Amount policy

- Previously collected cash remains collected cash.
- Contract and schedule paid totals do not change during archive, write-off, or reopen.
- The remaining contract amount is preserved on the Nasiya row.
- A write-off event freezes the native remaining amount, contract currency, USD/UZS rate, and UZS context at the event time.
- UZS and USD are reported separately. Frozen UZS is context, not a replacement for the native amount.
- Reopening a written-off contract reverses the reported write-off through a linked compensating event. Historic events remain immutable.

## Effect by surface

| Surface | Archived | Written off | Reopened |
| --- | --- | --- | --- |
| Active Nasiya list | Hidden from the default active queue; available under `Arxivlangan` | Hidden from the active queue; available under `Hisobdan chiqarilgan` | Returns to the active queue according to contract status |
| Due-today and overdue banners | Excluded | Excluded | Included again when its effective schedule date matches the cohort |
| Payment and deferral actions | Blocked | Blocked | Allowed again when permission, entitlement, balance, and schedule state permit |
| Dashboard active receivables | Excluded from active/due/overdue work totals | Excluded from active/due/overdue work totals | Included again |
| Historical cash collected | Preserved | Preserved | Preserved |
| Sales-value/accrual statistics | Excluded. Only immutable receipt rows remain in cash-collected totals; unpaid contract value, interest, and margin are not counted. | Preserved, with the closed amount separately reported as write-off | Included again after reopen |
| Range report | Cash already received remains in the payment-period totals. The archived contract's unpaid sales value and expected debt are excluded. | Native UZS/USD and frozen-UZS write-off totals and count | Reopen subtracts the linked write-off amount and restores active receivable/stat inclusion |
| Export | Resolution state is included; range exports include write-off/reopen columns | Same | Same |
| Customer profile | Counted in archived history | Counted in written-off history and lifetime write-offs | Returns to active history |
| Trust calculation | Historical paid-installment timing is retained; archived debt and unpaid schedules do not affect the live score | Written-off schedules are excluded from current-payment scoring and open receivables | Normal active rules resume |
| Reminder generation | No new reminders | No new reminders | Eligible reminders may be generated again |
| Already queued Telegram reminder | Cancelled at delivery revalidation | Cancelled at delivery revalidation | A stale pre-reopen message is still revalidated; a fresh eligible reminder may be generated |

## Historic data and repair

Migration `202607130008_nasiya_resolution_deferral` defaults existing contracts to `ACTIVE` and backfills explicit old/new dates for existing deferral events. It does not guess which historic contracts should be archived or written off, and it does not create retroactive write-offs.

Any production data repair must remain separate from deployment and requires:

1. read-only diagnostics;
2. a reviewed dry run;
3. a current database backup;
4. explicit approval of each business rule;
5. immutable audit evidence for applied changes;
6. post-repair reconciliation by native currency.
