-- Currency display/input support. UZS remains the accounting/storage base.

CREATE TYPE "CurrencyCode" AS ENUM ('UZS', 'USD');

ALTER TABLE "Shop" ADD COLUMN "preferredCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS';

CREATE TABLE "CurrencyRate" (
  "id" TEXT NOT NULL,
  "baseCurrency" "CurrencyCode" NOT NULL,
  "quoteCurrency" "CurrencyCode" NOT NULL,
  "rate" DECIMAL(12,4) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'CBU',
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "effectiveDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CurrencyRate_baseCurrency_quoteCurrency_fetchedAt_idx" ON "CurrencyRate"("baseCurrency", "quoteCurrency", "fetchedAt");
CREATE INDEX "CurrencyRate_source_fetchedAt_idx" ON "CurrencyRate"("source", "fetchedAt");
