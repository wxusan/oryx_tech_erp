-- Oryx ERP 2.0 access/package foundation.
--
-- This is intentionally additive. Existing shop users keep their legacy
-- operational access, existing receipts remain cash-history-only, and every
-- existing feature is enabled in an explicitly unreviewed zero-price package.
-- No historic price or service period is invented from amount/months.

CREATE TYPE "ShopOwnershipStatus" AS ENUM ('RESOLVED', 'UNMATCHED', 'AMBIGUOUS');
CREATE TYPE "ShopPaymentAllocationStatus" AS ENUM ('PACKAGE_ALLOCATED', 'LEGACY_UNALLOCATED');

ALTER TABLE "Shop"
  ADD COLUMN "telegramNotificationsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "authorizationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "billingAnchorDay" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "ownerAdminId" TEXT,
  ADD COLUMN "ownershipStatus" "ShopOwnershipStatus" NOT NULL DEFAULT 'UNMATCHED',
  ADD COLUMN "ownershipResolvedAt" TIMESTAMP(3),
  ADD COLUMN "ownershipResolvedById" TEXT;

ALTER TABLE "ShopAdmin"
  ADD COLUMN "permissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "legacyFullAccess" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "telegramNotificationsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;

-- New members never inherit the temporary legacy compatibility capability.
ALTER TABLE "ShopAdmin" ALTER COLUMN "legacyFullAccess" SET DEFAULT FALSE;

ALTER TABLE "ShopPayment"
  ADD COLUMN "commandHash" TEXT,
  ADD COLUMN "allocationStatus" "ShopPaymentAllocationStatus" NOT NULL DEFAULT 'LEGACY_UNALLOCATED',
  ADD COLUMN "currency" "CurrencyCode",
  ADD COLUMN "packageVersionId" TEXT,
  ADD COLUMN "packageMonthlyPriceSnapshot" DECIMAL(12,2),
  ADD COLUMN "servicePeriodStart" DATE,
  ADD COLUMN "servicePeriodEnd" DATE,
  ADD COLUMN "dueBefore" TIMESTAMP(3),
  ADD COLUMN "dueAfter" TIMESTAMP(3);

-- The compatibility default remains LEGACY_UNALLOCATED during the additive
-- rollout. The reviewed package-payment command writes PACKAGE_ALLOCATED
-- explicitly; historic and legacy fallback writers can never fabricate a
-- package price or service period accidentally.

