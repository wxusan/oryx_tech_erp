-- USD/UZS financial evidence integrity.
--
-- This is an expand-only rollout. Statements are intentionally not wrapped in
-- one migration-wide transaction: PostgreSQL would otherwise retain every
-- ACCESS EXCLUSIVE ALTER lock through all index builds and validations,
-- unnecessarily blocking live financial writers. Each additive statement is
-- independently safe for the currently-live artifact; release preflight
-- verifies that the complete contract is installed before promotion.
--
-- Rollout guarantees:
--   * existing immutable facts are classified as version 1 / LEGACY_UNKNOWN;
--   * current writers opt in explicitly to version 2 with an honest status;
--   * no historic amount, currency, provider, timestamp, or actor is guessed;
--   * version-2 facts are complete and self-reconciling at the DB boundary.

CREATE TYPE "FinancialEvidenceStatus" AS ENUM (
  'LEGACY_UNKNOWN',
  'CAPTURED',
  'VERIFIED_RECONSTRUCTION',
  'PARTIAL',
  'UNRECONSTRUCTABLE'
);

ALTER TABLE "CurrencyRate"
  ALTER COLUMN "source" DROP DEFAULT,
  ADD COLUMN "providerReference" TEXT,
  ADD COLUMN "recordedById" TEXT,
  ADD COLUMN "recordedByType" "ActorType",
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "ShopPayment"
  ADD COLUMN "exchangeRateSourceAtPayment" TEXT,
  ADD COLUMN "exchangeRateEffectiveAtPayment" TIMESTAMP(3),
  ADD COLUMN "exchangeRateFetchedAtPayment" TIMESTAMP(3),
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "Device"
  ADD COLUMN "purchaseExchangeRateSource" TEXT,
  ADD COLUMN "purchaseExchangeRateEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "purchaseExchangeRateFetchedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "Sale"
  ADD COLUMN "creationExchangeRateSource" TEXT,
  ADD COLUMN "creationExchangeRateEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "creationExchangeRateFetchedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "SalePayment"
  ADD COLUMN "paymentExchangeRateSource" TEXT,
  ADD COLUMN "paymentExchangeRateEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "paymentExchangeRateFetchedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "SupplierPayable"
  ADD COLUMN "contractExchangeRateSourceAtCreation" TEXT,
  ADD COLUMN "contractExchangeRateEffectiveAtCreation" TIMESTAMP(3),
  ADD COLUMN "contractExchangeRateFetchedAtCreation" TIMESTAMP(3),
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "SupplierPayablePayment"
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "Nasiya"
  ADD COLUMN "creationExchangeRateSource" TEXT,
  ADD COLUMN "creationExchangeRateEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "creationExchangeRateFetchedAt" TIMESTAMP(3),
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT,
  ADD COLUMN "importIdempotencyKey" TEXT,
  ADD COLUMN "importCommandHash" TEXT,
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

ALTER TABLE "NasiyaPayment"
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

CREATE UNIQUE INDEX CONCURRENTLY "Nasiya_shopId_importIdempotencyKey_key"
  ON "Nasiya"("shopId", "importIdempotencyKey");

CREATE UNIQUE INDEX CONCURRENTLY "Nasiya_shopId_creationIdempotencyKey_key"
  ON "Nasiya"("shopId", "creationIdempotencyKey");

-- Repeated CBU observations are append-only facts and may legitimately carry
-- the same provider quote identity on the same effective date. Manual command
-- identities, however, must remain unique for durable idempotent replay.
CREATE INDEX CONCURRENTLY "CurrencyRate_source_providerReference_idx"
  ON "CurrencyRate"("source", "providerReference");
CREATE UNIQUE INDEX CONCURRENTLY "CurrencyRate_manual_providerReference_key"
  ON "CurrencyRate"("providerReference")
  WHERE "source" = 'MANUAL' AND "providerReference" IS NOT NULL;

-- Every captured acquisition has at most one supplier-liability source. The
-- deferred cross-table guard below also excludes a cash receipt existing at
-- the same time, while this partial unique index closes concurrent payable
-- insertion races without affecting legacy rows.
CREATE UNIQUE INDEX CONCURRENTLY "SupplierPayable_deviceId_v2_key"
  ON "SupplierPayable"("deviceId")
  WHERE "evidenceVersion" = 2;

