-- Immutable return/refund accounting.
--
-- The original Sale/Nasiya and receipt rows remain in place. A return posts a
-- separate, immutable disposition event in the return period and allocates
-- every refunded amount back to exactly one original payment row.

ALTER TYPE "NasiyaScheduleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "Sale"
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnedBy" TEXT;

ALTER TABLE "Nasiya"
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnedBy" TEXT;

ALTER TABLE "SalePayment"
  ADD COLUMN "paymentDateExplicit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedNextDueDate" TIMESTAMP(3);

ALTER TABLE "DeviceReturn"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "ledgerVersion" SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN "contractCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "contractAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractReceiptsAtReturn" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRetainedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractCancelledDebt" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "revenueReversalAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "interestReversalAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "inventoryCostRecoveryUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "retainedValueAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Preserve legacy return rows without inventing payment allocations. These
-- snapshots use the best frozen contract fields available; diagnostics flag
-- rows that still need an approved historic-data review.
WITH return_snapshot AS (
  SELECT
    r.id,
    s."contractCurrency" AS sale_contract_currency,
    n."contractCurrency" AS nasiya_contract_currency,
    s."contractSalePrice",
    n."contractFinalAmount",
    s."salePrice",
    n."finalNasiyaAmount",
    s."contractAmountPaid",
    n."contractDownPayment",
    n."contractPaidAmount",
    s."contractRemainingAmount" AS sale_contract_remaining,
    n."contractRemainingAmount" AS nasiya_contract_remaining,
    n."totalAmount",
    n."interestAmount",
    d."purchasePrice"
  FROM "DeviceReturn" r
  JOIN "Device" d ON d.id = r."deviceId"
  LEFT JOIN "Sale" s ON s.id = r."saleId"
  LEFT JOIN "Nasiya" n ON n.id = r."nasiyaId"
)
UPDATE "DeviceReturn" r
SET
  "idempotencyKey" = 'legacy-return:' || r.id,
  "contractCurrency" = COALESCE(x.sale_contract_currency, x.nasiya_contract_currency, 'UZS'::"CurrencyCode"),
  "contractAmount" = COALESCE(
    NULLIF(x."contractSalePrice", 0),
    NULLIF(x."contractFinalAmount", 0),
    x."salePrice",
    x."finalNasiyaAmount",
    0
  ),
  "contractReceiptsAtReturn" = COALESCE(
    NULLIF(x."contractAmountPaid", 0),
    NULLIF(x."contractDownPayment" + x."contractPaidAmount", 0),
    0
  ),
  "contractCancelledDebt" = COALESCE(
    NULLIF(x.sale_contract_remaining, 0),
    NULLIF(x.nasiya_contract_remaining, 0),
    0
  ),
  "revenueReversalAmountUzs" = COALESCE(x."salePrice", x."totalAmount", 0),
  "interestReversalAmountUzs" = COALESCE(x."interestAmount", 0),
  "inventoryCostRecoveryUzs" = COALESCE(x."purchasePrice", 0)
FROM return_snapshot x
WHERE x.id = r.id;

UPDATE "DeviceReturn" r
SET "contractRefundAmount" = ROUND((
  CASE
    WHEN r."refundInputAmount" IS NOT NULL
      AND r."refundInputCurrency" = r."contractCurrency"
      THEN r."refundInputAmount"
    WHEN r."contractCurrency" = 'UZS' THEN r."refundAmount"
    WHEN r."contractCurrency" = 'USD'
      AND r."refundExchangeRateAtCreation" > 0
      THEN r."refundAmount" / r."refundExchangeRateAtCreation"
    ELSE 0
  END
)::numeric, 2);

UPDATE "DeviceReturn"
SET
  "contractRetainedAmount" = GREATEST("contractReceiptsAtReturn" - "contractRefundAmount", 0),
  "retainedValueAmountUzs" = GREATEST(
    COALESCE((
      SELECT SUM(p.amount)
      FROM "SalePayment" p
      WHERE p."saleId" = "DeviceReturn"."saleId" AND p."deletedAt" IS NULL
    ), (
      SELECT SUM(p.amount)
      FROM "NasiyaPayment" p
      WHERE p."nasiyaId" = "DeviceReturn"."nasiyaId" AND p."deletedAt" IS NULL
    ), 0) - "refundAmount",
    0
  );

