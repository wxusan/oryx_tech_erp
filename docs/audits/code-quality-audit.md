# Code quality audit — Oryx Tech ERP

Date: 2026-07-08. See `full-production-audit.md` for the overall scorecard.

## What was checked

Duplicated money/currency-formatting logic, file size outliers, `: any`
usage, and dead code across `src/`.

## Fixed this pass

- **Dead code removed**: `qurilmalar-client.tsx`'s permanently-constant
  `loading`/`error` state and the now-unreachable JSX branches they gated
  (see `ui-ux-audit.md`).

## Real issues found, not fixed this pass (documented, with reason)

### Two very large client components (P1, deferred)

`src/app/(shop)/shop/qurilmalar/[id]/page.tsx` (1371 lines) and
`src/app/(shop)/shop/nasiyalar/[id]/page.tsx` (843 lines) each contain
6+ largely-independent modal/dialog flows and 15+ `useState` calls in a
single component. This is a genuine maintainability risk — a change to one
modal's state can accidentally interact with another's — but splitting
these into `<DeviceDeleteModal>`, `<SalePaymentModal>`,
`<DeviceReturnModal>`, etc. is real, non-trivial refactoring work that
touches the exact pages handling money movement (sales, nasiya payments,
device deletion). **Why deferred**: there is no automated UI interaction
test coverage for these pages (only guard tests checking source-code
strings), so a structural refactor here can only be verified by careful
manual click-through of every flow — appropriate for a dedicated pass, not
safe to rush inside this audit's scope.

### Duplicated `toLocaleString('ru-RU')` calls (P2, reviewed — mostly not a real duplication)

A grep for `toLocaleString('ru-RU')` outside the two centralized helpers
(`src/lib/currency.ts`, `src/lib/nasiya-contract.ts`) turns up ~14 hits.
On inspection, most of these are the deliberate `· kurs: NNN` rate-hint
formatter (three near-identical call sites: `nasiya-contract.ts`, the
nasiya detail page, the device detail page) — this is an established,
consistent, already-reviewed convention for showing a bare exchange rate
next to a formatted money value, not accidental duplication of money
*formatting* itself (all actual money amounts go through
`formatMoneyByCurrency`/`formatContractMoney`). Extracting the rate-hint
formatter into a fourth shared helper (`formatRateHint(rate)`) would be a
reasonable small cleanup, but is cosmetic (identical output today) and was
not prioritized over the fixes above.

### Type looseness in a couple of spots (P3, not fixed)

- `qurilmalar/[id]/page.tsx`'s local `fmt()` helper types its `currency`
  parameter as optional even though every call site always passes it —
  cosmetic type-signature cleanup, not a runtime risk.
- A couple of `as CurrencyCode` casts on API-response fields rely on the
  API always returning a valid enum value rather than a runtime type
  guard. Given `CurrencyCode` is a Prisma enum enforced at the database
  level, this is a low-risk assumption, not fixed this pass.

## Findings investigated and found to be non-issues

- Nothing else flagged by the discovery pass held up as a real,
  independent duplication once cross-checked against
  `src/lib/currency.ts`/`src/lib/nasiya-contract.ts` — the centralized
  money-formatting helpers are consistently used for every actual money
  amount in the app.

## Summary table

| ID | Severity | Area | Issue | Fixed? |
|---|---|---|---|---|
| CQ-1 | P2 | Device list | Dead loading/error state | Yes |
| CQ-2 | P1 | Maintainability | Two 800–1400 line page components with many intertwined modals | No — deferred, refactor risk without UI test coverage |
| CQ-3 | P2 | Duplication | Rate-hint formatter repeated 3x (not money formatting itself) | No — cosmetic, low value vs. risk this pass |
| CQ-4 | P3 | Types | A couple of loose optional params / `as CurrencyCode` casts | No — low risk, cosmetic |

The core money/currency logic is well-centralized (`nasiya-contract.ts`,
`currency.ts`) and consistently reused; the main remaining maintainability
risk is component size/complexity in two detail pages, appropriate for a
dedicated refactor pass with UI test coverage added first.
