# Device lifecycle status model

## Statuses

| Status | Meaning |
|---|---|
| `IN_STOCK` | Omborda; available for a normal sale or nasiya. |
| `SOLD_CASH` | Sotilgan; a simple sale whose contract balance is fully paid. |
| `SOLD_DEBT` | Qarz; a simple sale where the customer has the device but still owes money. |
| `SOLD_NASIYA` | Nasiya; an installment sale governed by a nasiya schedule. |
| `RETURNED` | Legacy-only status retained for old data and the legacy restock repair endpoint. |

## Transitions

- A fully paid simple sale (including a fully covered split payment) becomes `SOLD_CASH`.
- A partial simple sale becomes `SOLD_DEBT`.
- Further sale payments keep `SOLD_DEBT` until the native contract balance is zero, then set `SOLD_CASH`.
- A nasiya sale remains `SOLD_NASIYA`; nasiya payments never convert it to `SOLD_CASH`.
- A normal sale/nasiya/debt return cancels the linked record as before, preserves the return/payment history, and moves the device directly to `IN_STOCK`.

This is a lifecycle/UI model only. It does not solve the separate P0-03 return/refund accounting-ledger design issue.
