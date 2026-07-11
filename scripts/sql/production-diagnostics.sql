\set ON_ERROR_STOP on
\pset pager off

-- Oryx ERP production/staging diagnostics.
-- This pack is deliberately read-only. PostgreSQL will reject any accidental
-- write after BEGIN ... READ ONLY. Run against a restored staging copy first.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '== database identity (no credentials) =='
SELECT current_database() AS database_name,
       current_user AS database_user,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only;

\echo '== table sizes and live/dead row estimates =='
SELECT relname AS table_name,
       n_live_tup AS estimated_live_rows,
       n_dead_tup AS estimated_dead_rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       pg_size_pretty(pg_relation_size(relid)) AS table_size,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC, relname;

\echo '== index sizes and usage =='
SELECT schemaname,
       relname AS table_name,
       indexrelname AS index_name,
       idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC, relname, indexrelname;

\echo '== SOLD_CASH devices with active simple-sale contract debt =='
SELECT d.id AS device_id, d."shopId", d.model, d.imei,
       s.id AS sale_id, s."contractCurrency", s."contractRemainingAmount"
FROM "Device" d
JOIN "Sale" s ON s."deviceId" = d.id AND s."deletedAt" IS NULL
WHERE d."deletedAt" IS NULL
  AND d.status = 'SOLD_CASH'::"DeviceStatus"
  AND s."contractRemainingAmount" > 0
ORDER BY d."shopId", d.id;

\echo '== SOLD_DEBT devices with no active contract debt =='
SELECT d.id AS device_id, d."shopId", d.model, d.imei,
       s.id AS sale_id, s."contractCurrency", s."contractRemainingAmount"
FROM "Device" d
LEFT JOIN LATERAL (
  SELECT sale.*
  FROM "Sale" sale
  WHERE sale."deviceId" = d.id AND sale."deletedAt" IS NULL
  ORDER BY sale."createdAt" DESC
  LIMIT 1
) s ON true
WHERE d."deletedAt" IS NULL
  AND d.status = 'SOLD_DEBT'::"DeviceStatus"
  AND (s.id IS NULL OR s."contractRemainingAmount" <= 0)
ORDER BY d."shopId", d.id;

\echo '== COMPLETED nasiya with contract or schedule debt =='
SELECT n.id AS nasiya_id,
       n."shopId",
       n."contractCurrency",
       n."contractRemainingAmount" AS parent_remaining,
       COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0) AS schedule_remaining
FROM "Nasiya" n
LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
WHERE n."deletedAt" IS NULL
  AND n.status = 'COMPLETED'::"NasiyaStatus"
GROUP BY n.id, n."shopId", n."contractCurrency", n."contractRemainingAmount"
HAVING n."contractRemainingAmount" > 0
    OR COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0) > 0
ORDER BY n."shopId", n.id;

\echo '== nasiya parent balance versus schedule balance =='
SELECT n.id AS nasiya_id,
       n."shopId",
       n."contractCurrency",
       n."contractRemainingAmount" AS parent_remaining,
       COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0) AS schedule_remaining,
       n."contractRemainingAmount" -
         COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0) AS difference
FROM "Nasiya" n
LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
WHERE n."deletedAt" IS NULL AND n.status <> 'CANCELLED'::"NasiyaStatus"
GROUP BY n.id, n."shopId", n."contractCurrency", n."contractRemainingAmount"
HAVING ABS(
  n."contractRemainingAmount" -
  COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0)
) >= CASE WHEN n."contractCurrency" = 'USD'::"CurrencyCode" THEN 0.01 ELSE 500 END
ORDER BY ABS(
  n."contractRemainingAmount" -
  COALESCE(SUM(GREATEST(s."contractExpectedAmount" - s."contractPaidAmount", 0)), 0)
) DESC;

