import process from 'node:process'

import pg from 'pg'

const RELEASE_MIGRATIONS = [
  '202607130001_immutable_return_ledger',
  '202607130002_financial_invariants',
  '202607130003_auth_sessions',
  '202607130004_reminder_generation_watermark',
  '202607130005_telegram_identity_integrity',
  '202607130006_request_audit_context',
  '202607130007_erp2_access_packages',
  '202607130008_nasiya_resolution_deferral',
  '202607130009_erp2_session_rbac_hardening',
  '202607130010_customer_crm_passport',
  '202607150001_staff_permissions_v2',
  '202607150002_nasiya_archive_permission_bundle',
  '202607150003_monthly_profit_recognition',
  '202607150004_complete_accounting_redesign',
  '202607150005_reset_super_admin_subscription_reporting',
  '202607150006_ops_alert_acknowledgement',
]

const phaseArgument = process.argv.find((argument) => argument.startsWith('--phase='))
const phase = phaseArgument?.slice('--phase='.length) ?? 'pre'

if (!['pre', 'post'].includes(phase)) {
  throw new Error('Release preflight phase must be "pre" or "post"')
}

const rawDatabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!rawDatabaseUrl) {
  throw new Error('DIRECT_URL or DATABASE_URL is required for the production release preflight')
}

const databaseUrl = new URL(rawDatabaseUrl)
databaseUrl.searchParams.delete('schema')

const client = new pg.Client({ connectionString: databaseUrl.toString() })