CREATE TABLE "FeatureDefinition" (
  "code" TEXT NOT NULL,
  "nameUz" TEXT NOT NULL,
  "descriptionUz" TEXT,
  "billable" BOOLEAN NOT NULL DEFAULT TRUE,
  "platformCore" BOOLEAN NOT NULL DEFAULT FALSE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureDefinition_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "PermissionDefinition" (
  "code" TEXT NOT NULL,
  "nameUz" TEXT NOT NULL,
  "descriptionUz" TEXT,
  "featureCode" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PermissionDefinition_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "ShopPackageVersion" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "effectiveOn" DATE NOT NULL,
  "basePrice" DECIMAL(12,2) NOT NULL,
  "currency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pricingNeedsReview" BOOLEAN NOT NULL DEFAULT FALSE,
  "note" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopPackageVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopPackageFeature" (
  "id" TEXT NOT NULL,
  "packageVersionId" TEXT NOT NULL,
  "featureCode" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "recurringPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT "ShopPackageFeature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopMemberPermission" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopAdminId" TEXT NOT NULL,
  "permissionCode" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedById" TEXT NOT NULL,
  CONSTRAINT "ShopMemberPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_ownerAdminId_key" ON "Shop"("ownerAdminId");
CREATE UNIQUE INDEX "Shop_ownerAdminId_id_key" ON "Shop"("ownerAdminId", "id");
CREATE UNIQUE INDEX "ShopAdmin_id_shopId_key" ON "ShopAdmin"("id", "shopId");
CREATE UNIQUE INDEX "ShopPackageVersion_id_shopId_key"
  ON "ShopPackageVersion"("id", "shopId");
CREATE INDEX "ShopPackageVersion_shopId_effectiveOn_createdAt_idx"
  ON "ShopPackageVersion"("shopId", "effectiveOn" DESC, "createdAt" DESC);
CREATE UNIQUE INDEX "ShopPackageFeature_packageVersionId_featureCode_key"
  ON "ShopPackageFeature"("packageVersionId", "featureCode");
CREATE INDEX "ShopPackageFeature_featureCode_idx" ON "ShopPackageFeature"("featureCode");
CREATE INDEX "PermissionDefinition_featureCode_idx" ON "PermissionDefinition"("featureCode");
CREATE UNIQUE INDEX "ShopMemberPermission_shopAdminId_permissionCode_key"
  ON "ShopMemberPermission"("shopAdminId", "permissionCode");
CREATE INDEX "ShopMemberPermission_shopId_permissionCode_idx"
  ON "ShopMemberPermission"("shopId", "permissionCode");
CREATE INDEX "ShopPayment_packageVersionId_shopId_idx"
  ON "ShopPayment"("packageVersionId", "shopId");

ALTER TABLE "Shop"
  ADD CONSTRAINT "Shop_ownershipResolvedById_fkey"
  FOREIGN KEY ("ownershipResolvedById") REFERENCES "SuperAdmin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shop"
  ADD CONSTRAINT "Shop_ownerAdminId_id_fkey"
  FOREIGN KEY ("ownerAdminId", "id") REFERENCES "ShopAdmin"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermissionDefinition"
  ADD CONSTRAINT "PermissionDefinition_featureCode_fkey"
  FOREIGN KEY ("featureCode") REFERENCES "FeatureDefinition"("code")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShopPackageVersion"
  ADD CONSTRAINT "ShopPackageVersion_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopPackageVersion"
  ADD CONSTRAINT "ShopPackageVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "SuperAdmin"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopPackageFeature"
  ADD CONSTRAINT "ShopPackageFeature_packageVersionId_fkey"
  FOREIGN KEY ("packageVersionId") REFERENCES "ShopPackageVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopPackageFeature"
  ADD CONSTRAINT "ShopPackageFeature_featureCode_fkey"
  FOREIGN KEY ("featureCode") REFERENCES "FeatureDefinition"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopMemberPermission"
  ADD CONSTRAINT "ShopMemberPermission_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopMemberPermission"
  ADD CONSTRAINT "ShopMemberPermission_shopAdminId_shopId_fkey"
  FOREIGN KEY ("shopAdminId", "shopId") REFERENCES "ShopAdmin"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopMemberPermission"
  ADD CONSTRAINT "ShopMemberPermission_permissionCode_fkey"
  FOREIGN KEY ("permissionCode") REFERENCES "PermissionDefinition"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_packageVersionId_shopId_fkey"
  FOREIGN KEY ("packageVersionId", "shopId") REFERENCES "ShopPackageVersion"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FeatureDefinition"
  ("code", "nameUz", "descriptionUz", "billable", "platformCore", "sortOrder")
VALUES
  ('INVENTORY', 'Qurilmalar va ombor', 'Qurilma kiritish, tahrirlash va ombor holati', TRUE, FALSE, 10),
  ('CASH_SALES', 'Naqd savdo va Qarz', 'Naqd, aralash va keyinroq to''lanadigan sodda savdolar', TRUE, FALSE, 20),
  ('NASIYA', 'Nasiya', 'Nasiya shartnomalari, jadvallar va to''lovlar', TRUE, FALSE, 30),
  ('OLIB_SOTDIM', 'Olib-sotdim', 'Boshqa do''kondan olib mijozga sotish', TRUE, FALSE, 40),
  ('CUSTOMER_CRM', 'Mijozlar va ishonch', 'Mijoz profili, tarix va ishonch ko''rsatkichlari', TRUE, FALSE, 50),
  ('TELEGRAM', 'Telegram', 'Telegram bildirishnomalari', TRUE, FALSE, 60),
  ('REMINDERS', 'Eslatmalar', 'To''lov va muddat eslatmalari', TRUE, FALSE, 70),
  ('REPORTS', 'Hisobotlar', 'Moliyaviy va operatsion hisobotlar', TRUE, FALSE, 80),
  ('IMPORTS', 'Import', 'Eski ma''lumotlarni boshqariladigan import qilish', TRUE, FALSE, 90),
  ('EXPORTS', 'Eksport', 'CSV/XLSX ma''lumot eksportlari', TRUE, FALSE, 100),
  ('STAFF_ACCESS', 'Xodimlar profili', 'Do''kon egasidan tashqari xodim profillari', FALSE, FALSE, 110)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder")
VALUES
  ('INVENTORY_VIEW', 'Omborni ko''rish', NULL, 'INVENTORY', 10),
  ('INVENTORY_MANAGE', 'Omborni boshqarish', NULL, 'INVENTORY', 20),
  ('CASH_SALE_CREATE', 'Naqd savdo qilish', NULL, 'CASH_SALES', 30),
  ('CASH_SALE_MANAGE', 'Sotuv ma''lumotlarini boshqarish', NULL, 'CASH_SALES', 32),
  ('NASIYA_VIEW', 'Nasiyalarni ko''rish', NULL, 'NASIYA', 35),
  ('NASIYA_CREATE', 'Nasiya yaratish', NULL, 'NASIYA', 40),
  ('NASIYA_MANAGE', 'Nasiya ma''lumotlarini boshqarish', NULL, 'NASIYA', 41),
  ('OLIB_VIEW', 'Olib-sotdimni ko''rish', NULL, 'OLIB_SOTDIM', 42),
  ('OLIB_MANAGE', 'Olib-sotdim qilish', NULL, 'OLIB_SOTDIM', 45),
  ('PAYMENT_RECEIVE', 'To''lov qabul qilish', NULL, NULL, 50),
  ('CUSTOMER_VIEW', 'Mijozlarni ko''rish', NULL, 'CUSTOMER_CRM', 60),
  ('CUSTOMER_MANAGE', 'Mijozlarni boshqarish', NULL, 'CUSTOMER_CRM', 70),
  ('RETURN_MANAGE', 'Qaytarishni boshqarish', NULL, 'INVENTORY', 80),
  ('WRITEOFF_MANAGE', 'Qarzni yopish va arxivlash', NULL, 'NASIYA', 90),
  ('REPORT_VIEW', 'Hisobotlarni ko''rish', NULL, 'REPORTS', 100),
  ('EXPORT_DATA', 'Eksport qilish', NULL, 'EXPORTS', 110),
  ('IMPORT_DATA', 'Import qilish', NULL, 'IMPORTS', 120),
  ('LOG_VIEW', 'Loglarni ko''rish', NULL, NULL, 130),
  ('SETTINGS_MANAGE', 'Do''kon sozlamalarini boshqarish', NULL, NULL, 140),
  ('MEMBER_MANAGE', 'Xodimlarni boshqarish', NULL, 'STAFF_ACCESS', 150),
  ('TELEGRAM_MANAGE', 'Telegram sozlamalarini boshqarish', NULL, 'TELEGRAM', 160)
ON CONFLICT ("code") DO NOTHING;

-- Preserve the current subscription billing anchor without guessing a former
-- month-end intent. Every migrated shop is explicitly flagged for pricing
-- review before package-derived receipts are accepted.
UPDATE "Shop"
SET "billingAnchorDay" = EXTRACT(
  DAY FROM ("subscriptionDue" AT TIME ZONE 'Asia/Tashkent')
)::INTEGER;

INSERT INTO "ShopPackageVersion"
  ("id", "shopId", "effectiveOn", "basePrice", "currency", "discountAmount",
   "pricingNeedsReview", "note", "createdById", "createdAt")
SELECT
  'pkg_' || md5(s."id" || ':legacy-baseline'),
  s."id",
  (s."createdAt" AT TIME ZONE 'Asia/Tashkent')::DATE,
  0,
  'UZS',
  0,
  TRUE,
  'Legacy access baseline; recurring price requires explicit super-admin review',
  s."createdById",
  CURRENT_TIMESTAMP
FROM "Shop" s;

INSERT INTO "ShopPackageFeature"
  ("id", "packageVersionId", "featureCode", "enabled", "recurringPrice")
SELECT
  'pkgf_' || md5(p."id" || ':' || f."code"),
  p."id",
  f."code",
  TRUE,
  0
FROM "ShopPackageVersion" p
CROSS JOIN "FeatureDefinition" f;

-- Deterministic owner resolution uses only a unique canonical-phone match.
-- No match and multiple matches stay explicitly unresolved and retain legacy
-- access until the super-admin resolves them through the reviewed workflow.
WITH candidate_counts AS (
  SELECT
    s."id" AS shop_id,
    COUNT(sa."id")::INTEGER AS candidate_count,
    MIN(sa."id") AS candidate_id
  FROM "Shop" s
  LEFT JOIN "ShopAdmin" sa
    ON sa."shopId" = s."id"
   AND sa."deletedAt" IS NULL
   AND sa."isActive" = TRUE
   AND regexp_replace(COALESCE(sa."phone", ''), '[^0-9]', '', 'g') =
       regexp_replace(COALESCE(s."ownerPhone", ''), '[^0-9]', '', 'g')
  GROUP BY s."id"
)
UPDATE "Shop" s
SET
  "ownerAdminId" = CASE WHEN c.candidate_count = 1 THEN c.candidate_id ELSE NULL END,
  "ownershipStatus" = CASE
    WHEN c.candidate_count = 1 THEN 'RESOLVED'::"ShopOwnershipStatus"
    WHEN c.candidate_count > 1 THEN 'AMBIGUOUS'::"ShopOwnershipStatus"
    ELSE 'UNMATCHED'::"ShopOwnershipStatus"
  END,
  "ownershipResolvedAt" = CASE WHEN c.candidate_count = 1 THEN CURRENT_TIMESTAMP ELSE NULL END
FROM candidate_counts c
WHERE s."id" = c.shop_id;

UPDATE "ShopAdmin" sa
SET "legacyFullAccess" = FALSE
FROM "Shop" s
WHERE s."ownerAdminId" = sa."id";

ALTER TABLE "Shop"
  ADD CONSTRAINT "Shop_authorizationVersion_check" CHECK ("authorizationVersion" > 0),
  ADD CONSTRAINT "Shop_billingAnchorDay_check" CHECK ("billingAnchorDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT "Shop_owner_resolution_check" CHECK (
    ("ownershipStatus" = 'RESOLVED' AND "ownerAdminId" IS NOT NULL)
    OR ("ownershipStatus" <> 'RESOLVED' AND "ownerAdminId" IS NULL)
  );
ALTER TABLE "ShopAdmin"
  ADD CONSTRAINT "ShopAdmin_permissionVersion_check" CHECK ("permissionVersion" > 0);
ALTER TABLE "ShopPackageVersion"
  ADD CONSTRAINT "ShopPackageVersion_price_check" CHECK (
    "basePrice" >= 0 AND "discountAmount" >= 0 AND char_length(btrim("note")) >= 5
  );
ALTER TABLE "ShopPackageFeature"
  ADD CONSTRAINT "ShopPackageFeature_price_check" CHECK ("recurringPrice" >= 0),
  ADD CONSTRAINT "ShopPackageFeature_staff_free_check" CHECK (
    "featureCode" <> 'STAFF_ACCESS' OR "recurringPrice" = 0
  );
ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_months_package_check" CHECK ("months" BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT "ShopPayment_package_allocation_check" CHECK (
    (
      "allocationStatus" = 'LEGACY_UNALLOCATED'
      AND "packageVersionId" IS NULL
      AND "currency" IS NULL
      AND "packageMonthlyPriceSnapshot" IS NULL
      AND "servicePeriodStart" IS NULL
      AND "servicePeriodEnd" IS NULL
      AND "dueBefore" IS NULL
      AND "dueAfter" IS NULL
      AND "commandHash" IS NULL
    )
    OR
    (
      "allocationStatus" = 'PACKAGE_ALLOCATED'
      AND "packageVersionId" IS NOT NULL
      AND "currency" IS NOT NULL
      AND "packageMonthlyPriceSnapshot" IS NOT NULL
      AND "servicePeriodStart" IS NOT NULL
      AND "servicePeriodEnd" IS NOT NULL
      AND "dueBefore" IS NOT NULL
      AND "dueAfter" IS NOT NULL
      AND "commandHash" IS NOT NULL
      AND "packageMonthlyPriceSnapshot" >= 0
      AND "servicePeriodStart" < "servicePeriodEnd"
    )
  );

CREATE OR REPLACE FUNCTION "oryx_package_feature_policy"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  feature_billable BOOLEAN;
BEGIN
  SELECT "billable" INTO feature_billable
  FROM "FeatureDefinition"
  WHERE "code" = NEW."featureCode";

  IF feature_billable = FALSE AND NEW."recurringPrice" <> 0 THEN
    RAISE EXCEPTION 'non-billable feature % must have zero recurring price', NEW."featureCode"
      USING ERRCODE = '23514', CONSTRAINT = 'ShopPackageFeature_nonbillable_price_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ShopPackageFeature_policy_guard"
BEFORE INSERT OR UPDATE ON "ShopPackageFeature"
FOR EACH ROW EXECUTE FUNCTION "oryx_package_feature_policy"();

CREATE OR REPLACE FUNCTION "oryx_package_snapshot_complete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  version_id TEXT;
  expected_count INTEGER;
  actual_count INTEGER;
BEGIN
  version_id := NEW."id";
  SELECT COUNT(*) INTO expected_count FROM "FeatureDefinition" WHERE "isActive" = TRUE;
  SELECT COUNT(*) INTO actual_count FROM "ShopPackageFeature" WHERE "packageVersionId" = version_id;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'package version % must contain exactly one line for every active feature', version_id
      USING ERRCODE = '23514', CONSTRAINT = 'ShopPackageVersion_complete_snapshot_check';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "ShopPackageVersion_complete_snapshot_guard"
AFTER INSERT ON "ShopPackageVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "oryx_package_snapshot_complete"();

CREATE OR REPLACE FUNCTION "oryx_immutable_package_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Explicit maintenance escape hatch for the repository's confirmed demo
  -- reset workflow. Normal application transactions never set this local
  -- database flag, so published snapshots remain immutable in production.
  IF TG_OP = 'DELETE'
     AND current_setting('oryx.allow_package_snapshot_delete', TRUE) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published package snapshots are immutable; create a replacement version'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ShopPackageVersion_immutable"
BEFORE UPDATE OR DELETE ON "ShopPackageVersion"
FOR EACH ROW EXECUTE FUNCTION "oryx_immutable_package_snapshot"();
CREATE TRIGGER "ShopPackageFeature_immutable"
BEFORE UPDATE OR DELETE ON "ShopPackageFeature"
FOR EACH ROW EXECUTE FUNCTION "oryx_immutable_package_snapshot"();

CREATE OR REPLACE FUNCTION "oryx_protect_current_shop_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_owner_id TEXT;
BEGIN
  SELECT "ownerAdminId" INTO current_owner_id
  FROM "Shop"
  WHERE "id" = OLD."shopId";

  IF current_owner_id = OLD."id" AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'the current shop owner must be transferred before deactivation or deletion'
      USING ERRCODE = '23514', CONSTRAINT = 'Shop_owner_must_remain_active';
  END IF;

  IF current_owner_id = OLD."id" AND (
    NEW."shopId" <> OLD."shopId"
    OR NEW."isActive" = FALSE
    OR NEW."deletedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the current shop owner must be transferred before deactivation or deletion'
      USING ERRCODE = '23514', CONSTRAINT = 'Shop_owner_must_remain_active';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ShopAdmin_owner_protection"
BEFORE UPDATE OF "shopId", "isActive", "deletedAt" OR DELETE ON "ShopAdmin"
FOR EACH ROW EXECUTE FUNCTION "oryx_protect_current_shop_owner"();

-- Package and member mutations have different authorized cache domains for
-- the affected shop and the super-admin portal. The original ChangeEvent log
-- trigger used one domain for both scopes, so these access-control targets are
-- handled explicitly before the legacy mapping.
CREATE OR REPLACE FUNCTION "oryx_record_change_event_from_log"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_domain TEXT;
    event_operation TEXT;
    event_kind TEXT;
    admin_global BOOLEAN;
BEGIN
    event_operation := CASE
        WHEN NEW."action" IN ('DELETE', 'SOFT_DELETE') THEN 'deleted'
        WHEN NEW."action" IN ('CREATE', 'IMPORT') THEN 'created'
        ELSE 'updated'
    END;
    event_kind := lower(NEW."targetType") || '.' || lower(NEW."action");

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
        WHEN 'SupplierPayable' THEN 'olibSotdim'
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
