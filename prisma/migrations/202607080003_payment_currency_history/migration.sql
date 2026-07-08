-- Historical payment/creation currency context — additive, nullable, no
-- backfill. Existing rows have no way to know their original input currency
-- or the rate used at the time, so they stay NULL (display falls back to
-- treating them as UZS, which is what was always stored/shown before this
-- migration). Debt/schedule math is completely unaffected: `amount`,
-- `totalAmount`, `finalNasiyaAmount`, etc. remain the UZS ledger source of
-- truth. See docs/currency-accounting-model.md.

ALTER TABLE "Sale"
  ADD COLUMN "creationCurrency" "CurrencyCode",
  ADD COLUMN "creationExchangeRate" DECIMAL(12,4);

ALTER TABLE "Nasiya"
  ADD COLUMN "creationCurrency" "CurrencyCode",
  ADD COLUMN "creationExchangeRate" DECIMAL(12,4);

ALTER TABLE "SalePayment"
  ADD COLUMN "paymentInputAmount" DECIMAL(12,2),
  ADD COLUMN "paymentInputCurrency" "CurrencyCode",
  ADD COLUMN "paymentExchangeRate" DECIMAL(12,4);

ALTER TABLE "NasiyaPayment"
  ADD COLUMN "paymentInputAmount" DECIMAL(12,2),
  ADD COLUMN "paymentInputCurrency" "CurrencyCode",
  ADD COLUMN "paymentExchangeRate" DECIMAL(12,4);
