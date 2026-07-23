BEGIN;

CREATE TABLE "ShopStaffRole" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
  "presetKey" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopStaffRole_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopStaffRole_kind_check" CHECK ("kind" IN ('BUILT_IN', 'CUSTOM')),
  CONSTRAINT "ShopStaffRole_version_check" CHECK ("version" > 0),
  CONSTRAINT "ShopStaffRole_name_check" CHECK (char_length("name") BETWEEN 2 AND 40),
  CONSTRAINT "ShopStaffRole_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ShopStaffRolePermission" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "permissionCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopStaffRolePermission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopStaffRolePermission_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopStaffRolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "PermissionDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShopStaffRole_id_shopId_key" ON "ShopStaffRole"("id", "shopId");
CREATE UNIQUE INDEX "ShopStaffRole_shopId_presetKey_key" ON "ShopStaffRole"("shopId", "presetKey");
CREATE UNIQUE INDEX "ShopStaffRole_active_name_key" ON "ShopStaffRole"("shopId", "normalizedName") WHERE "isArchived" = false;
CREATE INDEX "ShopStaffRole_shopId_isArchived_createdAt_idx" ON "ShopStaffRole"("shopId", "isArchived", "createdAt");
CREATE INDEX "ShopStaffRole_shopId_normalizedName_idx" ON "ShopStaffRole"("shopId", "normalizedName");
CREATE UNIQUE INDEX "ShopStaffRolePermission_roleId_permissionCode_key" ON "ShopStaffRolePermission"("roleId", "permissionCode");
CREATE INDEX "ShopStaffRolePermission_shopId_permissionCode_idx" ON "ShopStaffRolePermission"("shopId", "permissionCode");
CREATE INDEX "ShopStaffRolePermission_shopId_roleId_idx" ON "ShopStaffRolePermission"("shopId", "roleId");

ALTER TABLE "ShopStaffRolePermission"
  ADD CONSTRAINT "ShopStaffRolePermission_roleId_shopId_fkey"
  FOREIGN KEY ("roleId", "shopId") REFERENCES "ShopStaffRole"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopAdmin" ADD COLUMN "staffRoleId" TEXT;
ALTER TABLE "ShopAdmin" ADD COLUMN "roleVersionApplied" INTEGER;
CREATE INDEX "ShopAdmin_shopId_staffRoleId_idx" ON "ShopAdmin"("shopId", "staffRoleId");
ALTER TABLE "ShopAdmin"
  ADD CONSTRAINT "ShopAdmin_staffRoleId_shopId_fkey"
  FOREIGN KEY ("staffRoleId", "shopId") REFERENCES "ShopStaffRole"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH presets("key", "name", "normalizedName", "description") AS (
  VALUES
    ('CASHIER', 'Kassir', 'kassir', 'Savdo qilish, to''lov qabul qilish va mijoz yaratish'),
    ('WAREHOUSE', 'Omborchi', 'omborchi', 'Omborni ko''rish, qurilma qo''shish va tahrirlash'),
    ('COLLECTOR', 'Nasiya undiruvchi', 'nasiya undiruvchi', 'Qarzdorlikni ko''rish, to''lov olish va eslatmalarni boshqarish'),
    ('CONTROLLER', 'Nazoratchi', 'nazoratchi', 'Operatsion ma''lumotlarni ko''rish va nazorat qilish'),
    ('ACCOUNTANT', 'Hisobchi', 'hisobchi', 'Moliyaviy ko''rsatkichlar, hisobotlar va eksportlar')
)
INSERT INTO "ShopStaffRole" (
  "id", "shopId", "name", "normalizedName", "description", "kind", "presetKey", "isArchived", "version", "createdAt", "updatedAt"
)
SELECT
  'role_' || md5(shop."id" || ':' || presets."key"),
  shop."id",
  presets."name",
  presets."normalizedName",
  presets."description",
  'BUILT_IN',
  presets."key",
  false,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Shop" shop
CROSS JOIN presets
ON CONFLICT ("shopId", "presetKey") DO NOTHING;

