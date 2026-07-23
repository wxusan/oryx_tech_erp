-- Expand Olib-sotdim to support Sale or Nasiya outcomes and evolve the
-- supplier payable into an append-only partial-payment ledger. The old
-- application remains write-compatible during rollout: legacy Sale-backed
-- payables are accepted and compatibility triggers populate the new totals.

ALTER TYPE "SupplierPayableStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

CREATE TYPE "SupplierPayableOrigin" AS ENUM ('OLIB_SOTDIM', 'DEVICE_PURCHASE');
CREATE TYPE "OlibSotdimDealType" AS ENUM ('SALE', 'NASIYA');

CREATE TABLE "OlibSotdimOperation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "dealType" "OlibSotdimDealType" NOT NULL,
  "saleId" TEXT,
  "nasiyaId" TEXT,
  "createdBy" TEXT NOT NULL,
  "creationIdempotencyKey" TEXT NOT NULL,
  "creationCommandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OlibSotdimOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OlibSotdimOperation_exactly_one_outcome_check" CHECK (
    ("dealType" = 'SALE' AND "saleId" IS NOT NULL AND "nasiyaId" IS NULL)
    OR
    ("dealType" = 'NASIYA' AND "nasiyaId" IS NOT NULL AND "saleId" IS NULL)
  )
);

CREATE UNIQUE INDEX "OlibSotdimOperation_deviceId_key"
  ON "OlibSotdimOperation"("deviceId");
CREATE UNIQUE INDEX "OlibSotdimOperation_saleId_key"
  ON "OlibSotdimOperation"("saleId");
CREATE UNIQUE INDEX "OlibSotdimOperation_nasiyaId_key"
  ON "OlibSotdimOperation"("nasiyaId");
CREATE UNIQUE INDEX "OlibSotdimOperation_id_shopId_key"
  ON "OlibSotdimOperation"("id", "shopId");
CREATE UNIQUE INDEX "OlibSotdimOperation_shopId_creationIdempotencyKey_key"
  ON "OlibSotdimOperation"("shopId", "creationIdempotencyKey");
CREATE INDEX "OlibSotdimOperation_shopId_createdAt_id_idx"
  ON "OlibSotdimOperation"("shopId", "createdAt", "id");

ALTER TABLE "SupplierPayable"
  ALTER COLUMN "saleId" DROP NOT NULL,
  ADD COLUMN "olibSotdimOperationId" TEXT,
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "origin" "SupplierPayableOrigin" NOT NULL DEFAULT 'OLIB_SOTDIM',
  ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRemainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ledgerVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastPaymentAt" TIMESTAMP(3),
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT;

CREATE UNIQUE INDEX "SupplierPayable_olibSotdimOperationId_key"
  ON "SupplierPayable"("olibSotdimOperationId");
CREATE UNIQUE INDEX "SupplierPayable_id_shopId_key"
  ON "SupplierPayable"("id", "shopId");
CREATE UNIQUE INDEX "SupplierPayable_shopId_creationIdempotencyKey_key"
  ON "SupplierPayable"("shopId", "creationIdempotencyKey");
CREATE INDEX "SupplierPayable_supplierId_idx"
  ON "SupplierPayable"("supplierId");

CREATE TABLE "SupplierPayablePayment" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "supplierPayableId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentInputAmount" DECIMAL(12,2) NOT NULL,
  "paymentInputCurrency" "CurrencyCode" NOT NULL,
  "paymentExchangeRate" DECIMAL(12,4),
  "paymentExchangeRateSource" TEXT,
  "paymentExchangeRateEffectiveAt" TIMESTAMP(3),
  "paymentExchangeRateFetchedAt" TIMESTAMP(3),
  "appliedAmountInContractCurrency" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "paymentBreakdown" JSONB,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "createdBy" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPayablePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierPayablePayment_positive_amount_check" CHECK (
    "amount" > 0
    AND "paymentInputAmount" > 0
    AND "appliedAmountInContractCurrency" > 0
    AND (
      ("paymentInputCurrency" = 'UZS'
        AND trunc("paymentInputAmount") = "paymentInputAmount"
        AND ("paymentExchangeRate" IS NULL OR "paymentExchangeRate" BETWEEN 1000 AND 100000))
      OR
      ("paymentInputCurrency" = 'USD'
        AND "paymentInputAmount" = round("paymentInputAmount", 2)
        AND "paymentExchangeRate" BETWEEN 1000 AND 100000)
    )
  )
);

