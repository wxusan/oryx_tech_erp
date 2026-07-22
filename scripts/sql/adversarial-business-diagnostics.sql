\set ON_ERROR_STOP on
\pset pager off

-- Oryx ERP adversarial business-integrity diagnostics.
-- This pack is intentionally read-only. Every non-summary result should be
-- investigated; it does not authorize or perform a repair.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '== invalid or stale currency rates =='
SELECT id, "baseCurrency", "quoteCurrency", rate, source,
       "fetchedAt", "effectiveDate", "createdAt"
FROM "CurrencyRate"
WHERE rate <= 0
   OR "baseCurrency" <> 'USD'::"CurrencyCode"
   OR "quoteCurrency" <> 'UZS'::"CurrencyCode"
   OR rate NOT BETWEEN 1000 AND 100000
   OR "fetchedAt" < CURRENT_TIMESTAMP - INTERVAL '7 days'
   OR "fetchedAt" > CURRENT_TIMESTAMP + INTERVAL '5 minutes'
   OR "effectiveDate" > CURRENT_TIMESTAMP + INTERVAL '1 day'
ORDER BY "baseCurrency", "quoteCurrency", "fetchedAt";

\echo '== active simple-sale ledger equations that do not balance =='
SELECT s.id, s."shopId", s."contractCurrency",
       s."contractSalePrice", s."contractAmountPaid", s."contractRemainingAmount",
       s."salePrice", s."amountPaid", s."remainingAmount", s."paidFully"
FROM "Sale" s
WHERE s."deletedAt" IS NULL
  AND (
    s."contractSalePrice" < 0 OR s."contractAmountPaid" < 0 OR s."contractRemainingAmount" < 0
    OR s."salePrice" < 0 OR s."amountPaid" < 0 OR s."remainingAmount" < 0
    OR ABS(s."contractSalePrice" - s."contractAmountPaid" - s."contractRemainingAmount") >=
       CASE WHEN s."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
    OR ABS(s."salePrice" - s."amountPaid" - s."remainingAmount") >= 1
    OR (s."returnedAt" IS NULL AND
        s."paidFully" <> (s."contractRemainingAmount" = 0))
    OR (s."contractCurrency" = 'UZS'::"CurrencyCode" AND
        (trunc(s."contractSalePrice") <> s."contractSalePrice"
         OR trunc(s."contractAmountPaid") <> s."contractAmountPaid"
         OR trunc(s."contractRemainingAmount") <> s."contractRemainingAmount"))
  )
ORDER BY s."shopId", s.id;

\echo '== active simple-sale payment sums versus parent ledgers =='
SELECT s.id, s."shopId", s."contractCurrency",
       s."amountPaid" AS parent_uzs_paid,
       COALESCE(SUM(p.amount) FILTER (WHERE p."deletedAt" IS NULL), 0) AS payment_uzs_sum,
       s."contractAmountPaid" AS parent_contract_paid,
       COALESCE(SUM(p."appliedAmountInContractCurrency")
         FILTER (WHERE p."deletedAt" IS NULL), 0) AS payment_contract_sum
FROM "Sale" s
LEFT JOIN "SalePayment" p ON p."saleId" = s.id
WHERE s."deletedAt" IS NULL
GROUP BY s.id
HAVING ABS(s."amountPaid" - COALESCE(SUM(p.amount) FILTER (WHERE p."deletedAt" IS NULL), 0)) >= 1
    OR ABS(s."contractAmountPaid" - COALESCE(SUM(p."appliedAmountInContractCurrency")
         FILTER (WHERE p."deletedAt" IS NULL), 0)) >=
       CASE WHEN s."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
ORDER BY s."shopId", s.id;

\echo '== active nasiya parent equations that do not balance =='
SELECT n.id, n."shopId", n."contractCurrency", n.status,
       n."contractTotalAmount", n."contractDownPayment",
       n."contractBaseRemainingAmount", n."contractInterestAmount",
       n."contractFinalAmount", n."contractPaidAmount", n."contractInterestWaivedAmount", n."contractRemainingAmount"
FROM "Nasiya" n
WHERE n."deletedAt" IS NULL
  AND (
    n."contractTotalAmount" < 0 OR n."contractDownPayment" < 0
    OR n."contractBaseRemainingAmount" < 0 OR n."contractInterestAmount" < 0
    OR n."contractFinalAmount" < 0 OR n."contractPaidAmount" < 0 OR n."contractInterestWaivedAmount" < 0
    OR n."contractRemainingAmount" < 0
    OR ABS(n."contractBaseRemainingAmount" -
           (n."contractTotalAmount" - n."contractDownPayment")) >=
       CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
    OR ABS(n."contractFinalAmount" -
           (n."contractBaseRemainingAmount" + n."contractInterestAmount")) >=
       CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
    OR ABS(n."contractFinalAmount" - n."contractPaidAmount" - n."contractInterestWaivedAmount" - n."contractRemainingAmount") >=
       CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
    OR (n.status <> 'CANCELLED'::"NasiyaStatus" AND
        (n.status = 'COMPLETED'::"NasiyaStatus") <> (n."contractRemainingAmount" = 0))
    OR (n."contractCurrency" = 'UZS'::"CurrencyCode" AND
        (trunc(n."contractTotalAmount") <> n."contractTotalAmount"
         OR trunc(n."contractDownPayment") <> n."contractDownPayment"
         OR trunc(n."contractBaseRemainingAmount") <> n."contractBaseRemainingAmount"
         OR trunc(n."contractInterestAmount") <> n."contractInterestAmount"
         OR trunc(n."contractFinalAmount") <> n."contractFinalAmount"
         OR trunc(n."contractMonthlyPayment") <> n."contractMonthlyPayment"
         OR trunc(n."contractPaidAmount") <> n."contractPaidAmount"
         OR trunc(n."contractRemainingAmount") <> n."contractRemainingAmount"))
  )
