-- Audited early settlement for Nasiya.
--
-- Cash receipts remain in NasiyaPayment/NasiyaPaymentAllocation. The new
-- immutable settlement ledger records the agreement and, when explicitly
-- authorized, only the still-unpaid Nasiya interest that was waived.

ALTER TYPE "NasiyaScheduleStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

BEGIN;

CREATE TYPE "NasiyaSettlementMode" AS ENUM (
  'FULL_WITH_PROFIT',
  'WAIVE_REMAINING_PROFIT'
);

ALTER TABLE "Nasiya"
  ADD COLUMN "interestWaivedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractInterestWaivedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "NasiyaSchedule"
  ADD COLUMN "interestWaivedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractInterestWaivedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Replace the pre-waiver debt equations. Existing rows receive a zero waiver,
-- so the migration is data-preserving and the new identity is immediately
-- equivalent for every historic contract.
ALTER TABLE "Nasiya" DROP CONSTRAINT "Nasiya_contract_reconciliation_check";
ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_contract_reconciliation_check"
  CHECK (
    "contractDownPayment" <= "contractTotalAmount"
    AND "contractBaseRemainingAmount" = "contractTotalAmount" - "contractDownPayment"
    AND "contractFinalAmount" = "contractBaseRemainingAmount" + "contractInterestAmount"
    AND "contractPaidAmount" + "contractInterestWaivedAmount" + "contractRemainingAmount" = "contractFinalAmount"
    AND "contractInterestWaivedAmount" >= 0
    AND "interestWaivedAmount" >= 0
    AND "contractInterestWaivedAmount" <= "contractInterestAmount"
    AND (
      "status" = 'CANCELLED'
      OR ("status" = 'COMPLETED') = ("contractRemainingAmount" = 0)
    )
  ) NOT VALID;

ALTER TABLE "NasiyaSchedule" DROP CONSTRAINT "NasiyaSchedule_native_ledger_check";
ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_native_ledger_check"
  CHECK (
    "contractExpectedAmount" > 0
    AND "contractPaidAmount" >= 0
    AND "contractInterestWaivedAmount" >= 0
    AND "interestWaivedAmount" >= 0
    AND "contractPaidAmount" + "contractInterestWaivedAmount" <= "contractExpectedAmount"
    AND "contractRemainingAmount" = "contractExpectedAmount" - "contractPaidAmount" - "contractInterestWaivedAmount"
    AND "contractInterestPaidAmount" + "contractInterestWaivedAmount" <= "contractInterestAmount"
    AND (
      "status" = 'CANCELLED'
      OR (
        ("status" = 'PAID') = ("contractRemainingAmount" = 0 AND "contractInterestWaivedAmount" = 0)
        AND ("status" = 'SETTLED') = ("contractRemainingAmount" = 0 AND "contractInterestWaivedAmount" > 0)
      )
    )
  ) NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_waiver_currency_precision_check"
  CHECK (
    trunc("interestWaivedAmount") = "interestWaivedAmount"
    AND (
      "contractCurrency" = 'USD'
      OR trunc("contractInterestWaivedAmount") = "contractInterestWaivedAmount"
    )
  ) NOT VALID;

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_waiver_currency_precision_check"
  CHECK (
    trunc("interestWaivedAmount") = "interestWaivedAmount"
    AND (
      "contractCurrency" = 'USD'
      OR trunc("contractInterestWaivedAmount") = "contractInterestWaivedAmount"
    )
  ) NOT VALID;