const countChecks = [
  {
    name: 'super_admin_valid_duplicate_groups',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM (
        SELECT "telegramId"
        FROM "SuperAdmin"
        WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$'
        GROUP BY "telegramId"
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  },
  {
    name: 'shop_admin_valid_duplicate_groups',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM (
        SELECT "telegramId"
        FROM "ShopAdmin"
        WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$'
        GROUP BY "telegramId"
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  },
  {
    name: 'cross_role_valid_duplicate_ids',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM (
        SELECT DISTINCT sa."telegramId"
        FROM "SuperAdmin" sa
        JOIN "ShopAdmin" sha ON sha."telegramId" = sa."telegramId"
        WHERE sa."deletedAt" IS NULL
          AND sha."deletedAt" IS NULL
          AND sa."telegramId" ~ '^[0-9]{5,20}$'
      ) duplicates
    `,
  },
  {
    name: 'invalid_live_telegram_ids',
    blocking: false,
    sql: `
      SELECT (
        (SELECT COUNT(*) FROM "SuperAdmin"
         WHERE "deletedAt" IS NULL AND "telegramId" IS NOT NULL
           AND "telegramId" !~ '^[0-9]{5,20}$')
        +
        (SELECT COUNT(*) FROM "ShopAdmin"
         WHERE "deletedAt" IS NULL AND "telegramId" IS NOT NULL
           AND "telegramId" !~ '^[0-9]{5,20}$')
      )::integer AS count
    `,
  },
  {
    name: 'legacy_return_rows',
    blocking: false,
    sql: 'SELECT COUNT(*)::integer AS count FROM "DeviceReturn"',
  },
  {
    name: 'legacy_return_link_violations',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "DeviceReturn" r
      LEFT JOIN "Sale" s ON s.id = r."saleId"
      LEFT JOIN "Nasiya" n ON n.id = r."nasiyaId"
      WHERE num_nonnulls(r."saleId", r."nasiyaId") <> 1
         OR (s.id IS NOT NULL AND (s."deviceId" <> r."deviceId" OR s."shopId" <> r."shopId"))
         OR (n.id IS NOT NULL AND (n."deviceId" <> r."deviceId" OR n."shopId" <> r."shopId"))
    `,
  },
  {
    name: 'invalid_currency_rates',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "CurrencyRate"
      WHERE "baseCurrency" <> 'USD'::"CurrencyCode"
         OR "quoteCurrency" <> 'UZS'::"CurrencyCode"
         OR rate NOT BETWEEN 1000 AND 100000
    `,
  },
  {
    name: 'sale_contract_reconciliation_issues',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Sale"
      WHERE "contractSalePrice" <= 0
         OR "contractAmountPaid" < 0
         OR "contractRemainingAmount" < 0
         OR "contractSalePrice" <> "contractAmountPaid" + "contractRemainingAmount"
         OR "paidFully" <> ("contractRemainingAmount" = 0)
    `,
  },
  {
    name: 'nasiya_contract_reconciliation_issues',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Nasiya"
      WHERE "contractTotalAmount" <= 0
         OR "contractDownPayment" < 0
         OR "contractBaseRemainingAmount" < 0
         OR "contractInterestAmount" < 0
         OR "contractFinalAmount" <= 0
         OR "contractPaidAmount" < 0
         OR "contractRemainingAmount" < 0
         OR "contractBaseRemainingAmount" <> "contractTotalAmount" - "contractDownPayment"
         OR "contractFinalAmount" <> "contractBaseRemainingAmount" + "contractInterestAmount"
         OR "contractPaidAmount" + "contractRemainingAmount" <> "contractFinalAmount"
         OR (status <> 'CANCELLED'::"NasiyaStatus"
             AND (status = 'COMPLETED'::"NasiyaStatus") <> ("contractRemainingAmount" = 0))
    `,
  },
  {
    name: 'nasiya_schedule_reconciliation_issues',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "NasiyaSchedule"
      WHERE "contractExpectedAmount" <= 0
         OR "contractPaidAmount" < 0
         OR "contractPaidAmount" > "contractExpectedAmount"
         OR "contractRemainingAmount" <> "contractExpectedAmount" - "contractPaidAmount"
         OR (status = 'PAID'::"NasiyaScheduleStatus") <> ("contractRemainingAmount" = 0)
    `,
  },
  {
    name: 'cross_contract_schedule_payments',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "NasiyaPayment" p
      JOIN "NasiyaSchedule" s ON s.id = p."nasiyaScheduleId"
      WHERE p."nasiyaScheduleId" IS NOT NULL
        AND (p."nasiyaId" <> s."nasiyaId" OR p."shopId" <> s."shopId")
    `,
  },
  {
    name: 'supplier_payable_state_or_link_issues',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "SupplierPayable" p
      JOIN "Sale" s ON s.id = p."saleId"
      WHERE p."deviceId" <> s."deviceId"
         OR p."shopId" <> s."shopId"
         OR (p.status = 'PAID'::"SupplierPayableStatus"
             AND (p."paidAt" IS NULL OR p."paymentMethod" IS NULL))
         OR (p.status <> 'PAID'::"SupplierPayableStatus"
             AND (p."paidAt" IS NOT NULL OR p."paymentMethod" IS NOT NULL))
    `,
  },
]

const erp2Checks = [
  {
    name: 'duplicate_package_effective_dates',
    blocking: true,
    requiredTables: ['ShopPackageVersion'],
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM (
        SELECT "shopId", "effectiveOn"
        FROM "ShopPackageVersion"
        GROUP BY "shopId", "effectiveOn"
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  },
  {
    name: 'permission_grantor_cross_tenant_violations',
    blocking: true,
    requiredTables: ['ShopMemberPermission', 'ShopAdmin'],
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "ShopMemberPermission" permission
      LEFT JOIN "ShopAdmin" grantor
        ON grantor."id" = permission."grantedById"
       AND grantor."shopId" = permission."shopId"
      WHERE grantor."id" IS NULL
    `,
  },
  {
    name: 'incomplete_package_snapshots',
    blocking: true,
    requiredTables: ['ShopPackageVersion', 'ShopPackageFeature', 'FeatureDefinition'],
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "ShopPackageVersion" package
      WHERE (
        SELECT COUNT(*) FROM "ShopPackageFeature" feature_line
        WHERE feature_line."packageVersionId" = package."id"
      ) <> (SELECT COUNT(*) FROM "FeatureDefinition" WHERE "isActive" = TRUE)
    `,
  },
  {
    name: 'unresolved_shop_ownership',
    blocking: false,
    requiredTables: ['Shop'],
    sql: `SELECT COUNT(*)::integer AS count FROM "Shop" WHERE "deletedAt" IS NULL AND "ownershipStatus" <> 'RESOLVED'`,
  },
  {
    name: 'legacy_full_access_members',
    blocking: false,
    requiredTables: ['ShopAdmin'],
    sql: `SELECT COUNT(*)::integer AS count FROM "ShopAdmin" WHERE "deletedAt" IS NULL AND "legacyFullAccess" = TRUE`,
  },
  {
    name: 'package_pricing_review_required',
    blocking: false,
    requiredTables: ['ShopPackageVersion'],
    sql: `SELECT COUNT(*)::integer AS count FROM "ShopPackageVersion" WHERE "pricingNeedsReview" = TRUE`,
  },
]

const postMigrationChecks = [
  {
    name: 'pending_subscription_payment_currency_reconstruction',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "ShopPayment"
      WHERE "currencyReconstructionStatus" = 'PENDING'
    `,
  },
  {
    name: 'subscription_payment_currency_review_gaps',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "ShopPayment"
      WHERE "currencyReconstructionStatus" IN ('PARTIAL', 'UNRECONSTRUCTABLE')
    `,
  },
  {
    name: 'subscription_payment_native_snapshot_issues',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "ShopPayment"
      WHERE ("currency" = 'UZS' AND "amountUzsSnapshot" IS NULL)
         OR ("currency" = 'USD' AND "amountUsdSnapshot" IS NULL)
    `,
  },
  {
    name: 'active_legacy_write_off_permission',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "PermissionDefinition"
      WHERE "code" = 'NASIYA_WRITE_OFF' AND "isActive" = TRUE
    `,
  },
  {
    name: 'pending_payment_profit_reconstruction',
    blocking: true,
    sql: `
      SELECT (
        (SELECT COUNT(*) FROM "Sale" WHERE "accountingReconstructionStatus" = 'PENDING')
        +
        (SELECT COUNT(*) FROM "Nasiya" WHERE "accountingReconstructionStatus" = 'PENDING')
      )::integer AS count
    `,
  },
  {
    name: 'payment_profit_reconstruction_review_gaps',
    blocking: false,
    sql: `
      SELECT (
        (SELECT COUNT(*) FROM "Sale" WHERE "accountingReconstructionStatus" IN ('PARTIAL', 'UNRECONSTRUCTABLE'))
        +
        (SELECT COUNT(*) FROM "Nasiya" WHERE "accountingReconstructionStatus" IN ('PARTIAL', 'UNRECONSTRUCTABLE'))
      )::integer AS count
    `,
  },
  {
    name: 'reconstructed_sale_component_issues',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Sale"
      WHERE "accountingReconstructionStatus" IN ('COMPLETE', 'PARTIAL')
        AND (
          "contractCostBasisAmount" + "contractMarginAmount" <> "contractSalePrice"
          OR "contractPrincipalPaidAmount" + "contractMarginPaidAmount" <> "contractAmountPaid"
        )
    `,
  },
  {
    name: 'reconstructed_nasiya_component_issues',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Nasiya" n
      WHERE n."accountingReconstructionStatus" IN ('COMPLETE', 'PARTIAL')
        AND (
          n."contractCostBasisAmount" + n."contractMarginAmount" <> n."contractTotalAmount"
          OR n."contractDownPaymentPrincipalAmount" + n."contractDownPaymentMarginAmount" <> n."contractDownPayment"
          OR EXISTS (
            SELECT 1 FROM "NasiyaSchedule" s
            WHERE s."nasiyaId" = n.id
              AND (
                s."contractPrincipalAmount" + s."contractMarginAmount" + s."contractInterestAmount" <> s."contractExpectedAmount"
                OR s."contractPrincipalPaidAmount" + s."contractMarginPaidAmount" + s."contractInterestPaidAmount" <> s."contractPaidAmount"
              )
          )
        )
    `,
  },
  {
    name: 'payment_allocation_component_issues',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "NasiyaPaymentAllocation"
      WHERE "contractPrincipalAmount" + "contractMarginAmount" + "contractInterestAmount" <> "contractAmount"
         OR "principalAmountUzs" + "marginAmountUzs" + "interestAmountUzs" <> "amountUzs"
    `,
  },
  {
    name: 'complete_nasiya_payments_without_allocations',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM (
        SELECT p.id
        FROM "NasiyaPayment" p
        JOIN "Nasiya" n ON n.id = p."nasiyaId" AND n."shopId" = p."shopId"
        LEFT JOIN "NasiyaPaymentAllocation" a ON a."nasiyaPaymentId" = p.id
        WHERE p."deletedAt" IS NULL
          AND n."accountingReconstructionStatus" = 'COMPLETE'
        GROUP BY p.id
        HAVING COUNT(a.id) = 0
      ) gaps
    `,
  },
  {
    name: 'complete_returns_without_profit_reversal',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "DeviceReturn" r
      LEFT JOIN "Sale" s ON s.id = r."saleId"
      LEFT JOIN "Nasiya" n ON n.id = r."nasiyaId"
      LEFT JOIN "ReturnProfitReversal" pr ON pr."deviceReturnId" = r.id
      WHERE coalesce(s."accountingReconstructionStatus", n."accountingReconstructionStatus") = 'COMPLETE'
        AND pr.id IS NULL
    `,
  },
  {
    name: 'shop_sessions_without_package_binding',
    blocking: true,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "AuthSession"
      WHERE "actorType" = 'SHOP_ADMIN' AND "revokedAt" IS NULL AND "packageVersionId" IS NULL
    `,
  },
  {
    name: 'pending_notifications_without_intended_recipient',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Notification"
      WHERE status IN ('PENDING', 'FAILED', 'PROCESSING') AND "recipientShopAdminId" IS NULL
    `,
  },
  {
    name: 'pending_notification_recipient_identity_mismatch',
    blocking: false,
    sql: `
      SELECT COUNT(*)::integer AS count
      FROM "Notification" notification
      JOIN "ShopAdmin" recipient
        ON recipient.id = notification."recipientShopAdminId"
       AND recipient."shopId" = notification."shopId"
      WHERE notification.status IN ('PENDING', 'FAILED', 'PROCESSING')
        AND recipient."telegramId" IS DISTINCT FROM notification."telegramId"
    `,
  },
]

function logSummary(summary) {
  // Count-only output is safe to retain in deployment logs. Never add entity
  // identifiers, Telegram IDs, customer data, or connection details here.
  console.log(`[production-release-preflight] ${JSON.stringify(summary)}`)
}

try {
  await client.connect()
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await client.query("SET LOCAL statement_timeout = '30000ms'")
  await client.query("SET LOCAL lock_timeout = '5000ms'")

  const migrationResult = await client.query(
    `
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
        AND "migration_name" = ANY($1::text[])
      ORDER BY "migration_name"
    `,
    [RELEASE_MIGRATIONS],
  )

  const tableResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
  `)
  const availableTables = new Set(tableResult.rows.map((row) => row.table_name))
  const appliedMigrationSet = new Set(migrationResult.rows.map((row) => row.migration_name))

  const checks = []

  const applicableErp2Checks = erp2Checks.filter((check) =>
    appliedMigrationSet.has('202607130007_erp2_access_packages') &&
    check.requiredTables.every((table) => availableTables.has(table)),
  )
  const applicableChecks = [
    ...countChecks,
    ...applicableErp2Checks,
    ...(phase === 'post' && appliedMigrationSet.has('202607130009_erp2_session_rbac_hardening')
      ? postMigrationChecks
      : []),
  ]
  for (const check of applicableChecks) {
    const result = await client.query(check.sql)
    checks.push({
      name: check.name,
      blocking: check.blocking,
      count: Number(result.rows[0]?.count ?? 0),
    })
  }

  await client.query('ROLLBACK')

  const blockingIssueCount = checks
    .filter((check) => check.blocking)
    .reduce((sum, check) => sum + check.count, 0)
  const historicReviewCount = checks
    .filter((check) => !check.blocking)
    .reduce((sum, check) => sum + check.count, 0)
  const appliedMigrations = migrationResult.rows.map((row) => row.migration_name)

  const summary = {
    phase,
    appliedReleaseMigrations: appliedMigrations.length,
    requiredReleaseMigrations: RELEASE_MIGRATIONS.length,
    blockingIssueCount,
    historicReviewCount,
    checks,
  }

  logSummary(summary)

  if (blockingIssueCount > 0) {
    throw new Error('Production release blocked by one or more integrity diagnostics')
  }

  if (phase === 'post' && appliedMigrations.length !== RELEASE_MIGRATIONS.length) {
    throw new Error(
      `Only ${appliedMigrations.length}/${RELEASE_MIGRATIONS.length} release migrations are recorded`,
    )
  }
} catch (error) {
  try {
    await client.query('ROLLBACK')
  } catch {
    // The connection or transaction may already be closed.
  }
  console.error(
    `[production-release-preflight] ${error instanceof Error ? error.message : 'Unknown failure'}`,
  )
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
