\set ON_ERROR_STOP on
\pset pager off

-- Pre-migration release preflight for the 2026-07-13 remediation batch.
-- This file is intentionally compatible with the schema on origin/main before
-- migrations 202607130001..006. It reports counts only and never mutates data.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '== database identity (no credentials) =='
SELECT current_database() AS database_name,
       current_setting('server_version') AS postgres_version;

\echo '== release migrations already applied =='
SELECT "migration_name", "finished_at", "rolled_back_at"
FROM "_prisma_migrations"
WHERE "migration_name" LIKE '20260713%'
ORDER BY "migration_name";

\echo '== relevant production row counts =='
SELECT 'CurrencyRate' AS table_name, COUNT(*) AS row_count FROM "CurrencyRate"
UNION ALL SELECT 'Sale', COUNT(*) FROM "Sale"
UNION ALL SELECT 'SalePayment', COUNT(*) FROM "SalePayment"
UNION ALL SELECT 'Nasiya', COUNT(*) FROM "Nasiya"
UNION ALL SELECT 'NasiyaSchedule', COUNT(*) FROM "NasiyaSchedule"
UNION ALL SELECT 'NasiyaPayment', COUNT(*) FROM "NasiyaPayment"
UNION ALL SELECT 'SupplierPayable', COUNT(*) FROM "SupplierPayable"
UNION ALL SELECT 'DeviceReturn', COUNT(*) FROM "DeviceReturn"
UNION ALL SELECT 'Notification', COUNT(*) FROM "Notification"
UNION ALL SELECT 'SuperAdmin', COUNT(*) FROM "SuperAdmin"
UNION ALL SELECT 'ShopAdmin', COUNT(*) FROM "ShopAdmin"
ORDER BY table_name;

\echo '== migration-blocking Telegram identity checks (all must be zero) =='
WITH checks AS (
  SELECT 'super_admin_valid_duplicate_groups' AS check_name, COUNT(*) AS issue_count
  FROM (
    SELECT "telegramId"
    FROM "SuperAdmin"
    WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$'
    GROUP BY "telegramId"
    HAVING COUNT(*) > 1
  ) duplicates
  UNION ALL
  SELECT 'shop_admin_valid_duplicate_groups', COUNT(*)
  FROM (
    SELECT "telegramId"
    FROM "ShopAdmin"
    WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$'
    GROUP BY "telegramId"
    HAVING COUNT(*) > 1
  ) duplicates
  UNION ALL
  SELECT 'cross_role_valid_duplicate_ids', COUNT(*)
  FROM (
    SELECT DISTINCT sa."telegramId"
    FROM "SuperAdmin" sa
    JOIN "ShopAdmin" sha ON sha."telegramId" = sa."telegramId"
    WHERE sa."deletedAt" IS NULL
      AND sha."deletedAt" IS NULL
      AND sa."telegramId" ~ '^[0-9]{5,20}$'
  ) duplicates
)
SELECT check_name, issue_count FROM checks ORDER BY check_name;

\echo '== historic Telegram rows requiring later validation/repair =='
SELECT 'super_admin_invalid_live_id' AS check_name, COUNT(*) AS issue_count
FROM "SuperAdmin"
WHERE "deletedAt" IS NULL
  AND "telegramId" IS NOT NULL
  AND "telegramId" !~ '^[0-9]{5,20}$'
UNION ALL
SELECT 'shop_admin_invalid_live_id', COUNT(*)
FROM "ShopAdmin"
WHERE "deletedAt" IS NULL
  AND "telegramId" IS NOT NULL
  AND "telegramId" !~ '^[0-9]{5,20}$'
ORDER BY check_name;

\echo '== historic return link checks =='
SELECT 'all_legacy_returns_require_snapshot_review' AS check_name,
       COUNT(*) AS issue_count
FROM "DeviceReturn"
UNION ALL
SELECT 'return_exactly_one_contract_violations', COUNT(*)
FROM "DeviceReturn"
WHERE num_nonnulls("saleId", "nasiyaId") <> 1
UNION ALL
SELECT 'return_sale_device_or_shop_mismatch', COUNT(*)
FROM "DeviceReturn" r
JOIN "Sale" s ON s.id = r."saleId"
WHERE s."deviceId" <> r."deviceId" OR s."shopId" <> r."shopId"
UNION ALL
SELECT 'return_nasiya_device_or_shop_mismatch', COUNT(*)
FROM "DeviceReturn" r
JOIN "Nasiya" n ON n.id = r."nasiyaId"
WHERE n."deviceId" <> r."deviceId" OR n."shopId" <> r."shopId"
ORDER BY check_name;