CREATE TABLE "NasiyaSettlement" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "nasiyaId" TEXT NOT NULL,
  "nasiyaPaymentId" TEXT,
  "mode" "NasiyaSettlementMode" NOT NULL,
  "contractCurrency" "CurrencyCode" NOT NULL,
  "contractRemainingBefore" DECIMAL(12,2) NOT NULL,
  "contractCashReceivedAmount" DECIMAL(12,2) NOT NULL,
  "contractInterestWaivedAmount" DECIMAL(12,2) NOT NULL,
  "contractRemainingAfter" DECIMAL(12,2) NOT NULL,
  "cashReceivedAmountUzs" DECIMAL(12,2) NOT NULL,
  "interestWaivedAmountUzs" DECIMAL(12,2) NOT NULL,
  "frozenUsdUzsRate" DECIMAL(12,4),
  "frozenUsdUzsRateSource" TEXT,
  "frozenUsdUzsRateEffectiveAt" TIMESTAMP(3),
  "frozenUsdUzsRateFetchedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "actorId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasiyaSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NasiyaSettlement_amounts_check" CHECK (
    "contractRemainingBefore" > 0
    AND "contractCashReceivedAmount" >= 0
    AND "contractInterestWaivedAmount" >= 0
    AND "contractRemainingAfter" = 0
    AND "cashReceivedAmountUzs" >= 0
    AND "interestWaivedAmountUzs" >= 0
    AND "contractRemainingBefore" = "contractCashReceivedAmount" + "contractInterestWaivedAmount"
    AND (("contractCashReceivedAmount" > 0) = ("nasiyaPaymentId" IS NOT NULL))
    AND (
      ("mode" = 'FULL_WITH_PROFIT' AND "contractInterestWaivedAmount" = 0 AND "contractCashReceivedAmount" = "contractRemainingBefore")
      OR
      ("mode" = 'WAIVE_REMAINING_PROFIT' AND "contractInterestWaivedAmount" > 0 AND char_length(trim(COALESCE("reason", ''))) >= 3)
    )
  ),
  CONSTRAINT "NasiyaSettlement_currency_precision_check" CHECK (
    trunc("cashReceivedAmountUzs") = "cashReceivedAmountUzs"
    AND trunc("interestWaivedAmountUzs") = "interestWaivedAmountUzs"
    AND (
      "contractCurrency" = 'USD'
      OR (
        trunc("contractRemainingBefore") = "contractRemainingBefore"
        AND trunc("contractCashReceivedAmount") = "contractCashReceivedAmount"
        AND trunc("contractInterestWaivedAmount") = "contractInterestWaivedAmount"
        AND trunc("contractRemainingAfter") = "contractRemainingAfter"
      )
    )
  )
);

CREATE TABLE "NasiyaSettlementAllocation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "nasiyaId" TEXT NOT NULL,
  "nasiyaSettlementId" TEXT NOT NULL,
  "nasiyaScheduleId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "contractCurrency" "CurrencyCode" NOT NULL,
  "contractRemainingBefore" DECIMAL(12,2) NOT NULL,
  "contractCashAmount" DECIMAL(12,2) NOT NULL,
  "contractInterestWaivedAmount" DECIMAL(12,2) NOT NULL,
  "contractRemainingAfter" DECIMAL(12,2) NOT NULL,
  "cashAmountUzs" DECIMAL(12,2) NOT NULL,
  "interestWaivedAmountUzs" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasiyaSettlementAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NasiyaSettlementAllocation_amounts_check" CHECK (
    "sequence" > 0
    AND "contractRemainingBefore" > 0
    AND "contractCashAmount" >= 0
    AND "contractInterestWaivedAmount" >= 0
    AND "contractRemainingAfter" = 0
    AND "cashAmountUzs" >= 0
    AND "interestWaivedAmountUzs" >= 0
    AND "contractRemainingBefore" = "contractCashAmount" + "contractInterestWaivedAmount"
  ),
  CONSTRAINT "NasiyaSettlementAllocation_currency_precision_check" CHECK (
    trunc("cashAmountUzs") = "cashAmountUzs"
    AND trunc("interestWaivedAmountUzs") = "interestWaivedAmountUzs"
    AND (
      "contractCurrency" = 'USD'
      OR (
        trunc("contractRemainingBefore") = "contractRemainingBefore"
        AND trunc("contractCashAmount") = "contractCashAmount"
        AND trunc("contractInterestWaivedAmount") = "contractInterestWaivedAmount"
        AND trunc("contractRemainingAfter") = "contractRemainingAfter"
      )
    )
  )
);

