-- Return currency and refund-method integrity.
--
-- The shop-selected currency is the refund command currency. The original
-- receipt method remains optional audit evidence and never restricts how the
-- business refunds the customer. A later FX rate can also create a real,
-- signed UZS gain/loss; preserving it is required for accurate reporting.

BEGIN;

ALTER TABLE "ReturnRefundAllocation"
  DROP CONSTRAINT IF EXISTS "ReturnRefundAllocation_same_method_check";

ALTER TABLE "ReturnRefundAllocation"
  ALTER COLUMN "sourcePaymentMethod" DROP NOT NULL;

ALTER TABLE "DeviceReturn"
  ADD COLUMN "refundExchangeRateSource" TEXT,
  ADD COLUMN "refundExchangeRateEffectiveAt" TIMESTAMP(3),
  ADD COLUMN "refundExchangeRateFetchedAt" TIMESTAMP(3);

-- All disposition values remain non-negative except the UZS net retained
-- value. That field is signed because refunding the same native amount at a
-- later, higher rate is a genuine FX loss.
ALTER TABLE "DeviceReturn"
  DROP CONSTRAINT "DeviceReturn_nonnegative_disposition_check";

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
  ) NOT VALID;

-- Version-2 writers must preserve the exact entered amount/currency and,
-- whenever USD participates in a non-zero refund, the governed quote used to
-- derive both the contract-native amount and the UZS reporting snapshot.
-- NOT VALID keeps historic version-2 rows readable without inventing missing
-- provider metadata; PostgreSQL enforces this for every new row immediately.
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_refund_input_snapshot_check"
  CHECK (
    "ledgerVersion" = 1 OR (
      "refundInputAmount" IS NOT NULL
      AND "refundInputCurrency" IS NOT NULL
      AND "refundInputAmount" >= 0
      AND (
        ("refundInputCurrency" = 'UZS' AND trunc("refundInputAmount") = "refundInputAmount")
        OR "refundInputCurrency" = 'USD'
      )
      AND (
        (
          "refundInputAmount" = 0
          AND "refundAmount" = 0
          AND "contractRefundAmount" = 0
          AND "refundExchangeRateAtCreation" IS NULL
          AND "refundExchangeRateSource" IS NULL
          AND "refundExchangeRateEffectiveAt" IS NULL
          AND "refundExchangeRateFetchedAt" IS NULL
        )
        OR (
          "refundInputAmount" > 0
          AND "refundAmount" > 0
          AND "contractRefundAmount" > 0
          AND (
            (
              "refundInputCurrency" = 'UZS'
              AND "contractCurrency" = 'UZS'
              AND "refundExchangeRateAtCreation" IS NULL
              AND "refundExchangeRateSource" IS NULL
              AND "refundExchangeRateEffectiveAt" IS NULL
              AND "refundExchangeRateFetchedAt" IS NULL
            )
            OR (
              ("refundInputCurrency" = 'USD' OR "contractCurrency" = 'USD')
              AND "refundExchangeRateAtCreation" IS NOT NULL
              AND "refundExchangeRateAtCreation" BETWEEN 1000 AND 100000
              AND "refundExchangeRateSource" IS NOT NULL
              AND length(btrim("refundExchangeRateSource")) > 0
              AND "refundExchangeRateFetchedAt" IS NOT NULL
            )
          )
          AND "refundAmount" = CASE
            WHEN "refundInputCurrency" = 'USD'
              THEN round("refundInputAmount" * "refundExchangeRateAtCreation")
            ELSE "refundInputAmount"
          END
          AND "contractRefundAmount" = CASE
            WHEN "refundInputCurrency" = "contractCurrency"
              THEN "refundInputAmount"
            WHEN "contractCurrency" = 'UZS'
              THEN "refundAmount"
            ELSE round("refundAmount" / "refundExchangeRateAtCreation", 2)
          END
        )
      )
    )
  ) NOT VALID;

-- Contract-native allocations remain capped by verified receipts. Their UZS
-- values reconcile to the actual outgoing refund and may legitimately exceed
-- the historical UZS receipt snapshot because that difference is the FX
-- gain/loss recorded in DeviceReturn.retainedValueAmountUzs.
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

  RETURN NULL;
END;
$$;

COMMIT;