CREATE UNIQUE INDEX "SupplierPayablePayment_id_shopId_key"
  ON "SupplierPayablePayment"("id", "shopId");
CREATE UNIQUE INDEX "SupplierPayablePayment_shopId_idempotencyKey_key"
  ON "SupplierPayablePayment"("shopId", "idempotencyKey");
CREATE INDEX "SupplierPayablePayment_shopId_supplierPayableId_paidAt_id_idx"
  ON "SupplierPayablePayment"("shopId", "supplierPayableId", "paidAt", "id");

-- Every existing payable was created by the original Sale-only Olib-sotdim
-- workflow. Build deterministic aggregate identities so the backfill is
-- rerunnable and never invents business data.
INSERT INTO "OlibSotdimOperation" (
  "id", "shopId", "deviceId", "customerId", "dealType", "saleId",
  "createdBy", "creationIdempotencyKey", "creationCommandHash",
  "createdAt", "updatedAt"
)
SELECT
  'legacy_olib_' || payable."id",
  payable."shopId",
  payable."deviceId",
  sale."customerId",
  'SALE'::"OlibSotdimDealType",
  payable."saleId",
  payable."createdBy",
  coalesce(sale."creationIdempotencyKey", 'legacy-olib:' || payable."id"),
  coalesce(sale."creationCommandHash", md5(payable."shopId" || ':' || payable."id")),
  payable."createdAt",
  payable."updatedAt"
FROM "SupplierPayable" payable
JOIN "Sale" sale
  ON sale."id" = payable."saleId"
 AND sale."shopId" = payable."shopId"
ON CONFLICT ("shopId", "creationIdempotencyKey") DO NOTHING;

UPDATE "SupplierPayable" payable
SET
  "olibSotdimOperationId" = operation."id",
  "origin" = 'OLIB_SOTDIM',
  "paidAmount" = CASE WHEN payable."status" = 'PAID' THEN payable."amount" ELSE 0 END,
  "remainingAmount" = CASE WHEN payable."status" = 'PAID' THEN 0 ELSE payable."amount" END,
  "contractPaidAmount" = CASE WHEN payable."status" = 'PAID' THEN payable."contractAmount" ELSE 0 END,
  "contractRemainingAmount" = CASE WHEN payable."status" = 'PAID' THEN 0 ELSE payable."contractAmount" END,
  "lastPaymentAt" = CASE WHEN payable."status" = 'PAID' THEN payable."paidAt" ELSE NULL END
FROM "OlibSotdimOperation" operation
WHERE payable."olibSotdimOperationId" IS NULL
  AND operation."saleId" = payable."saleId"
  AND operation."shopId" = payable."shopId";

INSERT INTO "SupplierPayablePayment" (
  "id", "shopId", "supplierPayableId", "amount",
  "paymentInputAmount", "paymentInputCurrency", "paymentExchangeRate",
  "paymentExchangeRateSource", "appliedAmountInContractCurrency",
  "paymentMethod", "paymentBreakdown", "paidAt", "note", "createdBy",
  "idempotencyKey", "commandHash", "createdAt"
)
SELECT
  'legacy_supplier_payment_' || payable."id",
  payable."shopId",
  payable."id",
  payable."amount",
  payable."contractAmount",
  payable."contractCurrency",
  payable."contractExchangeRateAtCreation",
  CASE
    WHEN payable."contractCurrency" = 'USD' THEN 'RECORDED_FROZEN'
    ELSE 'UNAVAILABLE_SAME_CURRENCY'
  END,
  payable."contractAmount",
  payable."paymentMethod",
  payable."paymentBreakdown",
  payable."paidAt",
  coalesce(payable."note", 'Migratsiya qilingan to''lov'),
  payable."createdBy",
  'migration:supplier-payable:' || payable."id",
  md5(payable."shopId" || ':' || payable."id" || ':paid'),
  payable."paidAt"