CREATE UNIQUE INDEX "NasiyaSettlement_nasiyaId_key" ON "NasiyaSettlement"("nasiyaId");
CREATE UNIQUE INDEX "NasiyaSettlement_nasiyaPaymentId_key" ON "NasiyaSettlement"("nasiyaPaymentId");
CREATE UNIQUE INDEX "NasiyaSettlement_id_shopId_nasiyaId_key" ON "NasiyaSettlement"("id", "shopId", "nasiyaId");
CREATE UNIQUE INDEX "NasiyaSettlement_shopId_idempotencyKey_key" ON "NasiyaSettlement"("shopId", "idempotencyKey");
CREATE INDEX "NasiyaSettlement_shopId_settledAt_id_idx" ON "NasiyaSettlement"("shopId", "settledAt", "id");
CREATE INDEX "NasiyaSettlement_shopId_mode_settledAt_idx" ON "NasiyaSettlement"("shopId", "mode", "settledAt");

CREATE UNIQUE INDEX "NasiyaSettlementAllocation_nasiyaSettlementId_sequence_key"
  ON "NasiyaSettlementAllocation"("nasiyaSettlementId", "sequence");
CREATE UNIQUE INDEX "NasiyaSettlementAllocation_nasiyaSettlementId_nasiyaScheduleId_key"
  ON "NasiyaSettlementAllocation"("nasiyaSettlementId", "nasiyaScheduleId");
CREATE INDEX "NasiyaSettlementAllocation_shopId_createdAt_idx"
  ON "NasiyaSettlementAllocation"("shopId", "createdAt");
CREATE INDEX "NasiyaSettlementAllocation_nasiyaId_idx" ON "NasiyaSettlementAllocation"("nasiyaId");
CREATE INDEX "NasiyaSettlementAllocation_nasiyaScheduleId_idx" ON "NasiyaSettlementAllocation"("nasiyaScheduleId");