\echo '== historic financial invariant counts =='
SELECT 'invalid_currency_rate' AS check_name, COUNT(*) AS issue_count
FROM "CurrencyRate"
WHERE "baseCurrency" <> 'USD'::"CurrencyCode"
   OR "quoteCurrency" <> 'UZS'::"CurrencyCode"
   OR rate NOT BETWEEN 1000 AND 100000
UNION ALL
SELECT 'sale_nonnegative_or_reconciliation', COUNT(*)
FROM "Sale"
WHERE "salePrice" < 0 OR "amountPaid" < 0 OR "remainingAmount" < 0
   OR "contractSalePrice" <= 0 OR "contractAmountPaid" < 0 OR "contractRemainingAmount" < 0
   OR "contractSalePrice" <> "contractAmountPaid" + "contractRemainingAmount"
   OR "paidFully" <> ("contractRemainingAmount" = 0)
   OR ("contractCurrency" = 'UZS'::"CurrencyCode" AND
       (trunc("contractSalePrice") <> "contractSalePrice"
        OR trunc("contractAmountPaid") <> "contractAmountPaid"
        OR trunc("contractRemainingAmount") <> "contractRemainingAmount"
        OR "contractExchangeRateAtCreation" IS NOT NULL))
   OR ("contractCurrency" = 'USD'::"CurrencyCode" AND
       "contractExchangeRateAtCreation" NOT BETWEEN 1000 AND 100000)
UNION ALL
SELECT 'sale_payment_invalid', COUNT(*)
FROM "SalePayment"
WHERE amount <= 0
   OR ("appliedAmountInContractCurrency" IS NOT NULL AND "appliedAmountInContractCurrency" <= 0)
   OR (("paymentInputAmount" IS NULL) <> ("paymentInputCurrency" IS NULL))
   OR ("paymentInputCurrency" = 'UZS'::"CurrencyCode" AND
       trunc("paymentInputAmount") <> "paymentInputAmount")
   OR ("paymentExchangeRate" IS NOT NULL AND "paymentExchangeRate" NOT BETWEEN 1000 AND 100000)
UNION ALL
SELECT 'nasiya_nonnegative_or_reconciliation', COUNT(*)
FROM "Nasiya"
WHERE "totalAmount" < 0 OR "downPayment" < 0 OR "baseRemainingAmount" < 0
   OR "interestPercent" < 0 OR "interestAmount" < 0 OR "finalNasiyaAmount" < 0
   OR "remainingAmount" < 0 OR "monthlyPayment" <= 0 OR months <= 0
   OR "contractTotalAmount" <= 0 OR "contractDownPayment" < 0
   OR "contractBaseRemainingAmount" < 0 OR "contractInterestAmount" < 0
   OR "contractFinalAmount" <= 0 OR "contractMonthlyPayment" <= 0
   OR "contractRemainingAmount" < 0 OR "contractPaidAmount" < 0
   OR "contractDownPayment" > "contractTotalAmount"
   OR "contractBaseRemainingAmount" <> "contractTotalAmount" - "contractDownPayment"
   OR "contractFinalAmount" <> "contractBaseRemainingAmount" + "contractInterestAmount"
   OR "contractPaidAmount" + "contractRemainingAmount" <> "contractFinalAmount"
   OR (status <> 'CANCELLED'::"NasiyaStatus" AND
       (status = 'COMPLETED'::"NasiyaStatus") <> ("contractRemainingAmount" = 0))
   OR ("contractCurrency" = 'UZS'::"CurrencyCode" AND
       (trunc("contractTotalAmount") <> "contractTotalAmount"
        OR trunc("contractDownPayment") <> "contractDownPayment"
        OR trunc("contractBaseRemainingAmount") <> "contractBaseRemainingAmount"
        OR trunc("contractInterestAmount") <> "contractInterestAmount"
        OR trunc("contractFinalAmount") <> "contractFinalAmount"
        OR trunc("contractMonthlyPayment") <> "contractMonthlyPayment"
        OR trunc("contractRemainingAmount") <> "contractRemainingAmount"
        OR trunc("contractPaidAmount") <> "contractPaidAmount"
        OR "contractExchangeRateAtCreation" IS NOT NULL))
   OR ("contractCurrency" = 'USD'::"CurrencyCode" AND
       "contractExchangeRateAtCreation" NOT BETWEEN 1000 AND 100000)