\echo '== cross-shop relationship mismatches =='
WITH mismatches AS (
  SELECT 'Sale.device' AS relation_name, s.id AS row_id, s."shopId" AS row_shop, d."shopId" AS related_shop
  FROM "Sale" s JOIN "Device" d ON d.id = s."deviceId"
  WHERE s."shopId" <> d."shopId"
  UNION ALL
  SELECT 'Sale.customer', s.id, s."shopId", c."shopId"
  FROM "Sale" s JOIN "Customer" c ON c.id = s."customerId"
  WHERE s."shopId" <> c."shopId"
  UNION ALL
  SELECT 'SalePayment.sale', p.id, p."shopId", s."shopId"
  FROM "SalePayment" p JOIN "Sale" s ON s.id = p."saleId"
  WHERE p."shopId" <> s."shopId"
  UNION ALL
  SELECT 'Nasiya.device', n.id, n."shopId", d."shopId"
  FROM "Nasiya" n JOIN "Device" d ON d.id = n."deviceId"
  WHERE n."shopId" <> d."shopId"
  UNION ALL
  SELECT 'Nasiya.customer', n.id, n."shopId", c."shopId"
  FROM "Nasiya" n JOIN "Customer" c ON c.id = n."customerId"
  WHERE n."shopId" <> c."shopId"
  UNION ALL
  SELECT 'NasiyaSchedule.nasiya', s.id, s."shopId", n."shopId"
  FROM "NasiyaSchedule" s JOIN "Nasiya" n ON n.id = s."nasiyaId"
  WHERE s."shopId" <> n."shopId"
  UNION ALL
  SELECT 'NasiyaPayment.nasiya', p.id, p."shopId", n."shopId"
  FROM "NasiyaPayment" p JOIN "Nasiya" n ON n.id = p."nasiyaId"
  WHERE p."shopId" <> n."shopId"
  UNION ALL
  SELECT 'SupplierPayable.device', p.id, p."shopId", d."shopId"
  FROM "SupplierPayable" p JOIN "Device" d ON d.id = p."deviceId"
  WHERE p."shopId" <> d."shopId"
  UNION ALL
  SELECT 'SupplierPayable.sale', p.id, p."shopId", s."shopId"
  FROM "SupplierPayable" p JOIN "Sale" s ON s.id = p."saleId"
  WHERE p."shopId" <> s."shopId"
  UNION ALL
  SELECT 'DeviceReturn.device', r.id, r."shopId", d."shopId"
  FROM "DeviceReturn" r JOIN "Device" d ON d.id = r."deviceId"
  WHERE r."shopId" <> d."shopId"
)
SELECT * FROM mismatches ORDER BY relation_name, row_id;

\echo '== active duplicate normalized customer phones =='
SELECT "shopId", "normalizedPhone", COUNT(*) AS active_count,
       ARRAY_AGG(id ORDER BY "createdAt", id) AS customer_ids
FROM "Customer"
WHERE "deletedAt" IS NULL AND "normalizedPhone" IS NOT NULL
GROUP BY "shopId", "normalizedPhone"
HAVING COUNT(*) > 1
ORDER BY active_count DESC, "shopId", "normalizedPhone";

\echo '== active customers missing normalized phone =='
SELECT "shopId", COUNT(*) AS missing_normalized_phone
FROM "Customer"
WHERE "deletedAt" IS NULL AND "normalizedPhone" IS NULL
GROUP BY "shopId"
ORDER BY missing_normalized_phone DESC, "shopId";

\echo '== legacy RETURNED inventory with linked financial history =='
SELECT d.id AS device_id, d."shopId", d.model, d.imei, d."updatedAt",
       s.id AS sale_id, s."contractCurrency" AS sale_currency,
       s."contractRemainingAmount" AS sale_remaining,
       n.id AS nasiya_id, n.status AS nasiya_status,
       n."contractCurrency" AS nasiya_currency,
       n."contractRemainingAmount" AS nasiya_remaining,
       COUNT(r.id) AS return_records
FROM "Device" d
LEFT JOIN "Sale" s ON s."deviceId" = d.id
LEFT JOIN "Nasiya" n ON n."deviceId" = d.id
LEFT JOIN "DeviceReturn" r ON r."deviceId" = d.id
WHERE d."deletedAt" IS NULL AND d.status = 'RETURNED'::"DeviceStatus"
GROUP BY d.id, d."shopId", d.model, d.imei, d."updatedAt",
         s.id, s."contractCurrency", s."contractRemainingAmount",
         n.id, n.status, n."contractCurrency", n."contractRemainingAmount"
ORDER BY d."shopId", d.id;

\echo '== payments missing original input metadata =='
SELECT 'SalePayment' AS payment_type,
       COUNT(*) FILTER (WHERE "paymentInputAmount" IS NULL) AS missing_input_amount,
       COUNT(*) FILTER (WHERE "paymentInputCurrency" IS NULL) AS missing_input_currency,
       COUNT(*) FILTER (WHERE "appliedAmountInContractCurrency" IS NULL) AS missing_contract_applied,
       COUNT(*) AS total
FROM "SalePayment" WHERE "deletedAt" IS NULL
UNION ALL
SELECT 'NasiyaPayment',
       COUNT(*) FILTER (WHERE "paymentInputAmount" IS NULL),
       COUNT(*) FILTER (WHERE "paymentInputCurrency" IS NULL),
       COUNT(*) FILTER (WHERE "appliedAmountInContractCurrency" IS NULL),
       COUNT(*)
FROM "NasiyaPayment" WHERE "deletedAt" IS NULL;

\echo '== notification queue health and age =='
SELECT status,
       COUNT(*) AS row_count,
       MIN("createdAt") AS oldest_created_at,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN("createdAt")))::bigint AS oldest_age_seconds
FROM "Notification"
WHERE status IN ('PENDING'::"NotificationStatus", 'PROCESSING'::"NotificationStatus", 'FAILED'::"NotificationStatus")
GROUP BY status
ORDER BY status;

\echo '== active database connections =='
SELECT state, COUNT(*) AS connection_count
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY state;

ROLLBACK;