ALTER TABLE "NasiyaSettlement" ADD CONSTRAINT "NasiyaSettlement_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlement" ADD CONSTRAINT "NasiyaSettlement_nasiyaId_fkey"
  FOREIGN KEY ("nasiyaId") REFERENCES "Nasiya"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlement" ADD CONSTRAINT "NasiyaSettlement_nasiya_shop_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlement" ADD CONSTRAINT "NasiyaSettlement_nasiyaPaymentId_fkey"
  FOREIGN KEY ("nasiyaPaymentId") REFERENCES "NasiyaPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlement" ADD CONSTRAINT "NasiyaSettlement_payment_shop_fkey"
  FOREIGN KEY ("nasiyaPaymentId", "shopId") REFERENCES "NasiyaPayment"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_nasiyaId_fkey"
  FOREIGN KEY ("nasiyaId") REFERENCES "Nasiya"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_nasiya_shop_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_settlement_fkey"
  FOREIGN KEY ("nasiyaSettlementId") REFERENCES "NasiyaSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_settlement_shop_nasiya_fkey"
  FOREIGN KEY ("nasiyaSettlementId", "shopId", "nasiyaId") REFERENCES "NasiyaSettlement"("id", "shopId", "nasiyaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_schedule_fkey"
  FOREIGN KEY ("nasiyaScheduleId") REFERENCES "NasiyaSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaSettlementAllocation" ADD CONSTRAINT "NasiyaSettlementAllocation_schedule_shop_nasiya_fkey"
  FOREIGN KEY ("nasiyaScheduleId", "shopId", "nasiyaId") REFERENCES "NasiyaSchedule"("id", "shopId", "nasiyaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Settlement evidence is append-only. Corrections require an explicit future
-- compensating design; neither UI nor API may rewrite historic agreements.
CREATE TRIGGER "NasiyaSettlement_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaSettlement"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();
CREATE TRIGGER "NasiyaSettlementAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaSettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();

-- Upgrade the existing deferred parent/schedule invariant to the fulfilled
-- identity expected = cash paid + interest waived + still remaining.
CREATE OR REPLACE FUNCTION "validate_nasiya_parent_schedule_ledger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_nasiya_id TEXT;
  parent_row "Nasiya"%ROWTYPE;
  schedule_count BIGINT;
  schedule_currency_mismatch BOOLEAN;
  schedule_expected NUMERIC;
  schedule_paid NUMERIC;
  schedule_waived NUMERIC;
  schedule_remaining NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_nasiya_id := CASE WHEN TG_TABLE_NAME = 'Nasiya' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(OLD)->>'nasiyaId' END;
  ELSE
    target_nasiya_id := CASE WHEN TG_TABLE_NAME = 'Nasiya' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'nasiyaId' END;
  END IF;

  SELECT * INTO parent_row FROM "Nasiya" WHERE id = target_nasiya_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT
    COUNT(*),
    COALESCE(BOOL_OR(s."contractCurrency" <> parent_row."contractCurrency"), FALSE),
    COALESCE(SUM(s."contractExpectedAmount"), 0),
    COALESCE(SUM(s."contractPaidAmount"), 0),
    COALESCE(SUM(s."contractInterestWaivedAmount"), 0),
    COALESCE(SUM(s."contractRemainingAmount"), 0)
  INTO schedule_count, schedule_currency_mismatch, schedule_expected, schedule_paid, schedule_waived, schedule_remaining
  FROM "NasiyaSchedule" s
  WHERE s."nasiyaId" = target_nasiya_id;

  IF schedule_count = 0 THEN RAISE EXCEPTION 'nasiya % has no authoritative schedules', target_nasiya_id; END IF;
  IF schedule_currency_mismatch THEN RAISE EXCEPTION 'nasiya % has schedule currency different from its immutable contract currency', target_nasiya_id; END IF;
  IF schedule_expected <> parent_row."contractFinalAmount" THEN RAISE EXCEPTION 'nasiya % schedule expected total does not equal financed total', target_nasiya_id; END IF;
  IF schedule_expected <> schedule_paid + schedule_waived + schedule_remaining THEN RAISE EXCEPTION 'nasiya % schedule paid/waived/remaining totals do not reconcile', target_nasiya_id; END IF;
  IF schedule_paid <> parent_row."contractPaidAmount"
    OR schedule_waived <> parent_row."contractInterestWaivedAmount"
    OR schedule_remaining <> parent_row."contractRemainingAmount" THEN
    RAISE EXCEPTION 'nasiya % parent paid/waived/remaining cache differs from schedules', target_nasiya_id;
  END IF;
  IF parent_row.status <> 'CANCELLED'::"NasiyaStatus"
    AND (parent_row.status = 'COMPLETED'::"NasiyaStatus") <> (schedule_remaining = 0) THEN
    RAISE EXCEPTION 'nasiya % terminal status differs from its schedule balance', target_nasiya_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "validate_nasiya_settlement_ledger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_nasiya_id TEXT;
  settlement_row "NasiyaSettlement"%ROWTYPE;
  parent_row "Nasiya"%ROWTYPE;
  allocation_count BIGINT;
  allocation_before NUMERIC;
  allocation_cash NUMERIC;
  allocation_waived NUMERIC;
  allocation_after NUMERIC;
  allocation_cash_uzs NUMERIC;
  allocation_waived_uzs NUMERIC;
  allocation_currency_mismatch BOOLEAN;
  receipt_contract_amount NUMERIC;
  receipt_uzs_amount NUMERIC;
  invalid_schedule_count BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'NasiyaSettlement' THEN
    target_nasiya_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."nasiyaId" ELSE NEW."nasiyaId" END;
  ELSIF TG_TABLE_NAME = 'Nasiya' THEN
    target_nasiya_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_nasiya_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."nasiyaId" ELSE NEW."nasiyaId" END;
  END IF;

  SELECT * INTO settlement_row FROM "NasiyaSettlement" WHERE "nasiyaId" = target_nasiya_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO parent_row FROM "Nasiya" WHERE id = target_nasiya_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settled nasiya % no longer exists', target_nasiya_id; END IF;

  SELECT COUNT(*), COALESCE(SUM(a."contractRemainingBefore"), 0),
    COALESCE(SUM(a."contractCashAmount"), 0), COALESCE(SUM(a."contractInterestWaivedAmount"), 0),
    COALESCE(SUM(a."contractRemainingAfter"), 0),
    COALESCE(SUM(a."cashAmountUzs"), 0), COALESCE(SUM(a."interestWaivedAmountUzs"), 0),
    COALESCE(BOOL_OR(a."contractCurrency" <> settlement_row."contractCurrency"), FALSE)
  INTO allocation_count, allocation_before, allocation_cash, allocation_waived, allocation_after,
    allocation_cash_uzs, allocation_waived_uzs, allocation_currency_mismatch
  FROM "NasiyaSettlementAllocation" a
  WHERE a."nasiyaSettlementId" = settlement_row.id;

  IF allocation_count = 0
    OR allocation_before <> settlement_row."contractRemainingBefore"
    OR allocation_cash <> settlement_row."contractCashReceivedAmount"
    OR allocation_waived <> settlement_row."contractInterestWaivedAmount"
    OR allocation_after <> settlement_row."contractRemainingAfter"
    OR allocation_cash_uzs <> settlement_row."cashReceivedAmountUzs"
    OR allocation_waived_uzs <> settlement_row."interestWaivedAmountUzs"
    OR allocation_currency_mismatch THEN
    RAISE EXCEPTION 'nasiya % settlement allocations do not reconcile with header', target_nasiya_id;
  END IF;

  IF parent_row.status <> 'COMPLETED'::"NasiyaStatus"
    OR parent_row."contractRemainingAmount" <> 0
    OR parent_row."contractInterestWaivedAmount" <> settlement_row."contractInterestWaivedAmount"
    OR parent_row."contractCurrency" <> settlement_row."contractCurrency" THEN
    RAISE EXCEPTION 'nasiya % settled parent projection does not reconcile', target_nasiya_id;
  END IF;

  SELECT COUNT(*) INTO invalid_schedule_count
  FROM "NasiyaSettlementAllocation" a
  JOIN "NasiyaSchedule" s ON s.id = a."nasiyaScheduleId"
  WHERE a."nasiyaSettlementId" = settlement_row.id
    AND (
      s."nasiyaId" <> settlement_row."nasiyaId"
      OR s."shopId" <> settlement_row."shopId"
      OR s."contractCurrency" <> settlement_row."contractCurrency"
      OR s."contractRemainingAmount" <> 0
      OR s."contractInterestWaivedAmount" <> a."contractInterestWaivedAmount"
      OR s."contractPaidAmount" <> s."contractExpectedAmount" - a."contractInterestWaivedAmount"
      OR (s.status = 'SETTLED'::"NasiyaScheduleStatus") <> (a."contractInterestWaivedAmount" > 0)
      OR (s.status = 'PAID'::"NasiyaScheduleStatus") <> (a."contractInterestWaivedAmount" = 0)
    );
  IF invalid_schedule_count > 0 THEN RAISE EXCEPTION 'nasiya % settled schedule projection does not reconcile', target_nasiya_id; END IF;

  IF settlement_row."nasiyaPaymentId" IS NOT NULL THEN
    SELECT p."appliedAmountInContractCurrency", p.amount
    INTO receipt_contract_amount, receipt_uzs_amount
    FROM "NasiyaPayment" p
    WHERE p.id = settlement_row."nasiyaPaymentId" AND p."nasiyaId" = settlement_row."nasiyaId" AND p."shopId" = settlement_row."shopId";
    IF NOT FOUND
      OR receipt_contract_amount <> settlement_row."contractCashReceivedAmount"
      OR receipt_uzs_amount <> settlement_row."cashReceivedAmountUzs" THEN
      RAISE EXCEPTION 'nasiya % settlement receipt does not reconcile', target_nasiya_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "NasiyaSettlement_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "NasiyaSettlement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_nasiya_settlement_ledger"();
CREATE CONSTRAINT TRIGGER "NasiyaSettlementAllocation_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "NasiyaSettlementAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_nasiya_settlement_ledger"();
CREATE CONSTRAINT TRIGGER "Nasiya_settlement_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "Nasiya"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_nasiya_settlement_ledger"();
CREATE CONSTRAINT TRIGGER "NasiyaSchedule_settlement_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "NasiyaSchedule"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_nasiya_settlement_ledger"();

-- Deliberately not backfilled to staff presets. Receiving a payment is not
-- authority to forgive profit; owners may grant this destructive capability
-- explicitly through the existing permission UI.
INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder", "isActive")
VALUES
  ('NASIYA_PROFIT_WAIVE', 'Nasiya foydasidan kechish', 'Nasiyani yopishda faqat hali olinmagan foydadan voz kechish', 'NASIYA', 165, TRUE)
ON CONFLICT ("code") DO UPDATE SET
  "nameUz" = EXCLUDED."nameUz",
  "descriptionUz" = EXCLUDED."descriptionUz",
  "featureCode" = EXCLUDED."featureCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
