-- Payment-basis monthly profit recognition.
--
-- This migration is deliberately additive. Historic rows start PENDING and
-- are made COMPLETE only by the guarded replay command after it proves that
-- every stored schedule/payment reconciles. Cash receipt rows are untouched.

CREATE TYPE "AccountingReconstructionStatus" AS ENUM (
  'PENDING',
  'COMPLETE',
  'PARTIAL',
  'UNRECONSTRUCTABLE'
);

ALTER TABLE "Sale"
  ADD COLUMN "contractCostBasisAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractPrincipalPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "accountingReconstructionStatus" "AccountingReconstructionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "accountingReconstructionReason" TEXT,
  ADD COLUMN "accountingReconstructedAt" TIMESTAMP(3);

ALTER TABLE "SalePayment"
  ADD COLUMN "contractPrincipalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "principalAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "marginAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Nasiya"
  ADD COLUMN "contractCostBasisAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractDownPaymentPrincipalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractDownPaymentMarginAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "accountingReconstructionStatus" "AccountingReconstructionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "accountingReconstructionReason" TEXT,
  ADD COLUMN "accountingReconstructedAt" TIMESTAMP(3);

ALTER TABLE "NasiyaSchedule"
  ADD COLUMN "contractPrincipalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractInterestAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractPrincipalPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMarginPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractInterestPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_payment_profit_components_check"
  CHECK (
    "accountingReconstructionStatus" <> 'COMPLETE'
    OR (
      "contractCostBasisAmount" >= 0
      AND "contractCostBasisAmount" + "contractMarginAmount" = "contractSalePrice"
      AND "contractPrincipalPaidAmount" + "contractMarginPaidAmount" = "contractAmountPaid"
    )
  ) NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_payment_profit_components_check"
  CHECK (
    "accountingReconstructionStatus" <> 'COMPLETE'
    OR (
      "contractCostBasisAmount" >= 0
      AND "contractCostBasisAmount" + "contractMarginAmount" = "contractTotalAmount"
      AND "contractDownPaymentPrincipalAmount" + "contractDownPaymentMarginAmount" = "contractDownPayment"
    )
  ) NOT VALID;

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_profit_components_check"
  CHECK (
    (
      "contractPrincipalAmount" = 0
      AND "contractMarginAmount" = 0
      AND "contractInterestAmount" = 0
      AND "contractPrincipalPaidAmount" = 0
      AND "contractMarginPaidAmount" = 0
      AND "contractInterestPaidAmount" = 0
    )
    OR (
      "contractPrincipalAmount" + "contractMarginAmount" + "contractInterestAmount" = "contractExpectedAmount"
      AND "contractPrincipalPaidAmount" + "contractMarginPaidAmount" + "contractInterestPaidAmount" = "contractPaidAmount"
    )
  ) NOT VALID;

CREATE TABLE "NasiyaPaymentAllocation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "nasiyaId" TEXT NOT NULL,
  "nasiyaPaymentId" TEXT NOT NULL,
  "nasiyaScheduleId" TEXT,
  "sequence" INTEGER NOT NULL,
  "contractCurrency" "CurrencyCode" NOT NULL,
  "contractAmount" DECIMAL(12,2) NOT NULL,
  "contractPrincipalAmount" DECIMAL(12,2) NOT NULL,
  "contractMarginAmount" DECIMAL(12,2) NOT NULL,
  "contractInterestAmount" DECIMAL(12,2) NOT NULL,
  "amountUzs" DECIMAL(12,2) NOT NULL,
  "principalAmountUzs" DECIMAL(12,2) NOT NULL,
  "marginAmountUzs" DECIMAL(12,2) NOT NULL,
  "interestAmountUzs" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasiyaPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NasiyaPaymentAllocation_positive_check" CHECK (
    "sequence" > 0 AND "contractAmount" > 0 AND "amountUzs" > 0
  ),
  CONSTRAINT "NasiyaPaymentAllocation_contract_components_check" CHECK (
    "contractPrincipalAmount" + "contractMarginAmount" + "contractInterestAmount" = "contractAmount"
  ),
  CONSTRAINT "NasiyaPaymentAllocation_uzs_components_check" CHECK (
    "principalAmountUzs" + "marginAmountUzs" + "interestAmountUzs" = "amountUzs"
  )
);