ORDER BY n."shopId", n.id;

\echo '== schedule native ledger, currency, and parent-sum mismatches =='
WITH schedule_totals AS (
  SELECT n.id AS nasiya_id,
         COALESCE(SUM(s."contractExpectedAmount"), 0) AS expected_sum,
         COALESCE(SUM(s."contractPaidAmount"), 0) AS paid_sum,
         COALESCE(SUM(s."contractInterestWaivedAmount"), 0) AS waived_sum,
         COALESCE(SUM(s."contractRemainingAmount"), 0) AS remaining_sum,
         COUNT(*) FILTER (WHERE s."contractCurrency" <> n."contractCurrency") AS currency_mismatches,
         COUNT(*) FILTER (WHERE ABS(s."contractRemainingAmount" -
           (s."contractExpectedAmount" - s."contractPaidAmount" - s."contractInterestWaivedAmount")) >=
           CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END) AS row_balance_mismatches
  FROM "Nasiya" n
  LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
  WHERE n."deletedAt" IS NULL
  GROUP BY n.id
)
SELECT n.id, n."shopId", n."contractCurrency",
       n."contractFinalAmount", n."contractPaidAmount", n."contractInterestWaivedAmount", n."contractRemainingAmount",
       t.expected_sum, t.paid_sum, t.waived_sum, t.remaining_sum,
       t.currency_mismatches, t.row_balance_mismatches
FROM "Nasiya" n
JOIN schedule_totals t ON t.nasiya_id = n.id
WHERE t.currency_mismatches > 0 OR t.row_balance_mismatches > 0
   OR ABS(n."contractFinalAmount" - t.expected_sum) >=
      CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
   OR ABS(n."contractPaidAmount" - t.paid_sum) >=
      CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
   OR ABS(n."contractInterestWaivedAmount" - t.waived_sum) >=
      CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
   OR ABS(n."contractRemainingAmount" - t.remaining_sum) >=
      CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 1 END
ORDER BY n."shopId", n.id;

\echo '== nasiya payments linked to a schedule from another contract =='
SELECT p.id, p."shopId", p."nasiyaId", p."nasiyaScheduleId",
       s."nasiyaId" AS schedule_nasiya_id, s."shopId" AS schedule_shop_id
FROM "NasiyaPayment" p
JOIN "NasiyaSchedule" s ON s.id = p."nasiyaScheduleId"
WHERE p."nasiyaScheduleId" IS NOT NULL
  AND (p."nasiyaId" <> s."nasiyaId" OR p."shopId" <> s."shopId")
ORDER BY p."shopId", p.id;

\echo '== return link shape and linked-device mismatches =='
SELECT r.id, r."shopId", r."deviceId", r."saleId", r."nasiyaId",
       s."deviceId" AS sale_device_id, n."deviceId" AS nasiya_device_id
FROM "DeviceReturn" r
LEFT JOIN "Sale" s ON s.id = r."saleId"
LEFT JOIN "Nasiya" n ON n.id = r."nasiyaId"
WHERE num_nonnulls(r."saleId", r."nasiyaId") <> 1
   OR (s.id IS NOT NULL AND (s."deviceId" <> r."deviceId" OR s."shopId" <> r."shopId"))
   OR (n.id IS NOT NULL AND (n."deviceId" <> r."deviceId" OR n."shopId" <> r."shopId"))
ORDER BY r."shopId", r.id;

\echo '== supplier payable link/status inconsistencies =='
SELECT p.id, p."shopId", p."deviceId", p."saleId", p.status,
       p."paidAt", p."paymentMethod", s."deviceId" AS sale_device_id
FROM "SupplierPayable" p
JOIN "Sale" s ON s.id = p."saleId"
WHERE p."deviceId" <> s."deviceId" OR p."shopId" <> s."shopId"
   OR (p.status = 'PAID'::"SupplierPayableStatus" AND
       (p."paidAt" IS NULL OR p."paymentMethod" IS NULL))
   OR (p.status <> 'PAID'::"SupplierPayableStatus" AND
       (p."paidAt" IS NOT NULL OR p."paymentMethod" IS NOT NULL))