ALTER TABLE "DeviceReturn" ALTER COLUMN "idempotencyKey" SET NOT NULL;
-- The old application does not send an idempotency key. During the short
-- migrate-before-publish compatibility window PostgreSQL supplies a clearly
-- marked legacy key and ledgerVersion=1. The new writer always supplies its
-- own key and ledgerVersion=2, so strict ledger invariants cannot be bypassed
-- through user-controlled key text.
ALTER TABLE "DeviceReturn" ALTER COLUMN "idempotencyKey"
  SET DEFAULT ('legacy-return:' || gen_random_uuid()::text);

CREATE UNIQUE INDEX "SalePayment_id_shopId_key" ON "SalePayment"("id", "shopId");
CREATE UNIQUE INDEX "NasiyaPayment_id_shopId_key" ON "NasiyaPayment"("id", "shopId");
CREATE UNIQUE INDEX "DeviceReturn_id_shopId_key" ON "DeviceReturn"("id", "shopId");
CREATE UNIQUE INDEX "DeviceReturn_shopId_idempotencyKey_key" ON "DeviceReturn"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX "Sale_id_shopId_deviceId_key" ON "Sale"("id", "shopId", "deviceId");
CREATE UNIQUE INDEX "Nasiya_id_shopId_deviceId_key" ON "Nasiya"("id", "shopId", "deviceId");