UNION ALL
SELECT 'nasiya_import_invalid', COUNT(*)
FROM "Nasiya"
WHERE "isImported" = true
  AND ("originalTotalAmount" IS NULL OR "remainingAtImport" IS NULL
       OR "alreadyPaidBeforeImport" < 0 OR "remainingAtImport" <= 0
       OR "originalTotalAmount" <> "alreadyPaidBeforeImport" + "remainingAtImport")
UNION ALL
SELECT 'nasiya_schedule_invalid', COUNT(*)
FROM "NasiyaSchedule"
WHERE "contractExpectedAmount" <= 0 OR "contractPaidAmount" < 0
   OR "contractPaidAmount" > "contractExpectedAmount"
   OR "contractRemainingAmount" <> "contractExpectedAmount" - "contractPaidAmount"
   OR (status = 'PAID'::"NasiyaScheduleStatus") <> ("contractRemainingAmount" = 0)
   OR ("contractCurrency" = 'UZS'::"CurrencyCode" AND
       (trunc("contractExpectedAmount") <> "contractExpectedAmount"
        OR trunc("contractPaidAmount") <> "contractPaidAmount"
        OR trunc("contractRemainingAmount") <> "contractRemainingAmount"))
UNION ALL
SELECT 'nasiya_payment_invalid', COUNT(*)
FROM "NasiyaPayment"
WHERE amount <= 0 OR "paymentMethod" IS NULL
   OR ("appliedAmountInContractCurrency" IS NOT NULL AND "appliedAmountInContractCurrency" <= 0)
   OR (("paymentInputAmount" IS NULL) <> ("paymentInputCurrency" IS NULL))
   OR ("paymentInputCurrency" = 'UZS'::"CurrencyCode" AND
       trunc("paymentInputAmount") <> "paymentInputAmount")
   OR ("paymentExchangeRate" IS NOT NULL AND "paymentExchangeRate" NOT BETWEEN 1000 AND 100000)
UNION ALL
SELECT 'nasiya_payment_cross_contract_schedule', COUNT(*)
FROM "NasiyaPayment" p
JOIN "NasiyaSchedule" s ON s.id = p."nasiyaScheduleId"
WHERE p."nasiyaScheduleId" IS NOT NULL
  AND (p."nasiyaId" <> s."nasiyaId" OR p."shopId" <> s."shopId")
UNION ALL
SELECT 'supplier_payable_invalid', COUNT(*)
FROM "SupplierPayable" p
JOIN "Sale" s ON s.id = p."saleId"
WHERE p.amount <= 0 OR p."contractAmount" <= 0
   OR p."deviceId" <> s."deviceId" OR p."shopId" <> s."shopId"
   OR (p.status = 'PAID'::"SupplierPayableStatus" AND
       (p."paidAt" IS NULL OR p."paymentMethod" IS NULL))
   OR (p.status <> 'PAID'::"SupplierPayableStatus" AND
       (p."paidAt" IS NOT NULL OR p."paymentMethod" IS NOT NULL))
   OR (p."contractCurrency" = 'UZS'::"CurrencyCode" AND
       (trunc(p."contractAmount") <> p."contractAmount"
        OR p."contractExchangeRateAtCreation" IS NOT NULL))
   OR (p."contractCurrency" = 'USD'::"CurrencyCode" AND
       p."contractExchangeRateAtCreation" NOT BETWEEN 1000 AND 100000)
ORDER BY check_name;

\echo '== notification delivery health (counts only) =='
SELECT status,
       COUNT(*) AS row_count,
       COUNT(*) FILTER (WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '90 days') AS older_than_90_days,
       COUNT(*) FILTER (WHERE status = 'FAILED'::"NotificationStatus"
                         AND "nextAttemptAt" <= CURRENT_TIMESTAMP) AS retry_due_now
FROM "Notification"
GROUP BY status
ORDER BY status;

ROLLBACK;
