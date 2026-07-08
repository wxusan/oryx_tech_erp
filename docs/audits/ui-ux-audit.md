# UI/UX audit — Oryx Tech ERP

Date: 2026-07-08. See `full-production-audit.md` for the overall scorecard.

## Pages reviewed

`/shop/dashboard`, `/shop/qurilmalar` (list + detail + new),
`/shop/nasiyalar` (list + detail + new), `/shop/olib-sotdim/new`,
`/shop/hisobot`, and the nasiya payment modal.

## Real issues found and fixed this pass

- **Dead code removed**: `qurilmalar-client.tsx` had `const loading = false`
  and `const error = ''` — permanently-constant local variables gating a
  loading spinner and an error banner that could never render, left over
  from before this page was converted to server-side data fetching. Removed
  both the dead state and the now-unreachable branches; the table always
  renders directly from the server-provided `initialDevices` prop. No
  behavior change (the branches never executed), pure cleanup.
  File: `src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx`.

## Findings investigated and found to be non-issues

- **Olib-sotdim profit "not displayed"**: `src/app/(shop)/shop/olib-sotdim/new/page.tsx:568-570`
  already renders the live profit figure with red/emerald coloring based on
  sign, and a loss warning (`priceWarning`, line 481) already appears when
  the sale price is below the purchase price. Verified directly; no fix
  needed.
- **Purchase-rate hint "missing so'm suffix"**: the device detail page's
  `· kurs: 12 500` format (rate shown without a currency-unit suffix) is
  the deliberate, already-shipped convention used identically in
  `src/lib/nasiya-contract.ts`'s `salePaymentAmountDisplay` and the nasiya
  detail page's `paymentAmountDisplay` — always immediately following a
  so'm amount, so the unit is contextually unambiguous. Changing it on the
  device page alone would introduce an inconsistency rather than fix one.
  Left unchanged.

## Real issues found, not fixed this pass (documented, with reason)

### Mobile responsiveness (P1, deferred)

The device list (`qurilmalar-client.tsx`) and similar tables render as a
plain `<table>` with `min-w-[1180px]` inside an `overflow-x-auto` wrapper —
functional but requires horizontal scrolling on a phone screen to see all
12 columns, and there's no card-based fallback layout for small viewports.
**Why deferred**: a proper mobile-first card view is a real UI feature
(different markup, different interaction model for row actions), not a
one-line CSS fix. This codebase has no dedicated component-level UI tests
(only guard tests that check source-code patterns), so a layout rewrite of
a page staff use constantly, done under this audit's time budget without
visual regression tooling, carries real risk of breaking the exact
day-to-day flow it's meant to improve. **Recommendation**: a follow-up pass
should add a `sm:hidden`/`lg:block` card-vs-table split, starting with the
device list (highest-traffic page), verified manually on a real phone
before merging.

### Large client components (P1, deferred — also see code-quality-audit.md)

`qurilmalar/[id]/page.tsx` (1371 lines) and `nasiyalar/[id]/page.tsx` (843
lines) each bundle 6+ independent modal/dialog flows (edit, delete, sell,
return, restock, payment) and 15+ pieces of `useState` in one component.
**Why deferred**: extracting each modal into its own component is safe in
principle but requires re-verifying every flow still works after the split
— there is no automated UI test coverage to catch a mistake, only guard
tests on source strings. Splitting these under time pressure risks
introducing a regression in a page that handles real money (sale/nasiya
payments, device deletion). Deferred to a pass with dedicated time for
manual verification of every extracted flow.

### Form validation timing (P2, deferred)

Several forms (new device, new nasiya) validate on submit rather than
inline as the user types — e.g. an invalid phone number in the nasiya
creation wizard is only caught when the user clicks "Keyingi bosqich",
requiring them to notice and go back. This is a real UX friction point but
not a correctness bug (the server-side Zod validation is authoritative and
already correct); improving it is a moderate amount of form-plumbing work
across several files, deferred to a dedicated UX pass.

### Destructive-action confirmation (P2, reviewed — partially mitigated already)

Device deletion already requires a written reason (≥5 characters) before
the delete button becomes active, which acts as a natural friction/
confirmation step (a user must stop and type something, not just click
twice). A dedicated "are you sure?" modal on top of that would be a nice-to-
have but is not a correctness or data-loss risk given the existing
friction, so it was not added this pass.

### Empty/loading state wording (P3, deferred)

A couple of dashboard cards ("Yaqin to'lov sanalari", "Oxirgi
operatsiyalar") use a generic "...yo'q" empty message without more context.
Cosmetic; left as a documented improvement rather than a fix, given the
much higher-value fixes prioritized in this pass.

## Summary table

| ID | Severity | Area | Issue | Fixed? |
|---|---|---|---|---|
| UX-1 | P2 (code quality) | Device list | Dead loading/error state | Yes |
| UX-2 | P1 | Mobile | List tables require horizontal scroll, no card fallback | No — deferred, redesign risk |
| UX-3 | P1 | Code quality | Two very large page components (6+ modals each) | No — deferred, refactor risk without UI tests |
| UX-4 | P2 | Forms | Validation happens mostly at submit, not inline | No — deferred, moderate feature work |
| UX-5 | P3 | Empty states | A couple of generic "yo'q" messages | No — cosmetic, low priority |

None of these UI/UX gaps are correctness or security risks; they are
polish and scale-readiness items appropriate for a follow-up pass.