ALTER TABLE "Nasiya"
  ADD CONSTRAINT "Nasiya_import_command_pair_check"
  CHECK (
    ("importIdempotencyKey" IS NULL AND "importCommandHash" IS NULL)
    OR (
      "isImported"
      AND "importIdempotencyKey" IS NOT NULL
      AND length(btrim("importIdempotencyKey")) BETWEEN 8 AND 160
      AND "importCommandHash" IS NOT NULL
      AND "importCommandHash" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

ALTER TABLE "Nasiya"
  ADD CONSTRAINT "Nasiya_creation_command_pair_check"
  CHECK (
    (
      "creationIdempotencyKey" IS NULL
      AND "creationCommandHash" IS NULL
    )
    OR (
      NOT "isImported"
      AND "creationIdempotencyKey" IS NOT NULL
      AND length(btrim("creationIdempotencyKey")) BETWEEN 8 AND 120
      AND "creationCommandHash" IS NOT NULL
      AND "creationCommandHash" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

CREATE TABLE "DevicePurchaseReceipt" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "inputAmount" DECIMAL(12,2) NOT NULL,
  "inputCurrency" "CurrencyCode" NOT NULL,
  "nativeAmount" DECIMAL(12,2) NOT NULL,
  "nativeCurrency" "CurrencyCode" NOT NULL,
  "amountUzsSnapshot" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "paymentBreakdown" JSONB,
  "exchangeRate" DECIMAL(12,4),
  "exchangeRateSource" TEXT,
  "exchangeRateEffectiveAt" TIMESTAMP(3),
  "exchangeRateFetchedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "evidenceVersion" INTEGER NOT NULL DEFAULT 2,
  "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT 'CAPTURED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DevicePurchaseReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DevicePurchaseReceipt_evidence_check" CHECK (
    "evidenceVersion" = 2
    AND "evidenceStatus" = 'CAPTURED'
    AND "inputAmount" > 0
    AND "nativeAmount" = "inputAmount"
    AND "nativeCurrency" = "inputCurrency"
    AND "amountUzsSnapshot" > 0
    AND length(btrim("actorId")) > 0
    AND length(btrim("idempotencyKey")) BETWEEN 8 AND 160
    AND "commandHash" ~ '^[0-9a-f]{64}$'
    AND (
      (
        "inputCurrency" = 'UZS'
        AND trunc("inputAmount") = "inputAmount"
        AND "amountUzsSnapshot" = "inputAmount"
        AND "exchangeRate" IS NULL
        AND "exchangeRateSource" IS NULL
        AND "exchangeRateEffectiveAt" IS NULL
        AND "exchangeRateFetchedAt" IS NULL
      )
      OR (
        "inputCurrency" = 'USD'
        AND "inputAmount" = round("inputAmount", 2)
        AND "exchangeRate" IS NOT NULL
        AND "exchangeRate" BETWEEN 1000 AND 100000
        AND "exchangeRateSource" IS NOT NULL
        AND "exchangeRateSource" IN ('CBU', 'MANUAL')
        AND "exchangeRateEffectiveAt" IS NOT NULL
        AND "exchangeRateFetchedAt" IS NOT NULL
        AND "amountUzsSnapshot" = round("inputAmount" * "exchangeRate")
      )
    )
  )
);

CREATE UNIQUE INDEX "DevicePurchaseReceipt_deviceId_key"
  ON "DevicePurchaseReceipt"("deviceId");
CREATE UNIQUE INDEX "DevicePurchaseReceipt_id_shopId_key"
  ON "DevicePurchaseReceipt"("id", "shopId");
CREATE UNIQUE INDEX "DevicePurchaseReceipt_deviceId_shopId_key"
  ON "DevicePurchaseReceipt"("deviceId", "shopId");
CREATE UNIQUE INDEX "DevicePurchaseReceipt_shopId_idempotencyKey_key"
  ON "DevicePurchaseReceipt"("shopId", "idempotencyKey");
CREATE INDEX "DevicePurchaseReceipt_shopId_paidAt_id_idx"
  ON "DevicePurchaseReceipt"("shopId", "paidAt", "id");

ALTER TABLE "DevicePurchaseReceipt"
  ADD CONSTRAINT "DevicePurchaseReceipt_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DevicePurchaseReceipt"
  ADD CONSTRAINT "DevicePurchaseReceipt_deviceId_shopId_fkey"
  FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Version 1 is an explicit compatibility category, not permission to label
-- incomplete data CAPTURED. Version 2 requires the complete receipt package.
ALTER TABLE "CurrencyRate"
  ADD CONSTRAINT "CurrencyRate_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "baseCurrency" = 'USD'
      AND "quoteCurrency" = 'UZS'
      AND "rate" BETWEEN 1000 AND 100000
      AND "source" IN ('CBU', 'MANUAL')
      AND "effectiveDate" IS NOT NULL
      AND "providerReference" IS NOT NULL
      AND length(btrim("providerReference")) > 0
      AND (
        ("recordedById" IS NULL AND "recordedByType" IS NULL)
        OR ("recordedById" IS NOT NULL AND "recordedByType" IS NOT NULL)
      )
      AND (
        (
          "source" = 'CBU'
        )
        OR (
          "source" = 'MANUAL'
          AND "recordedById" IS NOT NULL
          AND "recordedByType" IS NOT NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_purchase_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND (
        (
          "isImported"
          AND "evidenceStatus" = 'UNRECONSTRUCTABLE'
          AND "purchasePrice" = 0
          AND "purchaseInputAmount" = 0
          AND "purchaseAmountUzsSnapshot" = 0
          AND "purchaseExchangeRateAtCreation" IS NULL
          AND "purchaseExchangeRateSource" IS NULL
          AND "purchaseExchangeRateEffectiveAt" IS NULL
          AND "purchaseExchangeRateFetchedAt" IS NULL
        )
        OR (
          NOT "isImported"
          AND "evidenceStatus" = 'CAPTURED'
          AND "purchaseInputAmount" > 0
          AND "purchaseAmountUzsSnapshot" > 0
          AND "purchasePrice" = "purchaseAmountUzsSnapshot"
          AND length(btrim("addedBy")) > 0
          AND (
            (
              "purchaseCurrency" = 'UZS'
              AND trunc("purchaseInputAmount") = "purchaseInputAmount"
              AND "purchaseAmountUzsSnapshot" = "purchaseInputAmount"
              AND "purchaseExchangeRateAtCreation" IS NULL
              AND "purchaseExchangeRateSource" IS NULL
              AND "purchaseExchangeRateEffectiveAt" IS NULL
              AND "purchaseExchangeRateFetchedAt" IS NULL
            )
            OR (
              "purchaseCurrency" = 'USD'
              AND "purchaseInputAmount" = round("purchaseInputAmount", 2)
              AND "purchaseExchangeRateAtCreation" IS NOT NULL
              AND "purchaseExchangeRateAtCreation" BETWEEN 1000 AND 100000
              AND "purchaseExchangeRateSource" IS NOT NULL
              AND "purchaseExchangeRateSource" IN ('CBU', 'MANUAL')
              AND "purchaseExchangeRateEffectiveAt" IS NOT NULL
              AND "purchaseExchangeRateFetchedAt" IS NOT NULL
              AND "purchaseAmountUzsSnapshot" = round(
                "purchaseInputAmount" * "purchaseExchangeRateAtCreation"
              )
            )
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_creation_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "creationCurrency" IS NOT NULL
      AND "creationCurrency" = "contractCurrency"
      AND "creationExchangeRate" IS NOT DISTINCT FROM "contractExchangeRateAtCreation"
      AND "creationIdempotencyKey" IS NOT NULL
      AND length(btrim("creationIdempotencyKey")) BETWEEN 8 AND 160
      AND "creationCommandHash" IS NOT NULL
      AND "creationCommandHash" ~ '^[0-9a-f]{64}$'
      AND length(btrim("createdBy")) > 0
      AND (
        (
          "contractCurrency" = 'UZS'
          AND trunc("contractSalePrice") = "contractSalePrice"
          AND "salePrice" = "contractSalePrice"
          AND "creationExchangeRate" IS NULL
          AND "creationExchangeRateSource" IS NULL
          AND "creationExchangeRateEffectiveAt" IS NULL
          AND "creationExchangeRateFetchedAt" IS NULL
        )
        OR (
          "contractCurrency" = 'USD'
          AND "creationExchangeRate" IS NOT NULL
          AND "creationExchangeRate" BETWEEN 1000 AND 100000
          AND "creationExchangeRateSource" IS NOT NULL
          AND "creationExchangeRateSource" IN ('CBU', 'MANUAL')
          AND "creationExchangeRateEffectiveAt" IS NOT NULL
          AND "creationExchangeRateFetchedAt" IS NOT NULL
          AND "salePrice" = round("contractSalePrice" * "creationExchangeRate")
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "Nasiya"
  ADD CONSTRAINT "Nasiya_creation_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "creationCurrency" IS NOT NULL
      AND "creationCurrency" = "contractCurrency"
      AND "creationExchangeRate" IS NOT DISTINCT FROM "contractExchangeRateAtCreation"
      AND length(btrim("createdBy")) > 0
      AND (
        (
          NOT "isImported"
          AND "evidenceStatus" = 'CAPTURED'
          AND "creationIdempotencyKey" IS NOT NULL
          AND length(btrim("creationIdempotencyKey")) BETWEEN 8 AND 120
          AND "creationCommandHash" IS NOT NULL
          AND "creationCommandHash" ~ '^[0-9a-f]{64}$'
          AND "importIdempotencyKey" IS NULL
          AND "importCommandHash" IS NULL
        )
        OR (
          "isImported"
          AND "evidenceStatus" = 'PARTIAL'
          AND "creationIdempotencyKey" IS NULL
          AND "creationCommandHash" IS NULL
          AND "importIdempotencyKey" IS NOT NULL
          AND length(btrim("importIdempotencyKey")) BETWEEN 8 AND 160
          AND "importCommandHash" IS NOT NULL
          AND "importCommandHash" ~ '^[0-9a-f]{64}$'
        )
      )
      AND (
        (
          "contractCurrency" = 'UZS'
          AND trunc("contractTotalAmount") = "contractTotalAmount"
          AND "totalAmount" = "contractTotalAmount"
          AND "creationExchangeRate" IS NULL
          AND "creationExchangeRateSource" IS NULL
          AND "creationExchangeRateEffectiveAt" IS NULL
          AND "creationExchangeRateFetchedAt" IS NULL
        )
        OR (
          "contractCurrency" = 'USD'
          AND "creationExchangeRate" IS NOT NULL
          AND "creationExchangeRate" BETWEEN 1000 AND 100000
          AND "creationExchangeRateSource" IS NOT NULL
          AND "creationExchangeRateSource" IN ('CBU', 'MANUAL')
          AND "creationExchangeRateEffectiveAt" IS NOT NULL
          AND "creationExchangeRateFetchedAt" IS NOT NULL
          AND "totalAmount" = round("contractTotalAmount" * "creationExchangeRate")
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "SupplierPayable"
  ADD CONSTRAINT "SupplierPayable_creation_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "contractAmount" > 0
      AND "amount" > 0
      AND "creationIdempotencyKey" IS NOT NULL
      AND length(btrim("creationIdempotencyKey")) BETWEEN 8 AND 160
      AND "creationCommandHash" IS NOT NULL
      AND "creationCommandHash" ~ '^[0-9a-f]{64}$'
      AND length(btrim("createdBy")) > 0
      AND (
        (
          "contractCurrency" = 'UZS'
          AND trunc("contractAmount") = "contractAmount"
          AND "amount" = "contractAmount"
          AND "contractExchangeRateAtCreation" IS NULL
          AND "contractExchangeRateSourceAtCreation" IS NULL
          AND "contractExchangeRateEffectiveAtCreation" IS NULL
          AND "contractExchangeRateFetchedAtCreation" IS NULL
        )
        OR (
          "contractCurrency" = 'USD'
          AND "contractExchangeRateAtCreation" IS NOT NULL
          AND "contractExchangeRateAtCreation" BETWEEN 1000 AND 100000
          AND "contractExchangeRateSourceAtCreation" IS NOT NULL
          AND "contractExchangeRateSourceAtCreation" IN ('CBU', 'MANUAL')
          AND "contractExchangeRateEffectiveAtCreation" IS NOT NULL
          AND "contractExchangeRateFetchedAtCreation" IS NOT NULL
          AND "amount" = round("contractAmount" * "contractExchangeRateAtCreation")
        )
      )
    )
  ) NOT VALID;

-- Parent rows mix immutable creation facts with mutable operational
-- projections. CHECK constraints prove that the current values reconcile, but
-- cannot prove that a coherent amount/rate/provenance bundle was not rewritten
-- after creation. Protect only version-2 creation facts so the compatibility
-- window and explicit legacy reconstruction remain possible. Column-specific
-- triggers keep normal payment, reminder, status, return, and reconstruction
-- updates off this path entirely.
CREATE FUNCTION "protect_device_v2_purchase_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."evidenceVersion" = 2
    AND ROW(
      OLD."shopId",
      OLD."addedBy",
      OLD."createdAt",
      OLD."isImported",
      OLD."isExternalSourced",
      OLD."evidenceVersion",
      OLD."evidenceStatus"
    ) IS DISTINCT FROM ROW(
      NEW."shopId",
      NEW."addedBy",
      NEW."createdAt",
      NEW."isImported",
      NEW."isExternalSourced",
      NEW."evidenceVersion",
      NEW."evidenceStatus"
    ) THEN
    RAISE EXCEPTION 'version-2 device identity evidence is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'Device_v2_purchase_evidence_immutable';
  END IF;

  IF OLD."evidenceVersion" <> 2
    OR ROW(
      OLD."purchasePrice",
      OLD."purchaseCurrency",
      OLD."purchaseInputAmount",
      OLD."purchaseExchangeRateAtCreation",
      OLD."purchaseExchangeRateSource",
      OLD."purchaseExchangeRateEffectiveAt",
      OLD."purchaseExchangeRateFetchedAt",
      OLD."purchaseAmountUzsSnapshot",
      OLD."supplierId",
      OLD."supplierPhone"
    ) IS NOT DISTINCT FROM ROW(
      NEW."purchasePrice",
      NEW."purchaseCurrency",
      NEW."purchaseInputAmount",
      NEW."purchaseExchangeRateAtCreation",
      NEW."purchaseExchangeRateSource",
      NEW."purchaseExchangeRateEffectiveAt",
      NEW."purchaseExchangeRateFetchedAt",
      NEW."purchaseAmountUzsSnapshot",
      NEW."supplierId",
      NEW."supplierPhone"
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'version-2 device purchase evidence is immutable'
    USING ERRCODE = '23514',
      CONSTRAINT = 'Device_v2_purchase_evidence_immutable';
END;
$$;

CREATE FUNCTION "protect_sale_v2_creation_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."evidenceVersion" = 2
    AND ROW(
      OLD."shopId",
      OLD."deviceId",
      OLD."customerId",
      OLD."salePrice",
      OLD."creationCurrency",
      OLD."creationExchangeRate",
      OLD."creationExchangeRateSource",
      OLD."creationExchangeRateEffectiveAt",
      OLD."creationExchangeRateFetchedAt",
      OLD."contractCurrency",
      OLD."contractExchangeRateAtCreation",
      OLD."contractSalePrice",
      OLD."createdAt",
      OLD."createdBy",
      OLD."creationIdempotencyKey",
      OLD."creationCommandHash",
      OLD."evidenceVersion",
      OLD."evidenceStatus"
    ) IS DISTINCT FROM ROW(
      NEW."shopId",
      NEW."deviceId",
      NEW."customerId",
      NEW."salePrice",
      NEW."creationCurrency",
      NEW."creationExchangeRate",
      NEW."creationExchangeRateSource",
      NEW."creationExchangeRateEffectiveAt",
      NEW."creationExchangeRateFetchedAt",
      NEW."contractCurrency",
      NEW."contractExchangeRateAtCreation",
      NEW."contractSalePrice",
      NEW."createdAt",
      NEW."createdBy",
      NEW."creationIdempotencyKey",
      NEW."creationCommandHash",
      NEW."evidenceVersion",
      NEW."evidenceStatus"
    ) THEN
    RAISE EXCEPTION 'version-2 sale creation evidence is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'Sale_v2_creation_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_nasiya_v2_creation_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."evidenceVersion" = 2
    AND ROW(
      OLD."shopId",
      OLD."deviceId",
      OLD."customerId",
      OLD."totalAmount",
      OLD."downPayment",
      OLD."baseRemainingAmount",
      OLD."interestPercent",
      OLD."interestAmount",
      OLD."finalNasiyaAmount",
      OLD.months,
      OLD."monthlyPayment",
      OLD."startDate",
      OLD."creationCurrency",
      OLD."creationExchangeRate",
      OLD."creationExchangeRateSource",
      OLD."creationExchangeRateEffectiveAt",
      OLD."creationExchangeRateFetchedAt",
      OLD."contractCurrency",
      OLD."contractExchangeRateAtCreation",
      OLD."contractTotalAmount",
      OLD."contractDownPayment",
      OLD."contractBaseRemainingAmount",
      OLD."contractInterestAmount",
      OLD."contractFinalAmount",
      OLD."contractMonthlyPayment",
      OLD."createdAt",
      OLD."createdBy",
      OLD."creationIdempotencyKey",
      OLD."creationCommandHash",
      OLD."isImported",
      OLD."importSource",
      OLD."importIdempotencyKey",
      OLD."importCommandHash",
      OLD."importedAt",
      OLD."importedById",
      OLD."originalSaleDate",
      OLD."originalTotalAmount",
      OLD."alreadyPaidBeforeImport",
      OLD."remainingAtImport",
      OLD."evidenceVersion",
      OLD."evidenceStatus"
    ) IS DISTINCT FROM ROW(
      NEW."shopId",
      NEW."deviceId",
      NEW."customerId",
      NEW."totalAmount",
      NEW."downPayment",
      NEW."baseRemainingAmount",
      NEW."interestPercent",
      NEW."interestAmount",
      NEW."finalNasiyaAmount",
      NEW.months,
      NEW."monthlyPayment",
      NEW."startDate",
      NEW."creationCurrency",
      NEW."creationExchangeRate",
      NEW."creationExchangeRateSource",
      NEW."creationExchangeRateEffectiveAt",
      NEW."creationExchangeRateFetchedAt",
      NEW."contractCurrency",
      NEW."contractExchangeRateAtCreation",
      NEW."contractTotalAmount",
      NEW."contractDownPayment",
      NEW."contractBaseRemainingAmount",
      NEW."contractInterestAmount",
      NEW."contractFinalAmount",
      NEW."contractMonthlyPayment",
      NEW."createdAt",
      NEW."createdBy",
      NEW."creationIdempotencyKey",
      NEW."creationCommandHash",
      NEW."isImported",
      NEW."importSource",
      NEW."importIdempotencyKey",
      NEW."importCommandHash",
      NEW."importedAt",
      NEW."importedById",
      NEW."originalSaleDate",
      NEW."originalTotalAmount",
      NEW."alreadyPaidBeforeImport",
      NEW."remainingAtImport",
      NEW."evidenceVersion",
      NEW."evidenceStatus"
    ) THEN
    RAISE EXCEPTION 'version-2 nasiya creation evidence is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'Nasiya_v2_creation_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_supplier_payable_v2_creation_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."evidenceVersion" = 2
    AND ROW(
      OLD."shopId",
      OLD."deviceId",
      OLD."saleId",
      OLD."olibSotdimOperationId",
      OLD."supplierId",
      OLD.origin,
      OLD."supplierName",
      OLD."supplierPhone",
      OLD."supplierLocation",
      OLD.amount,
      OLD."contractCurrency",
      OLD."contractExchangeRateAtCreation",
      OLD."contractExchangeRateSourceAtCreation",
      OLD."contractExchangeRateEffectiveAtCreation",
      OLD."contractExchangeRateFetchedAtCreation",
      OLD."contractAmount",
      OLD."createdAt",
      OLD."createdBy",
      OLD."creationIdempotencyKey",
      OLD."creationCommandHash",
      OLD."evidenceVersion",
      OLD."evidenceStatus"
    ) IS DISTINCT FROM ROW(
      NEW."shopId",
      NEW."deviceId",
      NEW."saleId",
      NEW."olibSotdimOperationId",
      NEW."supplierId",
      NEW.origin,
      NEW."supplierName",
      NEW."supplierPhone",
      NEW."supplierLocation",
      NEW.amount,
      NEW."contractCurrency",
      NEW."contractExchangeRateAtCreation",
      NEW."contractExchangeRateSourceAtCreation",
      NEW."contractExchangeRateEffectiveAtCreation",
      NEW."contractExchangeRateFetchedAtCreation",
      NEW."contractAmount",
      NEW."createdAt",
      NEW."createdBy",
      NEW."creationIdempotencyKey",
      NEW."creationCommandHash",
      NEW."evidenceVersion",
      NEW."evidenceStatus"
    ) THEN
    RAISE EXCEPTION 'version-2 supplier payable creation evidence is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'SupplierPayable_v2_creation_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Device_v2_purchase_evidence_immutable"
  BEFORE UPDATE OF
    "shopId", "addedBy", "createdAt", "isImported", "isExternalSourced",
    "evidenceVersion", "evidenceStatus",
    "purchasePrice", "purchaseCurrency", "purchaseInputAmount",
    "purchaseExchangeRateAtCreation", "purchaseExchangeRateSource",
    "purchaseExchangeRateEffectiveAt", "purchaseExchangeRateFetchedAt",
    "purchaseAmountUzsSnapshot", "supplierId", "supplierPhone"
  ON "Device"
  FOR EACH ROW EXECUTE FUNCTION "protect_device_v2_purchase_evidence"();

CREATE TRIGGER "Sale_v2_creation_evidence_immutable"
  BEFORE UPDATE OF
    "shopId", "deviceId", "customerId", "salePrice", "creationCurrency",
    "creationExchangeRate", "creationExchangeRateSource",
    "creationExchangeRateEffectiveAt", "creationExchangeRateFetchedAt",
    "contractCurrency", "contractExchangeRateAtCreation", "contractSalePrice",
    "createdAt", "createdBy", "creationIdempotencyKey", "creationCommandHash",
    "evidenceVersion", "evidenceStatus"
  ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION "protect_sale_v2_creation_evidence"();

CREATE TRIGGER "Nasiya_v2_creation_evidence_immutable"
  BEFORE UPDATE OF
    "shopId", "deviceId", "customerId", "totalAmount", "downPayment",
    "baseRemainingAmount", "interestPercent", "interestAmount",
    "finalNasiyaAmount", months, "monthlyPayment", "startDate",
    "creationCurrency", "creationExchangeRate", "creationExchangeRateSource",
    "creationExchangeRateEffectiveAt", "creationExchangeRateFetchedAt",
    "contractCurrency", "contractExchangeRateAtCreation",
    "contractTotalAmount", "contractDownPayment", "contractBaseRemainingAmount",
    "contractInterestAmount", "contractFinalAmount", "contractMonthlyPayment",
    "createdAt", "createdBy", "creationIdempotencyKey",
    "creationCommandHash", "isImported", "importSource",
    "importIdempotencyKey", "importCommandHash", "importedAt", "importedById",
    "originalSaleDate", "originalTotalAmount", "alreadyPaidBeforeImport",
    "remainingAtImport", "evidenceVersion", "evidenceStatus"
  ON "Nasiya"
  FOR EACH ROW EXECUTE FUNCTION "protect_nasiya_v2_creation_evidence"();

CREATE TRIGGER "SupplierPayable_v2_creation_evidence_immutable"
  BEFORE UPDATE OF
    "shopId", "deviceId", "saleId", "olibSotdimOperationId", "supplierId",
    origin, "supplierName", "supplierPhone", "supplierLocation", amount,
    "contractCurrency", "contractExchangeRateAtCreation",
    "contractExchangeRateSourceAtCreation",
    "contractExchangeRateEffectiveAtCreation",
    "contractExchangeRateFetchedAtCreation", "contractAmount", "createdAt",
    "createdBy", "creationIdempotencyKey", "creationCommandHash",
    "evidenceVersion", "evidenceStatus"
  ON "SupplierPayable"
  FOR EACH ROW EXECUTE FUNCTION "protect_supplier_payable_v2_creation_evidence"();

-- A captured, non-imported device is not complete financial evidence by
-- itself. At commit it must have exactly one acquisition source:
--   * a cash DevicePurchaseReceipt for normal PAID_NOW inventory, or
--   * one captured SupplierPayable for normal PAY_LATER or Olib-sotdim.
-- Constraint triggers are deferred because the Device parent must be inserted
-- before its evidence child inside the same transaction.
CREATE FUNCTION "validate_device_acquisition_evidence_link"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_device_id TEXT;
  target_shop_id TEXT;
  target_is_imported BOOLEAN;
  target_is_external BOOLEAN;
  target_evidence_version INTEGER;
  receipt_links INTEGER;
  payable_links INTEGER;
  payable_origin "SupplierPayableOrigin";
  payable_operation_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Device' THEN
    target_device_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    -- NEW is unassigned in a DELETE trigger; referencing NEW."deviceId"
    -- directly would hide the intended acquisition-integrity failure behind
    -- a PL/pgSQL record error.
    target_device_id := OLD."deviceId";
  ELSE
    target_device_id := NEW."deviceId";
  END IF;

  SELECT
    device."shopId",
    device."isImported",
    device."isExternalSourced",
    device."evidenceVersion"
  INTO
    target_shop_id,
    target_is_imported,
    target_is_external,
    target_evidence_version
  FROM "Device" device
  WHERE device.id = target_device_id;

  IF NOT FOUND OR target_evidence_version <> 2 OR target_is_imported THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)::integer
  INTO receipt_links
  FROM (
    SELECT 1
    FROM "DevicePurchaseReceipt" receipt
    WHERE receipt."deviceId" = target_device_id
      AND receipt."shopId" = target_shop_id
      AND receipt."evidenceVersion" = 2
      AND receipt."evidenceStatus" = 'CAPTURED'
    LIMIT 2
  ) bounded_receipts;

  SELECT COUNT(*)::integer
  INTO payable_links
  FROM (
    SELECT 1
    FROM "SupplierPayable" payable
    WHERE payable."deviceId" = target_device_id
      AND payable."shopId" = target_shop_id
      AND payable."evidenceVersion" = 2
      AND payable."evidenceStatus" = 'CAPTURED'
    LIMIT 2
  ) bounded_payables;

  IF receipt_links + payable_links <> 1 THEN
    RAISE EXCEPTION 'captured device requires exactly one acquisition evidence source'
      USING ERRCODE = '23514',
        CONSTRAINT = 'Device_acquisition_evidence_complete';
  END IF;

  IF receipt_links = 1 AND target_is_external THEN
    RAISE EXCEPTION 'Olib-sotdim device requires supplier payable acquisition evidence'
      USING ERRCODE = '23514',
        CONSTRAINT = 'Device_acquisition_evidence_complete';
  END IF;

  IF payable_links = 1 THEN
    SELECT payable.origin, payable."olibSotdimOperationId"
    INTO payable_origin, payable_operation_id
    FROM "SupplierPayable" payable
    WHERE payable."deviceId" = target_device_id
      AND payable."shopId" = target_shop_id
      AND payable."evidenceVersion" = 2
      AND payable."evidenceStatus" = 'CAPTURED';

    IF (
      target_is_external
      AND (
        payable_origin <> 'OLIB_SOTDIM'
        OR payable_operation_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM "OlibSotdimOperation" operation
          WHERE operation.id = payable_operation_id
            AND operation."shopId" = target_shop_id
            AND operation."deviceId" = target_device_id
        )
      )
    ) OR (
      NOT target_is_external
      AND (
        payable_origin <> 'DEVICE_PURCHASE'
        OR payable_operation_id IS NOT NULL
      )
    ) THEN
      RAISE EXCEPTION 'device acquisition evidence source does not match its origin'
        USING ERRCODE = '23514',
          CONSTRAINT = 'Device_acquisition_evidence_complete';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Device_acquisition_evidence_complete"
  AFTER INSERT OR UPDATE OF
    "evidenceVersion", "evidenceStatus", "isImported", "isExternalSourced"
  ON "Device"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_device_acquisition_evidence_link"();

CREATE CONSTRAINT TRIGGER "SupplierPayable_device_acquisition_evidence_complete"
  AFTER INSERT OR UPDATE OR DELETE
  ON "SupplierPayable"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_device_acquisition_evidence_link"();

ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "deletedAt" IS NULL
      AND "amount" > 0
      AND "idempotencyKey" IS NOT NULL
      AND length(btrim("idempotencyKey")) BETWEEN 8 AND 160
      AND "commandHash" IS NOT NULL
      AND "commandHash" ~ '^[0-9a-f]{64}$'
      AND (
        (
          "currency" = 'UZS'
          AND trunc("amount") = "amount"
          AND "amountUzsSnapshot" IS NOT NULL
          AND "amountUzsSnapshot" = "amount"
          AND (
            (
              "exchangeRateAtPayment" IS NULL
              AND "exchangeRateSourceAtPayment" IS NULL
              AND "exchangeRateEffectiveAtPayment" IS NULL
              AND "exchangeRateFetchedAtPayment" IS NULL
              AND "amountUsdSnapshot" IS NULL
            )
            OR (
              "exchangeRateAtPayment" IS NOT NULL
              AND "exchangeRateAtPayment" BETWEEN 1000 AND 100000
              AND "exchangeRateSourceAtPayment" IS NOT NULL
              AND "exchangeRateSourceAtPayment" IN ('CBU', 'MANUAL')
              AND "exchangeRateEffectiveAtPayment" IS NOT NULL
              AND "exchangeRateFetchedAtPayment" IS NOT NULL
              AND "amountUsdSnapshot" = round("amount" / "exchangeRateAtPayment", 2)
            )
          )
        )
        OR (
          "currency" = 'USD'
          AND "amount" = round("amount", 2)
          AND "amountUsdSnapshot" IS NOT NULL
          AND "amountUsdSnapshot" = "amount"
          AND (
            (
              "exchangeRateAtPayment" IS NULL
              AND "exchangeRateSourceAtPayment" IS NULL
              AND "exchangeRateEffectiveAtPayment" IS NULL
              AND "exchangeRateFetchedAtPayment" IS NULL
              AND "amountUzsSnapshot" IS NULL
            )
            OR (
              "exchangeRateAtPayment" IS NOT NULL
              AND "exchangeRateAtPayment" BETWEEN 1000 AND 100000
              AND "exchangeRateSourceAtPayment" IS NOT NULL
              AND "exchangeRateSourceAtPayment" IN ('CBU', 'MANUAL')
              AND "exchangeRateEffectiveAtPayment" IS NOT NULL
              AND "exchangeRateFetchedAtPayment" IS NOT NULL
              AND "amountUzsSnapshot" = round("amount" * "exchangeRateAtPayment")
            )
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "deletedAt" IS NULL
      AND "amount" > 0
      AND "paymentInputAmount" IS NOT NULL
      AND "paymentInputAmount" > 0
      AND "paymentInputCurrency" IS NOT NULL
      AND "appliedAmountInContractCurrency" IS NOT NULL
      AND "appliedAmountInContractCurrency" > 0
      AND "idempotencyKey" IS NOT NULL
      AND length(btrim("idempotencyKey")) BETWEEN 8 AND 160
      AND length(btrim("createdBy")) > 0
      AND (
        (
          "paymentExchangeRate" IS NULL
          AND (
            (
              "paymentExchangeRateSource" IS NULL
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
            OR (
              "paymentInputCurrency" = 'USD'
              AND "paymentExchangeRateSource" = 'UNAVAILABLE_SAME_CURRENCY'
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
          )
        )
        OR (
          "paymentExchangeRate" IS NOT NULL
          AND "paymentExchangeRate" BETWEEN 1000 AND 100000
          AND "paymentExchangeRateSource" IS NOT NULL
          AND "paymentExchangeRateSource" IN ('CBU', 'MANUAL')
          AND "paymentExchangeRateEffectiveAt" IS NOT NULL
          AND "paymentExchangeRateFetchedAt" IS NOT NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "NasiyaPayment"
  ADD CONSTRAINT "NasiyaPayment_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "deletedAt" IS NULL
      AND "amount" > 0
      AND "paymentInputAmount" IS NOT NULL
      AND "paymentInputAmount" > 0
      AND "paymentInputCurrency" IS NOT NULL
      AND "appliedAmountInContractCurrency" IS NOT NULL
      AND "appliedAmountInContractCurrency" > 0
      AND "paymentMethod" IS NOT NULL
      AND "idempotencyKey" IS NOT NULL
      AND length(btrim("idempotencyKey")) BETWEEN 8 AND 160
      AND length(btrim("createdBy")) > 0
      AND (
        (
          "paymentExchangeRate" IS NULL
          AND (
            (
              "paymentExchangeRateSource" IS NULL
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
            OR (
              "paymentInputCurrency" = 'USD'
              AND "paymentExchangeRateSource" = 'UNAVAILABLE_SAME_CURRENCY'
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
          )
        )
        OR (
          "paymentExchangeRate" IS NOT NULL
          AND "paymentExchangeRate" BETWEEN 1000 AND 100000
          AND "paymentExchangeRateSource" IS NOT NULL
          AND "paymentExchangeRateSource" IN ('CBU', 'MANUAL')
          AND "paymentExchangeRateEffectiveAt" IS NOT NULL
          AND "paymentExchangeRateFetchedAt" IS NOT NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "SupplierPayablePayment"
  ADD CONSTRAINT "SupplierPayablePayment_evidence_check" CHECK (
    (
      "evidenceVersion" = 1
      AND "evidenceStatus" = 'LEGACY_UNKNOWN'
    )
    OR (
      "evidenceVersion" = 2
      AND "evidenceStatus" = 'CAPTURED'
      AND "amount" > 0
      AND "paymentInputAmount" > 0
      AND "appliedAmountInContractCurrency" > 0
      AND length(btrim("createdBy")) > 0
      AND length(btrim("idempotencyKey")) BETWEEN 8 AND 160
      AND "commandHash" ~ '^[0-9a-f]{64}$'
      AND (
        (
          "paymentExchangeRate" IS NULL
          AND (
            (
              "paymentExchangeRateSource" IS NULL
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
            OR (
              "paymentInputCurrency" = 'USD'
              AND "paymentExchangeRateSource" = 'UNAVAILABLE_SAME_CURRENCY'
              AND "paymentExchangeRateEffectiveAt" IS NULL
              AND "paymentExchangeRateFetchedAt" IS NULL
            )
          )
        )
        OR (
          "paymentExchangeRate" IS NOT NULL
          AND "paymentExchangeRate" BETWEEN 1000 AND 100000
          AND "paymentExchangeRateSource" IS NOT NULL
          AND "paymentExchangeRateSource" IN ('CBU', 'MANUAL')
          AND "paymentExchangeRateEffectiveAt" IS NOT NULL
          AND "paymentExchangeRateFetchedAt" IS NOT NULL
        )
      )
    )
  ) NOT VALID;

-- Cross-table reconciliation cannot be expressed by a CHECK. These insert
-- guards prove the native amount and the UZS reporting snapshot against the
-- parent contract for every version-2 receipt.
CREATE FUNCTION "validate_sale_payment_v2_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  contract_currency "CurrencyCode";
  contract_creation_rate NUMERIC(12,4);
BEGIN
  IF NEW."evidenceVersion" <> 2 THEN RETURN NEW; END IF;

  SELECT sale."contractCurrency", sale."contractExchangeRateAtCreation"
  INTO contract_currency, contract_creation_rate
  FROM "Sale" sale
  WHERE sale.id = NEW."saleId" AND sale."shopId" = NEW."shopId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale payment evidence parent is missing or cross-tenant';
  END IF;

  IF NEW."paymentInputCurrency" = 'UZS' THEN
    IF trunc(NEW."paymentInputAmount") <> NEW."paymentInputAmount"
      OR NEW.amount <> NEW."paymentInputAmount" THEN
      RAISE EXCEPTION 'sale payment UZS input does not match its UZS snapshot';
    END IF;
    IF contract_currency = 'UZS' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount"
        OR NEW."paymentExchangeRate" IS NOT NULL THEN
        RAISE EXCEPTION 'same-currency sale payment evidence is inconsistent';
      END IF;
    ELSIF NEW."paymentExchangeRate" IS NULL
      OR NEW."appliedAmountInContractCurrency" <> round(
        NEW."paymentInputAmount" / NEW."paymentExchangeRate", 2
      ) THEN
      RAISE EXCEPTION 'sale payment contract conversion is inconsistent';
    END IF;
  ELSE
    IF contract_currency = 'USD' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount" THEN
        RAISE EXCEPTION 'same-currency sale payment native amount is inconsistent';
      END IF;
      IF NEW."paymentExchangeRate" IS NOT NULL THEN
        IF NEW.amount <> round(NEW."paymentInputAmount" * NEW."paymentExchangeRate") THEN
          RAISE EXCEPTION 'sale payment USD input does not match its UZS snapshot';
        END IF;
      ELSIF NEW."paymentExchangeRateSource" IS DISTINCT FROM 'UNAVAILABLE_SAME_CURRENCY'
        OR contract_creation_rate IS NULL
        OR contract_creation_rate NOT BETWEEN 1000 AND 100000
        OR NEW.amount <> round(NEW."paymentInputAmount" * contract_creation_rate) THEN
        RAISE EXCEPTION 'sale payment frozen UZS fallback is not provable';
      END IF;
    ELSIF NEW."paymentExchangeRate" IS NULL
      OR NEW.amount <> round(NEW."paymentInputAmount" * NEW."paymentExchangeRate")
      OR NEW."appliedAmountInContractCurrency" <> NEW.amount THEN
      RAISE EXCEPTION 'sale payment USD-to-UZS conversion is inconsistent';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SalePayment_validate_v2_evidence"
  BEFORE INSERT ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION "validate_sale_payment_v2_evidence"();

CREATE FUNCTION "validate_nasiya_payment_v2_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  contract_currency "CurrencyCode";
  contract_creation_rate NUMERIC(12,4);
BEGIN
  IF NEW."evidenceVersion" <> 2 THEN RETURN NEW; END IF;

  SELECT nasiya."contractCurrency", nasiya."contractExchangeRateAtCreation"
  INTO contract_currency, contract_creation_rate
  FROM "Nasiya" nasiya
  WHERE nasiya.id = NEW."nasiyaId" AND nasiya."shopId" = NEW."shopId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'nasiya payment evidence parent is missing or cross-tenant';
  END IF;

  IF NEW."paymentInputCurrency" = 'UZS' THEN
    IF trunc(NEW."paymentInputAmount") <> NEW."paymentInputAmount"
      OR NEW.amount <> NEW."paymentInputAmount" THEN
      RAISE EXCEPTION 'nasiya payment UZS input does not match its UZS snapshot';
    END IF;
    IF contract_currency = 'UZS' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount"
        OR NEW."paymentExchangeRate" IS NOT NULL THEN
        RAISE EXCEPTION 'same-currency nasiya payment evidence is inconsistent';
      END IF;
    ELSIF NEW."paymentExchangeRate" IS NULL
      OR NEW."appliedAmountInContractCurrency" <> round(
        NEW."paymentInputAmount" / NEW."paymentExchangeRate", 2
      ) THEN
      RAISE EXCEPTION 'nasiya payment contract conversion is inconsistent';
    END IF;
  ELSE
    IF contract_currency = 'USD' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount" THEN
        RAISE EXCEPTION 'same-currency nasiya payment native amount is inconsistent';
      END IF;
      IF NEW."paymentExchangeRate" IS NOT NULL THEN
        IF NEW.amount <> round(NEW."paymentInputAmount" * NEW."paymentExchangeRate") THEN
          RAISE EXCEPTION 'nasiya payment USD input does not match its UZS snapshot';
        END IF;
      ELSIF NEW."paymentExchangeRateSource" <> 'UNAVAILABLE_SAME_CURRENCY'
        OR contract_creation_rate IS NULL
        OR NEW.amount <> round(NEW."paymentInputAmount" * contract_creation_rate) THEN
        RAISE EXCEPTION 'nasiya payment frozen UZS fallback is not provable';
      END IF;
    ELSE
      -- UZS debt is exact while USD tender can only be represented to cents.
      -- Therefore preserve amount/applied as the native authority and prove
      -- that it rounds to the recorded USD input at the frozen payment rate.
      -- Requiring inverse multiplication to equal UZS would reject a valid
      -- exact settlement such as 500001 UZS at 12500 (USD 40.00 round-trips
      -- to only UZS 500000).
      IF NEW."paymentExchangeRate" IS NULL
        OR trunc(NEW.amount) <> NEW.amount
        OR NEW."appliedAmountInContractCurrency" <> NEW.amount
        OR NEW."paymentInputAmount" <> round(
          NEW."appliedAmountInContractCurrency" / NEW."paymentExchangeRate", 2
        ) THEN
        RAISE EXCEPTION 'nasiya payment USD-to-UZS conversion is inconsistent';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "NasiyaPayment_validate_v2_evidence"
  BEFORE INSERT ON "NasiyaPayment"
  FOR EACH ROW EXECUTE FUNCTION "validate_nasiya_payment_v2_evidence"();

CREATE FUNCTION "validate_supplier_payment_v2_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  contract_currency "CurrencyCode";
  contract_creation_rate NUMERIC(12,4);
BEGIN
  IF NEW."evidenceVersion" <> 2 THEN RETURN NEW; END IF;

  SELECT payable."contractCurrency", payable."contractExchangeRateAtCreation"
  INTO contract_currency, contract_creation_rate
  FROM "SupplierPayable" payable
  WHERE payable.id = NEW."supplierPayableId" AND payable."shopId" = NEW."shopId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier payment evidence parent is missing or cross-tenant';
  END IF;

  IF NEW."paymentInputCurrency" = 'UZS' THEN
    IF trunc(NEW."paymentInputAmount") <> NEW."paymentInputAmount"
      OR NEW.amount <> NEW."paymentInputAmount" THEN
      RAISE EXCEPTION 'supplier payment UZS input does not match its UZS snapshot';
    END IF;
    IF contract_currency = 'UZS' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount"
        OR NEW."paymentExchangeRate" IS NOT NULL THEN
        RAISE EXCEPTION 'same-currency supplier payment evidence is inconsistent';
      END IF;
    ELSIF NEW."paymentExchangeRate" IS NULL
      OR NEW."appliedAmountInContractCurrency" <> round(
        NEW."paymentInputAmount" / NEW."paymentExchangeRate", 2
      ) THEN
      RAISE EXCEPTION 'supplier payment contract conversion is inconsistent';
    END IF;
  ELSE
    IF contract_currency = 'USD' THEN
      IF NEW."appliedAmountInContractCurrency" <> NEW."paymentInputAmount" THEN
        RAISE EXCEPTION 'same-currency supplier payment native amount is inconsistent';
      END IF;
      IF NEW."paymentExchangeRate" IS NOT NULL THEN
        IF NEW.amount <> round(NEW."paymentInputAmount" * NEW."paymentExchangeRate") THEN
          RAISE EXCEPTION 'supplier payment USD input does not match its UZS snapshot';
        END IF;
      ELSIF NEW."paymentExchangeRateSource" IS DISTINCT FROM 'UNAVAILABLE_SAME_CURRENCY'
        OR contract_creation_rate IS NULL
        OR contract_creation_rate NOT BETWEEN 1000 AND 100000
        OR NEW.amount <> round(NEW."paymentInputAmount" * contract_creation_rate) THEN
        RAISE EXCEPTION 'supplier payment frozen UZS fallback is not provable';
      END IF;
    ELSIF NEW."paymentExchangeRate" IS NULL
      OR NEW.amount <> round(NEW."paymentInputAmount" * NEW."paymentExchangeRate")
      OR NEW."appliedAmountInContractCurrency" <> NEW.amount THEN
      RAISE EXCEPTION 'supplier payment USD-to-UZS conversion is inconsistent';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupplierPayablePayment_validate_v2_evidence"
  BEFORE INSERT ON "SupplierPayablePayment"
  FOR EACH ROW EXECUTE FUNCTION "validate_supplier_payment_v2_evidence"();

CREATE FUNCTION "validate_device_purchase_receipt_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  device_row "Device"%ROWTYPE;
BEGIN
  SELECT * INTO device_row
  FROM "Device"
  WHERE id = NEW."deviceId" AND "shopId" = NEW."shopId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device purchase receipt parent is missing or cross-tenant';
  END IF;

  IF device_row."isImported" THEN
    RAISE EXCEPTION 'imported placeholder devices cannot have paid-now purchase receipts';
  END IF;

  IF NEW."nativeCurrency" <> device_row."purchaseCurrency"
    OR NEW."nativeAmount" <> device_row."purchaseInputAmount"
    OR NEW."amountUzsSnapshot" <> device_row."purchaseAmountUzsSnapshot"
    OR NEW."amountUzsSnapshot" <> device_row."purchasePrice"
    OR NEW."exchangeRate" IS DISTINCT FROM device_row."purchaseExchangeRateAtCreation"
    OR NEW."exchangeRateSource" IS DISTINCT FROM device_row."purchaseExchangeRateSource"
    OR NEW."exchangeRateEffectiveAt" IS DISTINCT FROM device_row."purchaseExchangeRateEffectiveAt"
    OR NEW."exchangeRateFetchedAt" IS DISTINCT FROM device_row."purchaseExchangeRateFetchedAt" THEN
    RAISE EXCEPTION 'device purchase receipt does not match the immutable purchase projection';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DevicePurchaseReceipt_validate_evidence"
  BEFORE INSERT ON "DevicePurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "validate_device_purchase_receipt_evidence"();

-- Posted receipt facts and governed rates are append-only. Corrections require
-- a compensating financial fact; soft-delete and hard DELETE always fail.
-- The one UPDATE exception is the explicit version-1 SalePayment component
-- reconstruction documented below.
CREATE FUNCTION "reject_financial_evidence_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only financial evidence', TG_TABLE_NAME;
END;
$$;

-- SalePayment has four derived profit-component columns that the approved
-- legacy reconstruction job fills after migrations. The receipt itself stays
-- immutable for every evidence version; only those derived columns may change
-- on version-1 rows. Current version-2 writers capture the split at insert, so
-- even the component columns are immutable there.
CREATE FUNCTION "protect_sale_payment_v2_components"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."evidenceVersion" = 2
    AND ROW(
      OLD."contractPrincipalAmount",
      OLD."contractMarginAmount",
      OLD."principalAmountUzs",
      OLD."marginAmountUzs"
    ) IS DISTINCT FROM ROW(
      NEW."contractPrincipalAmount",
      NEW."contractMarginAmount",
      NEW."principalAmountUzs",
      NEW."marginAmountUzs"
    ) THEN
    RAISE EXCEPTION 'version-2 sale payment components are immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'SalePayment_v2_components_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CurrencyRate_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "CurrencyRate"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();
CREATE TRIGGER "ShopPayment_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "ShopPayment"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();
CREATE TRIGGER "SalePayment_evidence_immutable"
  BEFORE UPDATE OF
    id, "saleId", "shopId", amount, "paymentMethod", "paidAt", note,
    "idempotencyKey", "paymentInputAmount", "paymentInputCurrency",
    "paymentExchangeRate", "paymentExchangeRateSource",
    "paymentExchangeRateEffectiveAt", "paymentExchangeRateFetchedAt",
    "appliedAmountInContractCurrency", "paymentBreakdown",
    "paymentDateExplicit", "requestedNextDueDate", "createdBy", "createdAt",
    "evidenceVersion", "evidenceStatus", "deletedAt", "deletedBy", "deleteNote"
  ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();
CREATE TRIGGER "SalePayment_v2_components_immutable"
  BEFORE UPDATE OF
    "contractPrincipalAmount", "contractMarginAmount",
    "principalAmountUzs", "marginAmountUzs"
  ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION "protect_sale_payment_v2_components"();
CREATE TRIGGER "SalePayment_delete_immutable"
  BEFORE DELETE ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();
CREATE TRIGGER "NasiyaPayment_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaPayment"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();
CREATE TRIGGER "DevicePurchaseReceipt_immutable"
  BEFORE UPDATE OR DELETE ON "DevicePurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "reject_financial_evidence_mutation"();

-- Restore source-receipt caps in native contract currency. UZS allocations may
-- differ under later-rate refunds; that real FX gain/loss remains on the return
-- header. Across all returns, no source receipt can fund more native currency
-- than its frozen applied amount.
CREATE OR REPLACE FUNCTION "validate_return_refund_reconciliation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_return_id TEXT;
  return_row "DeviceReturn"%ROWTYPE;
  allocated_contract NUMERIC(12,2);
  allocated_uzs NUMERIC(12,2);
BEGIN
  IF TG_TABLE_NAME = 'DeviceReturn' THEN
    target_return_id := NEW.id;
  ELSE
    target_return_id := NEW."deviceReturnId";
  END IF;

  SELECT * INTO return_row FROM "DeviceReturn" WHERE id = target_return_id;
  IF NOT FOUND OR return_row."ledgerVersion" <> 2 THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM("contractAmount"), 0), COALESCE(SUM("amountUzs"), 0)
  INTO allocated_contract, allocated_uzs
  FROM "ReturnRefundAllocation"
  WHERE "deviceReturnId" = target_return_id;

  IF allocated_contract <> return_row."contractRefundAmount"
    OR allocated_uzs <> return_row."refundAmount" THEN
    RAISE EXCEPTION 'refund allocations do not reconcile to immutable return totals';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReturnRefundAllocation" allocation
    JOIN "SalePayment" payment
      ON payment.id = allocation."salePaymentId"
     AND payment."shopId" = allocation."shopId"
    WHERE allocation."salePaymentId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "ReturnRefundAllocation" current_allocation
        WHERE current_allocation."deviceReturnId" = target_return_id
          AND current_allocation."salePaymentId" = allocation."salePaymentId"
      )
    GROUP BY allocation."salePaymentId", payment."appliedAmountInContractCurrency"
    HAVING payment."appliedAmountInContractCurrency" IS NULL
      OR SUM(allocation."contractAmount") > payment."appliedAmountInContractCurrency"
  ) OR EXISTS (
    SELECT 1
    FROM "ReturnRefundAllocation" allocation
    JOIN "NasiyaPayment" payment
      ON payment.id = allocation."nasiyaPaymentId"
     AND payment."shopId" = allocation."shopId"
    WHERE allocation."nasiyaPaymentId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "ReturnRefundAllocation" current_allocation
        WHERE current_allocation."deviceReturnId" = target_return_id
          AND current_allocation."nasiyaPaymentId" = allocation."nasiyaPaymentId"
      )
    GROUP BY allocation."nasiyaPaymentId", payment."appliedAmountInContractCurrency"
    HAVING payment."appliedAmountInContractCurrency" IS NULL
      OR SUM(allocation."contractAmount") > payment."appliedAmountInContractCurrency"
  ) THEN
    RAISE EXCEPTION 'refund allocation exceeds source receipt native amount';
  END IF;

  RETURN NULL;
END;
$$;

-- Every constraint introduced here can be validated without guessing history:
-- old facts satisfy the explicit version-1 branch and the new receipt table is
-- empty before the current application starts writing version 2.
ALTER TABLE "Nasiya"
  VALIDATE CONSTRAINT "Nasiya_import_command_pair_check";
ALTER TABLE "Nasiya"
  VALIDATE CONSTRAINT "Nasiya_creation_command_pair_check";
ALTER TABLE "CurrencyRate"
  VALIDATE CONSTRAINT "CurrencyRate_evidence_check";
ALTER TABLE "Device"
  VALIDATE CONSTRAINT "Device_purchase_evidence_check";
ALTER TABLE "Sale"
  VALIDATE CONSTRAINT "Sale_creation_evidence_check";
ALTER TABLE "Nasiya"
  VALIDATE CONSTRAINT "Nasiya_creation_evidence_check";
ALTER TABLE "SupplierPayable"
  VALIDATE CONSTRAINT "SupplierPayable_creation_evidence_check";
ALTER TABLE "ShopPayment"
  VALIDATE CONSTRAINT "ShopPayment_evidence_check";
ALTER TABLE "SalePayment"
  VALIDATE CONSTRAINT "SalePayment_evidence_check";
ALTER TABLE "NasiyaPayment"
  VALIDATE CONSTRAINT "NasiyaPayment_evidence_check";
ALTER TABLE "SupplierPayablePayment"
  VALIDATE CONSTRAINT "SupplierPayablePayment_evidence_check";

-- Keep database defaults on the compatibility category during the expand
-- release. The currently-live artifact does not know these columns and must
-- remain able to record financial facts while the unaliased replacement is
-- built and verified. Every new writer supplies version/status explicitly.
-- A follow-up enforcement migration flips these defaults only after this
-- writer-complete artifact is live.