-- NOT VALID preserves a safe additive rollout even if historical rows need an
-- approved repair. PostgreSQL still enforces these constraints for every new
-- or changed row immediately.
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_exactly_one_contract_check"
  CHECK (num_nonnulls("saleId", "nasiyaId") = 1) NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_nonnegative_disposition_check"
  CHECK (
    "refundAmount" >= 0
    AND "contractAmount" >= 0
    AND "contractReceiptsAtReturn" >= 0
    AND "contractRefundAmount" >= 0
    AND "contractRetainedAmount" >= 0
    AND "contractCancelledDebt" >= 0
    AND "revenueReversalAmountUzs" >= 0
    AND "interestReversalAmountUzs" >= 0
    AND "inventoryCostRecoveryUzs" >= 0
    AND "retainedValueAmountUzs" >= 0
  ) NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_receipt_reconciliation_check"
  CHECK (
    "ledgerVersion" = 1 OR (
      "contractRefundAmount" <= "contractReceiptsAtReturn"
      AND "contractReceiptsAtReturn" = "contractRefundAmount" + "contractRetainedAmount"
      AND (("contractRefundAmount" = 0 AND "refundMethod" IS NULL)
        OR ("contractRefundAmount" > 0 AND "refundMethod" IS NOT NULL))
    )
  ) NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_sale_device_match_fkey"
  FOREIGN KEY ("saleId", "shopId", "deviceId")
  REFERENCES "Sale"("id", "shopId", "deviceId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_nasiya_device_match_fkey"
  FOREIGN KEY ("nasiyaId", "shopId", "deviceId")
  REFERENCES "Nasiya"("id", "shopId", "deviceId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_sale_device_match_fkey"
  FOREIGN KEY ("saleId", "shopId", "deviceId")
  REFERENCES "Sale"("id", "shopId", "deviceId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE TABLE "ReturnRefundAllocation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceReturnId" TEXT NOT NULL,
  "salePaymentId" TEXT,
  "nasiyaPaymentId" TEXT,
  "sourcePaymentMethod" "PaymentMethod" NOT NULL,
  "refundMethod" "PaymentMethod" NOT NULL,
  "contractCurrency" "CurrencyCode" NOT NULL,
  "contractAmount" DECIMAL(12,2) NOT NULL,
  "amountUzs" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnRefundAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnRefundAllocation_exactly_one_payment_check"
    CHECK (num_nonnulls("salePaymentId", "nasiyaPaymentId") = 1),
  CONSTRAINT "ReturnRefundAllocation_positive_amount_check"
    CHECK ("contractAmount" > 0 AND "amountUzs" > 0),
  CONSTRAINT "ReturnRefundAllocation_same_method_check"
    CHECK ("sourcePaymentMethod" = "refundMethod")
);

CREATE INDEX "ReturnRefundAllocation_shopId_idx" ON "ReturnRefundAllocation"("shopId");
CREATE INDEX "ReturnRefundAllocation_deviceReturnId_idx" ON "ReturnRefundAllocation"("deviceReturnId");
CREATE INDEX "ReturnRefundAllocation_salePaymentId_idx" ON "ReturnRefundAllocation"("salePaymentId");
CREATE INDEX "ReturnRefundAllocation_nasiyaPaymentId_idx" ON "ReturnRefundAllocation"("nasiyaPaymentId");

ALTER TABLE "ReturnRefundAllocation" ADD CONSTRAINT "ReturnRefundAllocation_return_shop_fkey"
  FOREIGN KEY ("deviceReturnId", "shopId")
  REFERENCES "DeviceReturn"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRefundAllocation" ADD CONSTRAINT "ReturnRefundAllocation_sale_payment_shop_fkey"
  FOREIGN KEY ("salePaymentId", "shopId")
  REFERENCES "SalePayment"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRefundAllocation" ADD CONSTRAINT "ReturnRefundAllocation_nasiya_payment_shop_fkey"
  FOREIGN KEY ("nasiyaPaymentId", "shopId")
  REFERENCES "NasiyaPayment"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A completed return or allocation is an accounting event. Corrections must
-- be compensating events, never an update/delete that destroys the trail.
CREATE FUNCTION "prevent_return_ledger_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable return ledger rows cannot be updated or deleted';
END;
$$;

CREATE TRIGGER "DeviceReturn_immutable"
  BEFORE UPDATE OR DELETE ON "DeviceReturn"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();
CREATE TRIGGER "ReturnRefundAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "ReturnRefundAllocation"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();

-- Each allocation must reference a receipt from the exact returned contract,
-- not merely another receipt in the same shop. Allocation currency/method are
-- also bound to the immutable return header.
CREATE FUNCTION "validate_return_refund_allocation_link"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  return_row "DeviceReturn"%ROWTYPE;
  payment_contract_id TEXT;
  payment_deleted_at TIMESTAMP(3);
BEGIN
  SELECT * INTO return_row
  FROM "DeviceReturn"
  WHERE id = NEW."deviceReturnId" AND "shopId" = NEW."shopId";

  IF NOT FOUND OR return_row."ledgerVersion" <> 2 THEN
    RAISE EXCEPTION 'refund allocations require a version 2 return ledger';
  END IF;
  IF NEW."contractCurrency" <> return_row."contractCurrency"
    OR NEW."refundMethod" IS DISTINCT FROM return_row."refundMethod" THEN
    RAISE EXCEPTION 'refund allocation currency or method does not match return';
  END IF;

  IF NEW."salePaymentId" IS NOT NULL THEN
    SELECT "saleId", "deletedAt" INTO payment_contract_id, payment_deleted_at
    FROM "SalePayment"
    WHERE id = NEW."salePaymentId" AND "shopId" = NEW."shopId";
    IF NOT FOUND OR payment_deleted_at IS NOT NULL
      OR return_row."saleId" IS NULL OR payment_contract_id <> return_row."saleId" THEN
      RAISE EXCEPTION 'sale refund allocation does not belong to returned sale';
    END IF;
  ELSIF NEW."nasiyaPaymentId" IS NOT NULL THEN
    SELECT "nasiyaId", "deletedAt" INTO payment_contract_id, payment_deleted_at
    FROM "NasiyaPayment"
    WHERE id = NEW."nasiyaPaymentId" AND "shopId" = NEW."shopId";
    IF NOT FOUND OR payment_deleted_at IS NOT NULL
      OR return_row."nasiyaId" IS NULL OR payment_contract_id <> return_row."nasiyaId" THEN
      RAISE EXCEPTION 'nasiya refund allocation does not belong to returned nasiya';
    END IF;
  ELSE
    RAISE EXCEPTION 'refund allocation must reference one payment';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ReturnRefundAllocation_validate_link"
  BEFORE INSERT ON "ReturnRefundAllocation"
  FOR EACH ROW EXECUTE FUNCTION "validate_return_refund_allocation_link"();

-- The check is deferred so the application can insert the immutable return
-- header first and its allocation rows second in one transaction. At commit,
-- native and UZS allocations must both reconcile exactly. This also rejects
-- any later append, because positive immutable rows would exceed the frozen
-- header. Per-payment UZS allocation cannot exceed the original receipt.
CREATE FUNCTION "validate_return_refund_reconciliation"() RETURNS trigger
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
    FROM "ReturnRefundAllocation" a
    JOIN "SalePayment" p ON p.id = a."salePaymentId" AND p."shopId" = a."shopId"
    WHERE a."deviceReturnId" = target_return_id
    GROUP BY a."salePaymentId", p.amount
    HAVING SUM(a."amountUzs") > p.amount
  ) OR EXISTS (
    SELECT 1
    FROM "ReturnRefundAllocation" a
    JOIN "NasiyaPayment" p ON p.id = a."nasiyaPaymentId" AND p."shopId" = a."shopId"
    WHERE a."deviceReturnId" = target_return_id
    GROUP BY a."nasiyaPaymentId", p.amount
    HAVING SUM(a."amountUzs") > p.amount
  ) THEN
    RAISE EXCEPTION 'refund allocation exceeds original receipt';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "DeviceReturn_reconcile_allocations"
  AFTER INSERT ON "DeviceReturn"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_return_refund_reconciliation"();
CREATE CONSTRAINT TRIGGER "ReturnRefundAllocation_reconcile_return"
  AFTER INSERT ON "ReturnRefundAllocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_return_refund_reconciliation"();

-- Once a version-2 return exists, original receipt rows cannot be appended,
-- edited, soft-deleted, or physically deleted.
CREATE FUNCTION "protect_returned_contract_payments"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  contract_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'SalePayment' THEN
    contract_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."saleId" ELSE NEW."saleId" END;
    IF EXISTS (
      SELECT 1 FROM "DeviceReturn" r
      WHERE r."saleId" = contract_id AND r."ledgerVersion" = 2
    ) THEN
      RAISE EXCEPTION 'payments for a returned contract are immutable';
    END IF;
  ELSE
    contract_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."nasiyaId" ELSE NEW."nasiyaId" END;
    IF EXISTS (
      SELECT 1 FROM "DeviceReturn" r
      WHERE r."nasiyaId" = contract_id AND r."ledgerVersion" = 2
    ) THEN
      RAISE EXCEPTION 'payments for a returned contract are immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SalePayment_protect_returned_contract"
  BEFORE INSERT OR UPDATE OR DELETE ON "SalePayment"
  FOR EACH ROW EXECUTE FUNCTION "protect_returned_contract_payments"();
CREATE TRIGGER "NasiyaPayment_protect_returned_contract"
  BEFORE INSERT OR UPDATE OR DELETE ON "NasiyaPayment"
  FOR EACH ROW EXECUTE FUNCTION "protect_returned_contract_payments"();

-- Once money exists, a contract cannot be soft-deleted. Once returned, no
-- later update/delete can rewrite the original contract snapshot.
CREATE FUNCTION "protect_contract_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Sale' THEN
    IF TG_OP = 'DELETE' AND (
      OLD."returnedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "SalePayment" p WHERE p."saleId" = OLD.id)
    ) THEN
      RAISE EXCEPTION 'sale with financial history cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."returnedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'returned sale is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
      AND EXISTS (SELECT 1 FROM "SalePayment" p WHERE p."saleId" = OLD.id)
      AND NOT (
        NEW."deleteNote" LIKE 'RETURN:%'
        AND EXISTS (SELECT 1 FROM "Device" d WHERE d.id = OLD."deviceId" AND d.status = 'IN_STOCK')
      ) THEN
      RAISE EXCEPTION 'sale with receipts cannot be soft-deleted';
    END IF;
  ELSIF TG_TABLE_NAME = 'Nasiya' THEN
    IF TG_OP = 'DELETE' AND (
      OLD."returnedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "NasiyaPayment" p WHERE p."nasiyaId" = OLD.id)
    ) THEN
      RAISE EXCEPTION 'nasiya with financial history cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."returnedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'returned nasiya is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
      AND EXISTS (SELECT 1 FROM "NasiyaPayment" p WHERE p."nasiyaId" = OLD.id)
      AND NOT (
        NEW."deleteNote" LIKE 'RETURN:%'
        AND NEW.status = 'CANCELLED'
        AND EXISTS (SELECT 1 FROM "Device" d WHERE d.id = OLD."deviceId" AND d.status = 'IN_STOCK')
      ) THEN
      RAISE EXCEPTION 'nasiya with receipts cannot be soft-deleted';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Sale_protect_history"
  BEFORE UPDATE OR DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION "protect_contract_history"();
CREATE TRIGGER "Nasiya_protect_history"
  BEFORE UPDATE OR DELETE ON "Nasiya"
  FOR EACH ROW EXECUTE FUNCTION "protect_contract_history"();
