# Payment-basis monthly profit recognition

Status: **implemented; production migration/backfill and release approval remain gated by the production workflow**.

Migration: `202607150003_monthly_profit_recognition`

Backfill: `scripts/backfill-payment-profit-ledger.mjs`

Authoritative monthly query: `getShopMonthlyAccountingAggregate()`

## Recognition policy

- Actual profit is recognized on the payment date, never on the contract creation date.
- A Sale payment recognizes its proportional ordinary device margin.
- A Nasiya down payment recognizes principal and ordinary device margin, but no Nasiya interest.
- Every Nasiya installment is frozen as principal, ordinary device margin, and interest. A partial payment recognizes only the same cumulative paid proportion of those components.
- Expected profit is the still-unpaid margin plus interest due in the selected month. Expected Nasiya interest is also reported separately.
- Profit waived during an early settlement is never cash, actual profit, expected profit, income, turnover, a chart series, or a customer/trust statistic. It remains only in the immutable settlement detail and audit evidence needed to explain why the debt reached zero.
- Once an early settlement is committed, the fulfilled schedules have no remaining receivable or expected profit; dashboards, reports, exports, and customer analytics continue to show only received payment components.
- Future schedules are excluded from the selected month's actual and expected profit.
- Full agreement interest remains visible on the Nasiya detail page only as a reference amount.
- Cash collected, gross receivables due, overdue debt, actual profit, and expected profit are different facts and must not be substituted for one another.

For an $800-cost device sold for $1,000 with $200 down, 20% interest on the remaining $800, and four installments:

| Event/month | Principal | Device margin | Interest | Actual profit | Expected interest |
| --- | ---: | ---: | ---: | ---: | ---: |
| $200 down payment | $160 | $40 | $0 | $40 | $0 |
| Unpaid $240 installment due | $160 | $40 | $40 | $0 | $40 |
| That installment is paid | $160 | $40 | $40 | $80 on payment date | $0 after payment |

The sale month therefore has zero Nasiya interest. Each later installment contributes $40 interest only after payment; before payment, that $40 appears only as expected interest for its due month.

## Ledger and rounding

- `Sale` and `Nasiya` freeze the contract cost basis and ordinary-margin budget.
- `NasiyaSchedule` freezes its principal, margin, and interest budget plus cumulative paid components.
- `NasiyaPaymentAllocation` is append-only. One payment may create several rows when it spans selected, old, or future schedules; down payments use a null schedule.
- Every allocation stores native contract-currency components and an exact payment-date UZS snapshot.
- UZS uses whole-so'm units and USD uses cents. Cumulative allocation rounding prevents partial-payment drift; the last installment/payment absorbs the exact remainder.
- `ReturnProfitReversal` freezes only margin and interest that had already been recognized.

## Staff attribution and lifecycle

- Paid margin and interest are attributed to `NasiyaPayment.createdBy` or `SalePayment.createdBy`, the person who recorded the receipt.
- Expected profit is shop-wide because an unpaid obligation has no payment recorder yet.
- Archive removes unpaid components from expected amounts without changing prior actual profit.
- Restore reintroduces the remaining archived schedule to expected amounts.
- Historical written-off contracts keep their paid history and remain excluded from expected amounts; new write-offs and reopening written-off contracts are retired.
- Returns create a current-period reversal of recognized margin/interest; future unpaid agreement interest is never reversed as if it had been earned.

## Historical reconstruction

Run without `--apply` first. Dry-run and apply output contain counts only, never customer or contract identifiers.

```bash
npm run accounting:backfill
npm run accounting:backfill -- --apply
```

Optional shop-scoped rehearsal:

```bash
npm run accounting:backfill -- --shop-id=<shop-id>
```

Normal runs process only `PENDING` rows, so reviewed gaps and their timestamps
remain stable on later releases. A separately approved repair may be rehearsed
with `--retry-gaps`; that flag is never part of the automatic production build.

Statuses are explicit:

- `COMPLETE`: every receipt can be replayed and reconciles with stored paid totals.
- `PARTIAL`: component budgets/current unpaid portions are reliable, but historical receipt allocation is incomplete; no missing actual profit is invented.
- `UNRECONSTRUCTABLE`: cost/currency/history is insufficient, including pre-Oryx imports with unknown historic margin.
- `PENDING`: migration has run but reconstruction has not; production postflight blocks on any remaining row in this state.

The script uses one serializable transaction and an advisory lock. It adds component/allocation facts only; original payment, contract, return, and audit values are not rewritten. A rerun skips completed contracts and cannot duplicate their immutable allocations.

## Release order and stop conditions

The guarded production builder must:

1. build the application before changing schema;
2. run the read-only preflight;
3. apply the additive migration;
4. run the approved backfill with `--apply`;
5. run the postflight and stop on pending rows, component mismatches, missing allocations, or missing complete-contract return reversals;
6. report partial/unreconstructable rows as non-blocking review gaps;
7. publish the unaliased artifact, smoke-test it, and promote only the exact green `main` SHA.

After promotion, verify the dashboard, range report, API/export, collector filter, one dedicated-test-shop payment, error logs, and reconstruction-gap count. Because the migration is additive, a failed postflight is forward-fixed; schema rollback or destructive record edits are not used.
