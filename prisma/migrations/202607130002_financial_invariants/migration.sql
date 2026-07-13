-- Financial and semantic database invariants.
--
-- Constraints are added NOT VALID where historic production rows may require
-- a separately approved repair. PostgreSQL still enforces every constraint on
-- all new or changed rows immediately. Read-only diagnostics must be clean
-- before a later release validates the historic rows.

-- Oryx currently supports one governed market pair. Do not allow unsupported,
-- zero, negative, or operationally implausible rates to enter the ledger.
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_governed_pair_check"
  CHECK (
    "baseCurrency" = 'USD'
    AND "quoteCurrency" = 'UZS'
    AND "rate" BETWEEN 1000 AND 100000
  ) NOT VALID;

-- Sale's native contract ledger is authoritative. Legacy UZS snapshots can
-- legitimately diverge after a later-rate cross-currency payment, so only
-- their non-negativity is asserted here.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_nonnegative_money_check"
  CHECK (
    "salePrice" >= 0
    AND "amountPaid" >= 0
    AND "remainingAmount" >= 0
    AND "contractSalePrice" > 0
    AND "contractAmountPaid" >= 0
    AND "contractRemainingAmount" >= 0
  ) NOT VALID;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contract_reconciliation_check"
  CHECK (
    "contractSalePrice" = "contractAmountPaid" + "contractRemainingAmount"
    AND (
      "returnedAt" IS NOT NULL
      OR "paidFully" = ("contractRemainingAmount" = 0)
    )
  ) NOT VALID;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contract_currency_precision_check"
  CHECK (
    (
      "contractCurrency" = 'UZS'
      AND trunc("contractSalePrice") = "contractSalePrice"
      AND trunc("contractAmountPaid") = "contractAmountPaid"
      AND trunc("contractRemainingAmount") = "contractRemainingAmount"
      AND "contractExchangeRateAtCreation" IS NULL
    )
    OR (
      "contractCurrency" = 'USD'
      AND "contractExchangeRateAtCreation" BETWEEN 1000 AND 100000
    )
  ) NOT VALID;

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_positive_money_check"
  CHECK (
    "amount" > 0
    AND (
      "appliedAmountInContractCurrency" IS NULL
      OR "appliedAmountInContractCurrency" > 0
    )
  ) NOT VALID;

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_input_snapshot_check"
  CHECK (
    ("paymentInputAmount" IS NULL AND "paymentInputCurrency" IS NULL AND "paymentExchangeRate" IS NULL)
    OR (
      "paymentInputAmount" > 0
      AND "paymentInputCurrency" IS NOT NULL
      AND (
        ("paymentInputCurrency" = 'UZS'
          AND trunc("paymentInputAmount") = "paymentInputAmount"
          AND ("paymentExchangeRate" IS NULL OR "paymentExchangeRate" BETWEEN 1000 AND 100000))
        OR
        ("paymentInputCurrency" = 'USD'
          AND "paymentExchangeRate" BETWEEN 1000 AND 100000)
      )
    )
  ) NOT VALID;

-- Nasiya contract equations are expressed in the frozen native currency.
ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_nonnegative_money_check"
  CHECK (
    "totalAmount" >= 0
    AND "downPayment" >= 0
    AND "baseRemainingAmount" >= 0
    AND "interestPercent" >= 0
    AND "interestAmount" >= 0
    AND "finalNasiyaAmount" >= 0
    AND "remainingAmount" >= 0
    AND "monthlyPayment" > 0
    AND "months" > 0
    AND "contractTotalAmount" > 0
    AND "contractDownPayment" >= 0
    AND "contractBaseRemainingAmount" >= 0
    AND "contractInterestAmount" >= 0
    AND "contractFinalAmount" > 0
    AND "contractMonthlyPayment" > 0
    AND "contractRemainingAmount" >= 0
    AND "contractPaidAmount" >= 0
  ) NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_contract_reconciliation_check"
  CHECK (
    "contractDownPayment" <= "contractTotalAmount"
    AND "contractBaseRemainingAmount" = "contractTotalAmount" - "contractDownPayment"
    AND "contractFinalAmount" = "contractBaseRemainingAmount" + "contractInterestAmount"
    AND "contractPaidAmount" + "contractRemainingAmount" = "contractFinalAmount"
    AND (
      "status" = 'CANCELLED'
      OR ("status" = 'COMPLETED') = ("contractRemainingAmount" = 0)
    )
  ) NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_contract_currency_precision_check"
  CHECK (
    (
      "contractCurrency" = 'UZS'
      AND trunc("contractTotalAmount") = "contractTotalAmount"
      AND trunc("contractDownPayment") = "contractDownPayment"
      AND trunc("contractBaseRemainingAmount") = "contractBaseRemainingAmount"
      AND trunc("contractInterestAmount") = "contractInterestAmount"
      AND trunc("contractFinalAmount") = "contractFinalAmount"
      AND trunc("contractMonthlyPayment") = "contractMonthlyPayment"
      AND trunc("contractRemainingAmount") = "contractRemainingAmount"
      AND trunc("contractPaidAmount") = "contractPaidAmount"
      AND "contractExchangeRateAtCreation" IS NULL
    )
    OR (
      "contractCurrency" = 'USD'
      AND "contractExchangeRateAtCreation" BETWEEN 1000 AND 100000
    )
  ) NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_import_reconciliation_check"
  CHECK (
    NOT "isImported"
    OR (
      "originalTotalAmount" IS NOT NULL
      AND "remainingAtImport" IS NOT NULL
      AND "alreadyPaidBeforeImport" >= 0
      AND "remainingAtImport" > 0
      AND "originalTotalAmount" = "alreadyPaidBeforeImport" + "remainingAtImport"
    )
  ) NOT VALID;

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_native_ledger_check"
  CHECK (
    "contractExpectedAmount" > 0
    AND "contractPaidAmount" >= 0
    AND "contractPaidAmount" <= "contractExpectedAmount"
    AND "contractRemainingAmount" = "contractExpectedAmount" - "contractPaidAmount"
    AND (
      "status" = 'CANCELLED'
      OR ("status" = 'PAID') = ("contractRemainingAmount" = 0)
    )
  ) NOT VALID;

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_currency_precision_check"
  CHECK (
    "contractCurrency" = 'USD'
    OR (
      trunc("contractExpectedAmount") = "contractExpectedAmount"
      AND trunc("contractPaidAmount") = "contractPaidAmount"
      AND trunc("contractRemainingAmount") = "contractRemainingAmount"
    )
  ) NOT VALID;