FROM "SupplierPayable" payable
WHERE payable."status" = 'PAID'
  AND payable."paidAt" IS NOT NULL
  AND payable."paymentMethod" IS NOT NULL
ON CONFLICT ("shopId", "idempotencyKey") DO NOTHING;

ALTER TABLE "SupplierPayable"
  DROP CONSTRAINT IF EXISTS "SupplierPayable_payment_state_check";

-- Compatibility trigger: the previously deployed application writes only the
-- original binary fields. Populate the additive projection on those writes so
-- an application rollback remains safe during the expand stage.
CREATE OR REPLACE FUNCTION "supplier_payable_ledger_compatibility"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW."paidAmount" = 0
     AND NEW."remainingAmount" = 0
     AND NEW."contractPaidAmount" = 0
     AND NEW."contractRemainingAmount" = 0 THEN
    IF NEW."status" = 'PAID' THEN
      NEW."paidAmount" := NEW."amount";
      NEW."remainingAmount" := 0;
      NEW."contractPaidAmount" := NEW."contractAmount";
      NEW."contractRemainingAmount" := 0;
      NEW."lastPaymentAt" := NEW."paidAt";
    ELSE
      NEW."remainingAmount" := NEW."amount";
      NEW."contractRemainingAmount" := NEW."contractAmount";
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."status" <> 'PAID'
     AND NEW."status" = 'PAID'
     AND NEW."paidAmount" = OLD."paidAmount"
     AND NEW."remainingAmount" = OLD."remainingAmount"
     AND NEW."contractPaidAmount" = OLD."contractPaidAmount"
     AND NEW."contractRemainingAmount" = OLD."contractRemainingAmount" THEN
    NEW."paidAmount" := NEW."amount";
    NEW."remainingAmount" := 0;
    NEW."contractPaidAmount" := NEW."contractAmount";
    NEW."contractRemainingAmount" := 0;
    NEW."lastPaymentAt" := NEW."paidAt";
    IF NEW."ledgerVersion" = OLD."ledgerVersion" THEN
      NEW."ledgerVersion" := OLD."ledgerVersion" + 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupplierPayable_ledger_compatibility_trigger"
BEFORE INSERT OR UPDATE ON "SupplierPayable"
FOR EACH ROW EXECUTE FUNCTION "supplier_payable_ledger_compatibility"();

-- A previously deployed application can still create a Sale-backed payable
-- after this migration and before promotion. Materialize its aggregate
-- operation immediately so the new Olib list never misses compatibility-
-- window writes. New writes already supply olibSotdimOperationId and are a
-- no-op here.
CREATE OR REPLACE FUNCTION "supplier_payable_legacy_operation_compatibility"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_id TEXT := 'compat_olib_' || NEW."id";
BEGIN
  IF NEW."origin" = 'OLIB_SOTDIM'
     AND NEW."olibSotdimOperationId" IS NULL
     AND NEW."saleId" IS NOT NULL THEN
    INSERT INTO "OlibSotdimOperation" (
      "id", "shopId", "deviceId", "customerId", "dealType", "saleId",
      "createdBy", "creationIdempotencyKey", "creationCommandHash",
      "createdAt", "updatedAt"
    )
    SELECT
      operation_id,
      NEW."shopId",
      NEW."deviceId",
      sale."customerId",
      'SALE'::"OlibSotdimDealType",
      sale."id",
      NEW."createdBy",
      coalesce(sale."creationIdempotencyKey", 'compat-olib:' || NEW."id"),
      coalesce(sale."creationCommandHash", md5(NEW."shopId" || ':' || NEW."id")),
      NEW."createdAt",
      NEW."updatedAt"
    FROM "Sale" sale
    WHERE sale."id" = NEW."saleId"
      AND sale."shopId" = NEW."shopId"
    ON CONFLICT ("saleId") DO NOTHING;

    UPDATE "SupplierPayable" payable
    SET "olibSotdimOperationId" = operation."id"
    FROM "OlibSotdimOperation" operation
    WHERE payable."id" = NEW."id"
      AND payable."shopId" = NEW."shopId"
      AND operation."saleId" = NEW."saleId"
      AND operation."shopId" = NEW."shopId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupplierPayable_legacy_operation_compatibility_trigger"
