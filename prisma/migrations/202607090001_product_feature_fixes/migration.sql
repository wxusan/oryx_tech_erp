-- Additive-only schema for this pass's product feature fixes. No drops or
-- renames. See docs/product-feature-fixes.md for the full item-by-item
-- writeup.

-- Item 4 — additional customer phone numbers, stored normalized (digits-only)
-- alongside the existing primary `phone`/`normalizedPhone`.
ALTER TABLE "Customer"
  ADD COLUMN "additionalPhones" TEXT[] NOT NULL DEFAULT '{}';

-- Item 12 — split-payment (e.g. half cash / half card) breakdown, stored as
-- `[{ method, amount }]`. Null for the common single-method case; the
-- existing `paymentMethod` column stays populated on every row so no
-- existing reader breaks.
ALTER TABLE "SalePayment"
  ADD COLUMN "paymentBreakdown" JSONB;

ALTER TABLE "NasiyaPayment"
  ADD COLUMN "paymentBreakdown" JSONB;

ALTER TABLE "SupplierPayable"
  ADD COLUMN "paymentBreakdown" JSONB;