WITH preset_permissions("key", "permissionCode") AS (
  VALUES
    ('CASHIER', 'SALE_CREATE'),
    ('CASHIER', 'SALE_PAYMENT_RECEIVE'),
    ('CASHIER', 'RECEIVABLES_VIEW'),
    ('CASHIER', 'CUSTOMER_CREATE'),
    ('WAREHOUSE', 'INVENTORY_VIEW'),
    ('WAREHOUSE', 'DEVICE_CREATE'),
    ('WAREHOUSE', 'DEVICE_EDIT'),
    ('COLLECTOR', 'RECEIVABLES_VIEW'),
    ('COLLECTOR', 'NASIYA_PAYMENT_RECEIVE'),
    ('COLLECTOR', 'NASIYA_DEFER'),
    ('COLLECTOR', 'NASIYA_REMINDER_MANAGE'),
    ('CONTROLLER', 'INVENTORY_VIEW'),
    ('CONTROLLER', 'SALE_VIEW'),
    ('CONTROLLER', 'SALE_EDIT'),
    ('CONTROLLER', 'SALE_REMINDER_MANAGE'),
    ('CONTROLLER', 'NASIYA_VIEW'),
    ('CONTROLLER', 'NASIYA_EDIT'),
    ('CONTROLLER', 'NASIYA_REMINDER_MANAGE'),
    ('CONTROLLER', 'OLIB_VIEW'),
    ('CONTROLLER', 'CUSTOMER_VIEW'),
    ('CONTROLLER', 'DASHBOARD_OPERATIONAL_VIEW'),
    ('ACCOUNTANT', 'DASHBOARD_FINANCIAL_VIEW'),
    ('ACCOUNTANT', 'REPORT_VIEW'),
    ('ACCOUNTANT', 'EXPORT_SALES'),
    ('ACCOUNTANT', 'EXPORT_NASIYA'),
    ('ACCOUNTANT', 'EXPORT_OLIB'),
    ('ACCOUNTANT', 'EXPORT_RETURNS'),
    ('ACCOUNTANT', 'EXPORT_REPORTS')
)
INSERT INTO "ShopStaffRolePermission" ("id", "shopId", "roleId", "permissionCode", "createdAt")
SELECT
  'roleperm_' || md5(role."shopId" || ':' || preset_permissions."key" || ':' || preset_permissions."permissionCode"),
  role."shopId",
  role."id",
  preset_permissions."permissionCode",
  CURRENT_TIMESTAMP
FROM "ShopStaffRole" role
JOIN preset_permissions ON preset_permissions."key" = role."presetKey"
JOIN "PermissionDefinition" permission ON permission."code" = preset_permissions."permissionCode"
WHERE role."kind" = 'BUILT_IN'
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;

-- Backfill only exact permission-set matches. Staff with any extra, missing,
-- retired, or owner-only permission deliberately remain individual.
WITH member_sets AS (
  SELECT
    member."id" AS "memberId",
    member."shopId",
    COALESCE(array_agg(grant_row."permissionCode" ORDER BY grant_row."permissionCode") FILTER (WHERE grant_row."permissionCode" IS NOT NULL), ARRAY[]::TEXT[]) AS "permissionCodes"
  FROM "ShopAdmin" member
  LEFT JOIN "ShopMemberPermission" grant_row ON grant_row."shopAdminId" = member."id"
  JOIN "Shop" shop ON shop."id" = member."shopId"
  WHERE member."deletedAt" IS NULL
    AND member."legacyFullAccess" = false
    AND member."id" <> shop."ownerAdminId"
  GROUP BY member."id", member."shopId"
), role_sets AS (
  SELECT
    role."id" AS "roleId",
    role."shopId",
    role."version",
    array_agg(role_permission."permissionCode" ORDER BY role_permission."permissionCode") AS "permissionCodes"
  FROM "ShopStaffRole" role
  JOIN "ShopStaffRolePermission" role_permission ON role_permission."roleId" = role."id"
  WHERE role."kind" = 'BUILT_IN' AND role."isArchived" = false
  GROUP BY role."id", role."shopId", role."version"
), exact_matches AS (
  SELECT member_sets."memberId", role_sets."roleId", role_sets."version"
  FROM member_sets
  JOIN role_sets
    ON role_sets."shopId" = member_sets."shopId"
   AND role_sets."permissionCodes" = member_sets."permissionCodes"
)
UPDATE "ShopAdmin" member
SET "staffRoleId" = exact_matches."roleId",
    "roleVersionApplied" = exact_matches."version"
FROM exact_matches
WHERE member."id" = exact_matches."memberId";

COMMIT;