AFTER INSERT ON "SupplierPayable"
FOR EACH ROW EXECUTE FUNCTION "supplier_payable_legacy_operation_compatibility"();

-- If a rolled-back application completes a binary payment, preserve a
-- deterministic append-only evidence row. The new application inserts its
-- payment row before closing the header, so this trigger remains a no-op.
CREATE OR REPLACE FUNCTION "supplier_payable_legacy_payment_evidence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'PAID'
     AND NEW."paidAt" IS NOT NULL
     AND NEW."paymentMethod" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "SupplierPayablePayment" payment
       WHERE payment."supplierPayableId" = NEW."id"
         AND payment."shopId" = NEW."shopId"
     ) THEN
    INSERT INTO "SupplierPayablePayment" (
      "id", "shopId", "supplierPayableId", "amount",
      "paymentInputAmount", "paymentInputCurrency", "paymentExchangeRate",
      "paymentExchangeRateSource", "appliedAmountInContractCurrency",
      "paymentMethod", "paymentBreakdown", "paidAt", "note", "createdBy",
      "idempotencyKey", "commandHash", "createdAt"
    ) VALUES (
      'compat_supplier_payment_' || NEW."id" || '_' || NEW."ledgerVersion",
      NEW."shopId",
      NEW."id",
      NEW."amount",
      NEW."contractAmount",
      NEW."contractCurrency",
      NEW."contractExchangeRateAtCreation",
      CASE WHEN NEW."contractCurrency" = 'USD'
        THEN 'RECORDED_FROZEN' ELSE 'UNAVAILABLE_SAME_CURRENCY' END,
      NEW."contractAmount",
      NEW."paymentMethod",
      NEW."paymentBreakdown",
      NEW."paidAt",
      coalesce(NEW."note", 'Moslik rejimida qayd etilgan to''lov'),
      NEW."createdBy",
      'compat:supplier-payable:' || NEW."id" || ':' || NEW."ledgerVersion",
      md5(NEW."shopId" || ':' || NEW."id" || ':' || NEW."ledgerVersion"),
      NEW."paidAt"
    )
    ON CONFLICT ("shopId", "idempotencyKey") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupplierPayable_legacy_payment_evidence_trigger"
AFTER INSERT OR UPDATE ON "SupplierPayable"
FOR EACH ROW EXECUTE FUNCTION "supplier_payable_legacy_payment_evidence"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SupplierPayable" p
    WHERE p."origin" = 'OLIB_SOTDIM'
      AND p."olibSotdimOperationId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight failed: an Olib supplier payable has no aggregate operation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SupplierPayable" p
    WHERE p."status" <> 'CANCELLED'
      AND (
        p."amount" <> p."paidAmount" + p."remainingAmount"
        OR p."contractAmount" <> p."contractPaidAmount" + p."contractRemainingAmount"
      )
  ) THEN
    RAISE EXCEPTION 'Preflight failed: supplier payable header balances do not reconcile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SupplierPayable" p
    LEFT JOIN (
      SELECT
        payment."shopId",
        payment."supplierPayableId",
        sum(payment."appliedAmountInContractCurrency")::numeric(12,2) AS evidence_paid
      FROM "SupplierPayablePayment" payment
      GROUP BY payment."shopId", payment."supplierPayableId"
    ) evidence
      ON evidence."supplierPayableId" = p."id"
     AND evidence."shopId" = p."shopId"
    WHERE p."status" <> 'CANCELLED'
      AND coalesce(evidence.evidence_paid, 0) <> p."contractPaidAmount"
  ) THEN
    RAISE EXCEPTION 'Preflight failed: supplier payment evidence does not match the header projection';
  END IF;