ORDER BY p."shopId", p.id;

\echo '== imported nasiya bookkeeping contradictions =='
SELECT id, "shopId", "contractCurrency", "originalTotalAmount",
       "alreadyPaidBeforeImport", "remainingAtImport",
       "contractFinalAmount", "contractRemainingAmount"
FROM "Nasiya"
WHERE "isImported" = true
  AND (
    "originalTotalAmount" IS NULL OR "remainingAtImport" IS NULL
    OR "alreadyPaidBeforeImport" < 0 OR "remainingAtImport" <= 0
    OR ("originalTotalAmount" IS NOT NULL AND "remainingAtImport" IS NOT NULL
        AND ABS("originalTotalAmount" - "alreadyPaidBeforeImport" - "remainingAtImport") >= 1)
  )
ORDER BY "shopId", id;

\echo '== payment positivity and native-input precision contradictions =='
SELECT 'SALE' AS payment_type, p.id, p."shopId", p.amount,
       p."paymentInputAmount", p."paymentInputCurrency", p."paymentExchangeRate",
       p."appliedAmountInContractCurrency"
FROM "SalePayment" p
WHERE p.amount <= 0
   OR p."appliedAmountInContractCurrency" <= 0
   OR (p."paymentInputAmount" IS NULL) <> (p."paymentInputCurrency" IS NULL)
   OR (p."paymentInputCurrency" = 'UZS'::"CurrencyCode"
       AND trunc(p."paymentInputAmount") <> p."paymentInputAmount")
   OR (p."paymentExchangeRate" IS NOT NULL
       AND p."paymentExchangeRate" NOT BETWEEN 1000 AND 100000)
UNION ALL
SELECT 'NASIYA', p.id, p."shopId", p.amount,
       p."paymentInputAmount", p."paymentInputCurrency", p."paymentExchangeRate",
       p."appliedAmountInContractCurrency"
FROM "NasiyaPayment" p
WHERE p.amount <= 0 OR p."paymentMethod" IS NULL
   OR p."appliedAmountInContractCurrency" <= 0
   OR (p."paymentInputAmount" IS NULL) <> (p."paymentInputCurrency" IS NULL)
   OR (p."paymentInputCurrency" = 'UZS'::"CurrencyCode"
       AND trunc(p."paymentInputAmount") <> p."paymentInputAmount")
   OR (p."paymentExchangeRate" IS NOT NULL
       AND p."paymentExchangeRate" NOT BETWEEN 1000 AND 100000)
ORDER BY payment_type, "shopId", id;

\echo '== duplicate active Telegram ownership across all roles =='
WITH owners AS (
  SELECT 'SUPER_ADMIN' AS owner_type, id, NULL::text AS shop_id, "telegramId"
  FROM "SuperAdmin"
  WHERE "deletedAt" IS NULL AND "telegramId" IS NOT NULL
  UNION ALL
  SELECT 'SHOP_ADMIN', id, "shopId", "telegramId"
  FROM "ShopAdmin"
  WHERE "deletedAt" IS NULL AND "isActive" = true AND "telegramId" IS NOT NULL
)
SELECT "telegramId", COUNT(*) AS owner_count,
       ARRAY_AGG(owner_type || ':' || id ORDER BY owner_type, id) AS owners
FROM owners
GROUP BY "telegramId"
HAVING COUNT(*) > 1
ORDER BY owner_count DESC, "telegramId";

\echo '== queued Telegram messages with no currently authorized recipient =='
SELECT n.id, n."shopId", n.status, n.type, n."telegramId",
       n."scheduledAt", n."nextAttemptAt", n."createdAt"
FROM "Notification" n
JOIN "Shop" sh ON sh.id = n."shopId"
WHERE n.status IN ('PENDING'::"NotificationStatus", 'FAILED'::"NotificationStatus", 'PROCESSING'::"NotificationStatus")
  AND (
    sh."deletedAt" IS NOT NULL OR sh.status <> 'ACTIVE'::"ShopStatus"
    OR sh."subscriptionDue" < CURRENT_DATE
    OR NOT EXISTS (
      SELECT 1 FROM "ShopAdmin" a
      WHERE a."shopId" = n."shopId"
        AND a."telegramId" = n."telegramId"
        AND a."telegramVerifiedAt" IS NOT NULL
        AND a."deletedAt" IS NULL
        AND a."isActive" = true
    )
  )
ORDER BY n."createdAt", n.id;

\echo '== notification retention and retry-health summary =='
SELECT status,
       COUNT(*) AS row_count,
       COUNT(*) FILTER (WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '90 days') AS older_than_90_days,
       COUNT(*) FILTER (WHERE status = 'FAILED'::"NotificationStatus"
                         AND "nextAttemptAt" > CURRENT_TIMESTAMP) AS waiting_for_retry,
       MIN("createdAt") AS oldest_created_at
FROM "Notification"
GROUP BY status
ORDER BY status;

ROLLBACK;