CREATE UNIQUE INDEX "NasiyaPaymentAllocation_nasiyaPaymentId_sequence_key"
  ON "NasiyaPaymentAllocation"("nasiyaPaymentId", "sequence");
CREATE INDEX "NasiyaPaymentAllocation_shopId_createdAt_idx"
  ON "NasiyaPaymentAllocation"("shopId", "createdAt");
CREATE INDEX "NasiyaPaymentAllocation_nasiyaId_idx"
  ON "NasiyaPaymentAllocation"("nasiyaId");
CREATE INDEX "NasiyaPaymentAllocation_nasiyaScheduleId_idx"
  ON "NasiyaPaymentAllocation"("nasiyaScheduleId");

CREATE UNIQUE INDEX "NasiyaPayment_id_shopId_nasiyaId_key"
  ON "NasiyaPayment"("id", "shopId", "nasiyaId");

ALTER TABLE "NasiyaPaymentAllocation" ADD CONSTRAINT "NasiyaPaymentAllocation_shop_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaPaymentAllocation" ADD CONSTRAINT "NasiyaPaymentAllocation_nasiya_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaPaymentAllocation" ADD CONSTRAINT "NasiyaPaymentAllocation_payment_fkey"
  FOREIGN KEY ("nasiyaPaymentId", "shopId", "nasiyaId")
  REFERENCES "NasiyaPayment"("id", "shopId", "nasiyaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NasiyaPaymentAllocation" ADD CONSTRAINT "NasiyaPaymentAllocation_schedule_fkey"
  FOREIGN KEY ("nasiyaScheduleId", "shopId", "nasiyaId")
  REFERENCES "NasiyaSchedule"("id", "shopId", "nasiyaId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReturnProfitReversal" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceReturnId" TEXT NOT NULL,
  "saleId" TEXT,
  "nasiyaId" TEXT,
  "recognizedMarginAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "recognizedInterestAmountUzs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnProfitReversal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReturnProfitReversal_one_contract_check" CHECK (num_nonnulls("saleId", "nasiyaId") = 1),
  CONSTRAINT "ReturnProfitReversal_interest_nonnegative_check" CHECK ("recognizedInterestAmountUzs" >= 0)
);

CREATE UNIQUE INDEX "ReturnProfitReversal_deviceReturnId_key" ON "ReturnProfitReversal"("deviceReturnId");
CREATE INDEX "ReturnProfitReversal_shopId_createdAt_idx" ON "ReturnProfitReversal"("shopId", "createdAt");
CREATE INDEX "ReturnProfitReversal_saleId_idx" ON "ReturnProfitReversal"("saleId");
CREATE INDEX "ReturnProfitReversal_nasiyaId_idx" ON "ReturnProfitReversal"("nasiyaId");

ALTER TABLE "ReturnProfitReversal" ADD CONSTRAINT "ReturnProfitReversal_shop_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnProfitReversal" ADD CONSTRAINT "ReturnProfitReversal_return_fkey"
  FOREIGN KEY ("deviceReturnId", "shopId") REFERENCES "DeviceReturn"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnProfitReversal" ADD CONSTRAINT "ReturnProfitReversal_sale_fkey"
  FOREIGN KEY ("saleId", "shopId") REFERENCES "Sale"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnProfitReversal" ADD CONSTRAINT "ReturnProfitReversal_nasiya_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Allocation and reversal facts are append-only audit evidence.
CREATE TRIGGER "NasiyaPaymentAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();
CREATE TRIGGER "ReturnProfitReversal_immutable"
  BEFORE UPDATE OR DELETE ON "ReturnProfitReversal"
  FOR EACH ROW EXECUTE FUNCTION "prevent_return_ledger_mutation"();