END;
$$;

ALTER TABLE "SupplierPayable"
  ADD CONSTRAINT "SupplierPayable_ledger_balance_check" CHECK (
    "ledgerVersion" >= 1
    AND "paidAmount" >= 0
    AND "remainingAmount" >= 0
    AND "contractPaidAmount" >= 0
    AND "contractRemainingAmount" >= 0
    AND (
      "status" = 'CANCELLED'
      OR (
        "amount" = "paidAmount" + "remainingAmount"
        AND "contractAmount" = "contractPaidAmount" + "contractRemainingAmount"
        AND (
          ("status" = 'PAID'
            AND "remainingAmount" = 0
            AND "contractRemainingAmount" = 0
            AND "paidAt" IS NOT NULL
            AND "paymentMethod" IS NOT NULL)
          OR
          ("status" <> 'PAID'
            AND "remainingAmount" > 0
            AND "contractRemainingAmount" > 0
            AND "paidAt" IS NULL)
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "SupplierPayable"
  ADD CONSTRAINT "SupplierPayable_origin_compatibility_check" CHECK (
    ("origin" = 'OLIB_SOTDIM'
      AND ("olibSotdimOperationId" IS NOT NULL OR "saleId" IS NOT NULL))
    OR
    ("origin" = 'DEVICE_PURCHASE' AND "saleId" IS NULL)
  ) NOT VALID;

ALTER TABLE "OlibSotdimOperation"
  ADD CONSTRAINT "OlibSotdimOperation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OlibSotdimOperation_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OlibSotdimOperation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OlibSotdimOperation_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OlibSotdimOperation_nasiyaId_fkey"
    FOREIGN KEY ("nasiyaId") REFERENCES "Nasiya"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OlibSotdimOperation"
  ADD CONSTRAINT "OlibSotdimOperation_deviceId_shopId_fkey"
    FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "OlibSotdimOperation_customerId_shopId_fkey"
    FOREIGN KEY ("customerId", "shopId") REFERENCES "Customer"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "OlibSotdimOperation_saleId_shopId_fkey"
    FOREIGN KEY ("saleId", "shopId") REFERENCES "Sale"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "OlibSotdimOperation_nasiyaId_shopId_fkey"
    FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SupplierPayable"
  ADD CONSTRAINT "SupplierPayable_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupplierPayable_olibSotdimOperationId_fkey"
    FOREIGN KEY ("olibSotdimOperationId") REFERENCES "OlibSotdimOperation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupplierPayable_supplierId_shopId_fkey"
    FOREIGN KEY ("supplierId", "shopId") REFERENCES "Supplier"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "SupplierPayable_olibSotdimOperationId_shopId_fkey"
    FOREIGN KEY ("olibSotdimOperationId", "shopId")
    REFERENCES "OlibSotdimOperation"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SupplierPayablePayment"
  ADD CONSTRAINT "SupplierPayablePayment_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupplierPayablePayment_supplierPayableId_fkey"
    FOREIGN KEY ("supplierPayableId") REFERENCES "SupplierPayable"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupplierPayablePayment_supplierPayableId_shopId_fkey"
    FOREIGN KEY ("supplierPayableId", "shopId")
    REFERENCES "SupplierPayable"("id", "shopId")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "OlibSotdimOperation"
  VALIDATE CONSTRAINT "OlibSotdimOperation_deviceId_shopId_fkey";
ALTER TABLE "OlibSotdimOperation"
  VALIDATE CONSTRAINT "OlibSotdimOperation_customerId_shopId_fkey";
ALTER TABLE "OlibSotdimOperation"
  VALIDATE CONSTRAINT "OlibSotdimOperation_saleId_shopId_fkey";
ALTER TABLE "OlibSotdimOperation"
  VALIDATE CONSTRAINT "OlibSotdimOperation_nasiyaId_shopId_fkey";
ALTER TABLE "SupplierPayable"
  VALIDATE CONSTRAINT "SupplierPayable_supplierId_shopId_fkey";
ALTER TABLE "SupplierPayable"
  VALIDATE CONSTRAINT "SupplierPayable_olibSotdimOperationId_shopId_fkey";
ALTER TABLE "SupplierPayablePayment"
  VALIDATE CONSTRAINT "SupplierPayablePayment_supplierPayableId_shopId_fkey";
ALTER TABLE "SupplierPayable"
  VALIDATE CONSTRAINT "SupplierPayable_ledger_balance_check";
ALTER TABLE "SupplierPayable"
  VALIDATE CONSTRAINT "SupplierPayable_origin_compatibility_check";

-- Commit-time reconciliation lets the application insert immutable evidence
-- before advancing the header projection in the same transaction, while
-- still rejecting any transaction whose authoritative contract-currency
-- ledger and header disagree.
CREATE OR REPLACE FUNCTION "validate_supplier_payable_payment_ledger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  payable_id TEXT;
  payable_shop_id TEXT;
  header RECORD;
  evidence_paid NUMERIC(12,2);
BEGIN
  IF TG_TABLE_NAME = 'SupplierPayablePayment' THEN
    payable_id := NEW."supplierPayableId";
    payable_shop_id := NEW."shopId";
  ELSE
    payable_id := NEW."id";
    payable_shop_id := NEW."shopId";
  END IF;

  SELECT
    p."status",
    p."contractAmount",
    p."contractPaidAmount",
    p."contractRemainingAmount"
  INTO header
  FROM "SupplierPayable" p
  WHERE p."id" = payable_id
    AND p."shopId" = payable_shop_id;

  IF NOT FOUND OR header."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(payment."appliedAmountInContractCurrency"), 0)::numeric(12,2)
  INTO evidence_paid
  FROM "SupplierPayablePayment" payment
  WHERE payment."supplierPayableId" = payable_id
    AND payment."shopId" = payable_shop_id;

  IF evidence_paid <> header."contractPaidAmount"
     OR header."contractAmount" <> header."contractPaidAmount" + header."contractRemainingAmount" THEN
    RAISE EXCEPTION 'Supplier payable ledger reconciliation failed for %', payable_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "SupplierPayable_payment_ledger_reconcile_trigger"
AFTER INSERT OR UPDATE ON "SupplierPayable"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_supplier_payable_payment_ledger"();

CREATE CONSTRAINT TRIGGER "SupplierPayablePayment_ledger_reconcile_trigger"
AFTER INSERT ON "SupplierPayablePayment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_supplier_payable_payment_ledger"();

CREATE INDEX "SupplierPayable_shopId_dueDate_open_ledger_idx"
  ON "SupplierPayable"("shopId", "dueDate", "id")
  WHERE "deletedAt" IS NULL
    AND "status" <> 'CANCELLED'
    AND "contractRemainingAmount" > 0;

-- Financial ledger evidence is immutable. Corrections are compensating
-- entries, never UPDATE/DELETE of a posted payment.
CREATE OR REPLACE FUNCTION "reject_supplier_payable_payment_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SupplierPayablePayment is append-only';
END;
$$;

CREATE TRIGGER "SupplierPayablePayment_immutable_trigger"
BEFORE UPDATE OR DELETE ON "SupplierPayablePayment"
FOR EACH ROW EXECUTE FUNCTION "reject_supplier_payable_payment_mutation"();

-- Permission catalog and exact compatibility grants.
INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder", "isActive")
VALUES
  ('DEVICE_PURCHASE_ON_CREDIT', 'Qurilmani keyin to''lashga olish', 'Qurilma va yetkazib beruvchi qarzini birga yaratish', 'INVENTORY', 25, TRUE),
  ('SUPPLIER_PAYABLE_VIEW', 'Bizning qarzlarimizni ko''rish', 'Yetkazib beruvchiga ochiq qarzlar va xavfsiz tafsilotlar', 'INVENTORY', 245, TRUE),
  ('SUPPLIER_PAYMENT_RECORD', 'Yetkazib beruvchi to''lovini yozish', 'Qisman, ikki usulda yoki to''liq chiqim to''lovini yozish', 'INVENTORY', 250, TRUE)
ON CONFLICT ("code") DO UPDATE SET
  "nameUz" = EXCLUDED."nameUz",
  "descriptionUz" = EXCLUDED."descriptionUz",
  "featureCode" = EXCLUDED."featureCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

WITH compatibility_grants AS (
  SELECT
    old."shopId",
    old."shopAdminId",
    old."grantedById",
    old."grantedAt",
    CASE old."permissionCode"
      WHEN 'OLIB_VIEW' THEN 'SUPPLIER_PAYABLE_VIEW'
      WHEN 'SUPPLIER_PAYMENT_MARK_PAID' THEN 'SUPPLIER_PAYMENT_RECORD'
    END AS "newCode"
  FROM "ShopMemberPermission" old
  WHERE old."permissionCode" IN ('OLIB_VIEW', 'SUPPLIER_PAYMENT_MARK_PAID')
), inserted AS (
  INSERT INTO "ShopMemberPermission"
    ("id", "shopId", "shopAdminId", "permissionCode", "grantedAt", "grantedById")
  SELECT
    'debtperm_' || md5(grant_row."shopAdminId" || ':' || grant_row."newCode"),
    grant_row."shopId",
    grant_row."shopAdminId",
    grant_row."newCode",
    grant_row."grantedAt",
    grant_row."grantedById"
  FROM compatibility_grants grant_row
  WHERE grant_row."newCode" IS NOT NULL
  ON CONFLICT ("shopAdminId", "permissionCode") DO NOTHING
  RETURNING "shopAdminId", "shopId"
)
UPDATE "ShopAdmin" member
SET "permissionVersion" = member."permissionVersion" + 1
FROM (
  SELECT DISTINCT "shopAdminId", "shopId" FROM inserted
) affected
WHERE member."id" = affected."shopAdminId"
  AND member."shopId" = affected."shopId";

-- The incremental event table stores one primary domain per row. Compound
-- Olib/debt operations cross independently permissioned domains, so emit one
-- metadata-only event per affected primary domain. The sync reader coalesces
-- them by entity while each staff member can still observe the event through
-- at least one domain they are entitled to read.
CREATE OR REPLACE FUNCTION "oryx_record_change_event_from_log"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_domain TEXT;
    event_domain_item TEXT;
    event_domains TEXT[];
    event_operation TEXT;
    event_kind TEXT;
    admin_global BOOLEAN;
BEGIN
    event_operation := CASE
        WHEN NEW."action" IN ('DELETE', 'SOFT_DELETE') THEN 'deleted'
        WHEN NEW."action" IN ('CREATE', 'IMPORT', 'CREATE_DEVICE_PAY_LATER', 'CREATE_SUPPLIER_PAYABLE', 'OLIB_SOTDIM_CREATE', 'OLIB_SOTDIM_NASIYA_CREATE') THEN 'created'
        ELSE 'updated'
    END;
    event_kind := lower(NEW."targetType") || '.' || lower(NEW."action");

    IF NEW."targetType" = 'OlibSotdimOperation' THEN
        event_domains := CASE WHEN NEW."action" = 'OLIB_SOTDIM_NASIYA_CREATE'
            THEN ARRAY['olibSotdim', 'nasiyas', 'debts', 'devices', 'customers', 'reports', 'logs']
            ELSE ARRAY['olibSotdim', 'sales', 'debts', 'devices', 'customers', 'reports', 'logs']
        END;
        IF NEW."shopId" IS NOT NULL THEN
            FOREACH event_domain_item IN ARRAY event_domains LOOP
                INSERT INTO "ChangeEvent" (
                    "scopeType", "scopeId", "domain", "entityType", "entityId",
                    "operation", "mutationKind"
                ) VALUES (
                    'SHOP', NEW."shopId", event_domain_item, NEW."targetType", NEW."targetId",
                    event_operation, event_kind
                );
            END LOOP;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."targetType" = 'SupplierPayable' THEN
        event_domains := ARRAY['debts', 'olibSotdim', 'devices', 'payments', 'reports', 'logs'];
        IF NEW."shopId" IS NOT NULL THEN
            FOREACH event_domain_item IN ARRAY event_domains LOOP
                INSERT INTO "ChangeEvent" (
                    "scopeType", "scopeId", "domain", "entityType", "entityId",
                    "operation", "mutationKind"
                ) VALUES (
                    'SHOP', NEW."shopId", event_domain_item, NEW."targetType", NEW."targetId",
                    event_operation, event_kind
                );
            END LOOP;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."targetType" = 'ShopPackageVersion'
       OR (NEW."targetType" = 'ShopAdmin' AND NEW."actorType" = 'SUPER_ADMIN') THEN
        IF NEW."shopId" IS NOT NULL THEN
            INSERT INTO "ChangeEvent" (
                "scopeType", "scopeId", "domain", "entityType", "entityId",
                "operation", "mutationKind"
            ) VALUES (
                'SHOP', NEW."shopId", 'access', NEW."targetType", NEW."targetId",
                event_operation, event_kind
            );
        END IF;
        INSERT INTO "ChangeEvent" (
            "scopeType", "scopeId", "domain", "entityType", "entityId",
            "operation", "mutationKind"
        ) VALUES (
            'GLOBAL', 'GLOBAL', 'adminShops', NEW."targetType", NEW."targetId",
            event_operation, event_kind
        );
        RETURN NEW;
    END IF;

    event_domain := CASE NEW."targetType"
        WHEN 'Device' THEN 'devices'
        WHEN 'Sale' THEN 'sales'
        WHEN 'SalePayment' THEN 'payments'
        WHEN 'Nasiya' THEN 'nasiyas'
        WHEN 'NasiyaPayment' THEN 'payments'
        WHEN 'NasiyaReminder' THEN 'nasiyas'
        WHEN 'Customer' THEN 'customers'
        WHEN 'DeviceReturn' THEN 'returns'
        WHEN 'CurrencyRate' THEN 'currency'
        WHEN 'Shop' THEN CASE WHEN NEW."actorType" = 'SUPER_ADMIN' THEN 'adminShops' ELSE 'settings' END
        WHEN 'ShopAdmin' THEN CASE WHEN NEW."actorType" = 'SUPER_ADMIN' THEN 'adminShops' ELSE 'settings' END
        WHEN 'SuperAdmin' THEN 'settings'
        ELSE 'logs'
    END;

    admin_global := NEW."actorType" = 'SUPER_ADMIN'
        AND NEW."targetType" IN ('Shop', 'ShopAdmin', 'CurrencyRate');

    IF NEW."shopId" IS NOT NULL THEN
        INSERT INTO "ChangeEvent" (
            "scopeType", "scopeId", "domain", "entityType", "entityId",
            "operation", "mutationKind"
        ) VALUES (
            'SHOP', NEW."shopId", event_domain, NEW."targetType", NEW."targetId",
            event_operation, event_kind
        );
    END IF;

    IF admin_global OR NEW."shopId" IS NULL THEN
        INSERT INTO "ChangeEvent" (
            "scopeType", "scopeId", "domain", "entityType", "entityId",
            "operation", "mutationKind"
        ) VALUES (
            CASE WHEN NEW."targetType" = 'SuperAdmin' THEN 'ADMIN' ELSE 'GLOBAL' END,
            CASE WHEN NEW."targetType" = 'SuperAdmin' THEN NEW."actorId" ELSE 'GLOBAL' END,
            event_domain, NEW."targetType", NEW."targetId",
            event_operation, event_kind
        );
    END IF;

    RETURN NEW;
END;
$$;