ALTER TABLE "NasiyaPayment" ADD CONSTRAINT "NasiyaPayment_positive_money_check"
  CHECK (
    "amount" > 0
    AND "paymentMethod" IS NOT NULL
    AND (
      "appliedAmountInContractCurrency" IS NULL
      OR "appliedAmountInContractCurrency" > 0
    )
  ) NOT VALID;

ALTER TABLE "NasiyaPayment" ADD CONSTRAINT "NasiyaPayment_input_snapshot_check"
  CHECK (
    ("paymentInputAmount" IS NULL AND "paymentInputCurrency" IS NULL AND "paymentExchangeRate" IS NULL)
    OR (
      "paymentInputAmount" > 0
      AND "paymentInputCurrency" IS NOT NULL
      AND (
        ("paymentInputCurrency" = 'UZS'
          AND trunc("paymentInputAmount") = "paymentInputAmount"
          AND ("paymentExchangeRate" IS NULL OR "paymentExchangeRate" BETWEEN 1000 AND 100000))
        OR
        ("paymentInputCurrency" = 'USD'
          AND "paymentExchangeRate" BETWEEN 1000 AND 100000)
      )
    )
  ) NOT VALID;

-- A schedule reference must belong to the exact Nasiya contract on the
-- payment, and every schedule must use its parent's immutable currency.
CREATE UNIQUE INDEX "Nasiya_id_shopId_contractCurrency_key"
  ON "Nasiya"("id", "shopId", "contractCurrency");
CREATE UNIQUE INDEX "NasiyaSchedule_id_shopId_nasiyaId_key"
  ON "NasiyaSchedule"("id", "shopId", "nasiyaId");

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_parent_currency_fkey"
  FOREIGN KEY ("nasiyaId", "shopId", "contractCurrency")
  REFERENCES "Nasiya"("id", "shopId", "contractCurrency")
  ON DELETE CASCADE ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "NasiyaPayment" ADD CONSTRAINT "NasiyaPayment_schedule_contract_fkey"
  FOREIGN KEY ("nasiyaScheduleId", "shopId", "nasiyaId")
  REFERENCES "NasiyaSchedule"("id", "shopId", "nasiyaId")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_money_check"
  CHECK (
    "amount" > 0
    AND "contractAmount" > 0
    AND (
      ("contractCurrency" = 'UZS'
        AND trunc("contractAmount") = "contractAmount"
        AND "contractExchangeRateAtCreation" IS NULL)
      OR
      ("contractCurrency" = 'USD'
        AND "contractExchangeRateAtCreation" BETWEEN 1000 AND 100000)
    )
  ) NOT VALID;

ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_payment_state_check"
  CHECK (
    ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "paymentMethod" IS NOT NULL)
    OR ("status" <> 'PAID' AND "paidAt" IS NULL AND "paymentMethod" IS NULL)
  ) NOT VALID;

-- Set-based dashboard/Hisobot and overdue-banner access paths. These replace
-- full-row hydration at 50k/100k obligations and keep every scan tenant-bound.
CREATE INDEX "Sale_shopId_createdAt_active_idx"
  ON "Sale"("shopId", "createdAt")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "Nasiya_shopId_createdAt_current_idx"
  ON "Nasiya"("shopId", "createdAt")
  WHERE "deletedAt" IS NULL AND "isImported" = false;
CREATE INDEX "SalePayment_shopId_paidAt_active_idx"
  ON "SalePayment"("shopId", "paidAt")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "NasiyaPayment_shopId_paidAt_active_idx"
  ON "NasiyaPayment"("shopId", "paidAt")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "NasiyaSchedule_shopId_effectiveDue_open_idx"
  ON "NasiyaSchedule"("shopId", (coalesce("delayedUntil", "dueDate")))
  WHERE "status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED');
CREATE INDEX "Sale_shopId_dueDate_open_idx"
  ON "Sale"("shopId", "dueDate")
  WHERE "deletedAt" IS NULL AND "returnedAt" IS NULL AND "paidFully" = false;
