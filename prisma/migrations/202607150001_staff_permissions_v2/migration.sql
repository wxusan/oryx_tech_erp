-- Staff permissions v2 is additive. Existing business data and legacy grants
-- remain intact while active grants are materialized under narrower codes.

BEGIN;

ALTER TABLE "ShopAdmin"
  ALTER COLUMN "telegramNotificationsEnabled" SET DEFAULT FALSE;

INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder", "isActive")
VALUES
  ('DEVICE_CREATE', 'Qurilma qo''shish', 'Yangi qurilma va rasmlarini omborga kiritish', 'INVENTORY', 20, TRUE),
  ('DEVICE_EDIT', 'Qurilmani tahrirlash', 'Mavjud qurilma ma''lumotlarini o''zgartirish', 'INVENTORY', 30, TRUE),
  ('DEVICE_DELETE', 'Sotilmagan qurilmani o''chirish', 'Moliyaviy tarixsiz qurilmani sabab bilan o''chirish', 'INVENTORY', 40, TRUE),
  ('DEVICE_RESTOCK', 'Qurilmani omborga qaytarish', 'Qaytarilgan qurilmani qayta omborga kiritish', 'INVENTORY', 50, TRUE),
  ('SALE_VIEW', 'Sotuvlarni ko''rish', 'Naqd va qarz sotuvlarni ko''rish', 'CASH_SALES', 60, TRUE),
  ('SALE_CREATE', 'Sotuv qilish', 'Qurilmani naqd, aralash yoki qarzga sotish', 'CASH_SALES', 70, TRUE),
  ('SALE_EDIT', 'Sotuvni tahrirlash', 'Sotuvning ruxsat etilgan ma''lumotlarini o''zgartirish', 'CASH_SALES', 80, TRUE),
  ('SALE_PAYMENT_RECEIVE', 'Sotuv to''lovini qabul qilish', 'Qarz sotuv bo''yicha kirim to''lovini yozish', 'CASH_SALES', 90, TRUE),
  ('SALE_REMINDER_MANAGE', 'Sotuv eslatmalarini boshqarish', 'Qarz sotuv eslatmasini boshqarish', 'CASH_SALES', 100, TRUE),
  ('SALE_RETURN_REFUND', 'Sotuvni qaytarish va refund', 'Sotuvni yig''ilgan pul chegarasida qaytarish', 'CASH_SALES', 110, TRUE),
  ('RECEIVABLES_VIEW', 'Muddatli va kechikkan qarzlar', 'Xodimga xavfsiz qarzdorlik navbati', NULL, 120, TRUE),
  ('NASIYA_EDIT', 'Nasiyani tahrirlash', 'Nasiya ruxsat etilgan ma''lumotlarini o''zgartirish', 'NASIYA', 150, TRUE),
  ('NASIYA_PAYMENT_RECEIVE', 'Nasiya to''lovini qabul qilish', 'Nasiya bo''yicha kirim to''lovini yozish', 'NASIYA', 160, TRUE),
  ('NASIYA_DEFER', 'Nasiya to''lovini kechiktirish', 'Bitta jadval sanasini idempotent ko''chirish', 'NASIYA', 170, TRUE),
  ('NASIYA_REMINDER_MANAGE', 'Nasiya eslatmalarini boshqarish', 'Nasiya eslatmasini boshqarish', 'NASIYA', 180, TRUE),
  ('NASIYA_CANCEL', 'Nasiyani bekor qilish', 'Mos nasiyani xavfsiz qaytarish hisobi bilan bekor qilish', 'NASIYA', 190, TRUE),
  ('NASIYA_ARCHIVE', 'Nasiyani arxivlash', 'Mos nasiyani sabab bilan arxivlash', 'NASIYA', 200, TRUE),
  ('NASIYA_WRITE_OFF', 'Nasiya qarzini hisobdan chiqarish', 'Qoldiq qarzni o''zgarmas hodisa bilan yopish', 'NASIYA', 210, TRUE),
  ('NASIYA_REOPEN', 'Nasiyani qayta ochish', 'Arxivlangan yoki yopilgan nasiyani qayta ochish', 'NASIYA', 220, TRUE),
  ('OLIB_CREATE', 'Olib-sotdim qilish', 'Tashqi qurilma, yetkazuvchi va mijoz sotuvini yozish', 'OLIB_SOTDIM', 240, TRUE),
  ('SUPPLIER_PAYMENT_MARK_PAID', 'Yetkazuvchi to''lovini yopish', 'Chiqim yetkazuvchi to''lovini to''langan deb yozish', 'OLIB_SOTDIM', 250, TRUE),
  ('CUSTOMER_CREATE', 'Mijoz qo''shish', 'Alohida mijoz profilini yaratish', 'CUSTOMER_CRM', 270, TRUE),
  ('CUSTOMER_EDIT', 'Mijozni tahrirlash', 'Mijozning asosiy aloqa ma''lumotlarini o''zgartirish', 'CUSTOMER_CRM', 280, TRUE),
  ('CUSTOMER_PASSPORT_PHOTO_VIEW', 'Pasport rasmini ko''rish', 'Yopiq pasport rasmini ko''rish', 'CUSTOMER_CRM', 290, TRUE),
  ('CUSTOMER_PASSPORT_REVEAL', 'Pasport raqamini to''liq ko''rish', 'Pasport raqamini audit bilan ochish', 'CUSTOMER_CRM', 300, TRUE),
  ('CUSTOMER_PASSPORT_MANAGE', 'Pasport ma''lumotlarini boshqarish', 'Pasport raqami yoki rasmini boshqarish', 'CUSTOMER_CRM', 310, TRUE),
  ('CUSTOMER_TRUST_OVERRIDE', 'Mijoz ishonch darajasini o''zgartirish', 'Qo''lda ishonch darajasini boshqarish', 'CUSTOMER_CRM', 320, TRUE),
  ('DASHBOARD_OPERATIONAL_VIEW', 'Operatsion statistikani ko''rish', 'Moliyaviy bo''lmagan ish holati', 'REPORTS', 330, TRUE),
  ('DASHBOARD_FINANCIAL_VIEW', 'Moliyaviy statistikani ko''rish', 'Tushum, foyda, tannarx va refund ko''rsatkichlari', 'REPORTS', 340, TRUE),
  ('IMPORT_CUSTOMERS', 'Mijozlarni import qilish', 'Mijoz ma''lumotlarini boshqariladigan import qilish', 'IMPORTS', 370, TRUE),
  ('IMPORT_OLD_NASIYA', 'Eski nasiyalarni import qilish', 'Oldingi nasiya qoldiqlarini xavfsiz import qilish', 'IMPORTS', 380, TRUE),
  ('EXPORT_DEVICES', 'Qurilmalarni eksport qilish', 'Qurilma eksport faylini olish', 'EXPORTS', 390, TRUE),
  ('EXPORT_CUSTOMERS', 'Mijozlarni eksport qilish', 'Mijoz eksport faylini olish', 'EXPORTS', 400, TRUE),
  ('EXPORT_SALES', 'Sotuvlarni eksport qilish', 'Sotuv eksport faylini olish', 'EXPORTS', 410, TRUE),
  ('EXPORT_NASIYA', 'Nasiyalarni eksport qilish', 'Nasiya eksport faylini olish', 'EXPORTS', 420, TRUE),
  ('EXPORT_OLIB', 'Olib-sotdimni eksport qilish', 'Olib-sotdim eksport faylini olish', 'EXPORTS', 430, TRUE),
  ('EXPORT_RETURNS', 'Qaytarishlarni eksport qilish', 'Qaytarish va refund eksport faylini olish', 'EXPORTS', 440, TRUE),
  ('EXPORT_LOGS', 'Loglarni eksport qilish', 'Audit log eksport faylini olish', 'EXPORTS', 450, TRUE),
  ('EXPORT_REPORTS', 'Hisobotlarni eksport qilish', 'Moliyaviy hisobot eksport faylini olish', 'EXPORTS', 460, TRUE),
  ('STAFF_VIEW', 'Xodimlarni ko''rish', 'Do''kon egasidan tashqari xodimlar ro''yxati', 'STAFF_ACCESS', 470, TRUE),
  ('STAFF_CREATE', 'Xodim qo''shish', 'Yangi xodim profilini ruxsatsiz yaratish', 'STAFF_ACCESS', 480, TRUE),
  ('STAFF_EDIT_PROFILE', 'Xodim ma''lumotlarini tahrirlash', 'Xodim ism va telefonini o''zgartirish', 'STAFF_ACCESS', 490, TRUE),
  ('STAFF_RESET_PASSWORD', 'Xodim parolini tiklash', 'Yangi parol va sessiya bekor qilish', 'STAFF_ACCESS', 500, TRUE),
  ('STAFF_STATUS_MANAGE', 'Xodim holatini boshqarish', 'Xodimni faollashtirish yoki bloklash', 'STAFF_ACCESS', 510, TRUE),
  ('STAFF_DELETE', 'Xodimni o''chirish', 'Xodimni sabab bilan yumshoq o''chirish', 'STAFF_ACCESS', 520, TRUE),
  ('STAFF_PERMISSION_MANAGE', 'Xodim ruxsatlarini boshqarish', 'Boshqa xodimga oddiy ruxsatlarni berish', 'STAFF_ACCESS', 530, TRUE),
  ('STAFF_NOTIFICATION_MANAGE', 'Xodim Telegramini boshqarish', 'Xodimning Telegram qabul qilish huquqi', 'STAFF_ACCESS', 540, TRUE),
  ('SHOP_PROFILE_EDIT', 'Do''kon ma''lumotlarini tahrirlash', 'Do''kon identifikatsiya va aloqa maydonlari', NULL, 550, TRUE),
  ('SHOP_CURRENCY_MANAGE', 'Do''kon valyutasini boshqarish', 'Do''kon ko''rsatish valyutasini o''zgartirish', NULL, 560, TRUE),
  ('SHOP_TELEGRAM_MANAGE', 'Do''kon Telegramini boshqarish', 'Do''kon Telegram master holati', 'TELEGRAM', 570, TRUE)
ON CONFLICT ("code") DO UPDATE SET
  "nameUz" = EXCLUDED."nameUz",
  "descriptionUz" = EXCLUDED."descriptionUz",
  "featureCode" = EXCLUDED."featureCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "PermissionDefinition"
SET "isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'INVENTORY_MANAGE', 'CASH_SALE_CREATE', 'CASH_SALE_MANAGE',
  'NASIYA_MANAGE', 'OLIB_MANAGE', 'PAYMENT_RECEIVE', 'CUSTOMER_MANAGE',
  'CUSTOMER_PII_REVEAL', 'RETURN_MANAGE', 'WRITEOFF_MANAGE',
  'EXPORT_DATA', 'IMPORT_DATA', 'SETTINGS_MANAGE', 'MEMBER_MANAGE',
  'TELEGRAM_MANAGE'
);

CREATE TEMP TABLE "_StaffPermissionsV2Materialized" (
  "shopId" TEXT NOT NULL,
  "shopAdminId" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "newCode" TEXT NOT NULL,
  "clearLegacy" BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY ("shopAdminId", "newCode")
) ON COMMIT DROP;

WITH mapping("oldCode", "newCode") AS (
  VALUES
    ('INVENTORY_VIEW', 'SALE_VIEW'),
    ('INVENTORY_MANAGE', 'DEVICE_CREATE'),
    ('INVENTORY_MANAGE', 'DEVICE_EDIT'),
    ('INVENTORY_MANAGE', 'DEVICE_DELETE'),
    ('CASH_SALE_CREATE', 'SALE_CREATE'),
    ('CASH_SALE_MANAGE', 'SALE_EDIT'),
    ('CASH_SALE_MANAGE', 'SALE_REMINDER_MANAGE'),
    ('NASIYA_MANAGE', 'NASIYA_EDIT'),
    ('NASIYA_MANAGE', 'NASIYA_DEFER'),
    ('NASIYA_MANAGE', 'NASIYA_REMINDER_MANAGE'),
    ('OLIB_MANAGE', 'OLIB_CREATE'),
    ('PAYMENT_RECEIVE', 'SALE_PAYMENT_RECEIVE'),
    ('PAYMENT_RECEIVE', 'NASIYA_PAYMENT_RECEIVE'),
    ('PAYMENT_RECEIVE', 'SUPPLIER_PAYMENT_MARK_PAID'),
    ('CUSTOMER_VIEW', 'CUSTOMER_PASSPORT_PHOTO_VIEW'),
    ('NASIYA_VIEW', 'CUSTOMER_PASSPORT_PHOTO_VIEW'),
    ('CUSTOMER_MANAGE', 'CUSTOMER_CREATE'),
    ('CUSTOMER_MANAGE', 'CUSTOMER_EDIT'),
    ('CUSTOMER_MANAGE', 'CUSTOMER_PASSPORT_MANAGE'),
    ('CUSTOMER_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'),
    ('CUSTOMER_PII_REVEAL', 'CUSTOMER_PASSPORT_REVEAL'),
    ('RETURN_MANAGE', 'SALE_RETURN_REFUND'),
    ('RETURN_MANAGE', 'NASIYA_CANCEL'),
    ('RETURN_MANAGE', 'DEVICE_RESTOCK'),
    ('WRITEOFF_MANAGE', 'NASIYA_ARCHIVE'),
    ('WRITEOFF_MANAGE', 'NASIYA_WRITE_OFF'),
    ('WRITEOFF_MANAGE', 'NASIYA_REOPEN'),
    ('REPORT_VIEW', 'DASHBOARD_FINANCIAL_VIEW'),
    ('EXPORT_DATA', 'EXPORT_DEVICES'),
    ('EXPORT_DATA', 'EXPORT_CUSTOMERS'),
    ('EXPORT_DATA', 'EXPORT_SALES'),
    ('EXPORT_DATA', 'EXPORT_NASIYA'),
    ('EXPORT_DATA', 'EXPORT_OLIB'),
    ('EXPORT_DATA', 'EXPORT_RETURNS'),
    ('EXPORT_DATA', 'EXPORT_LOGS'),
    ('EXPORT_DATA', 'EXPORT_REPORTS'),
    ('IMPORT_DATA', 'IMPORT_CUSTOMERS'),
    ('IMPORT_DATA', 'IMPORT_OLD_NASIYA'),
    ('SETTINGS_MANAGE', 'SHOP_PROFILE_EDIT'),
    ('SETTINGS_MANAGE', 'SHOP_CURRENCY_MANAGE'),
    ('SETTINGS_MANAGE', 'SHOP_TELEGRAM_MANAGE'),
    ('MEMBER_MANAGE', 'STAFF_VIEW'),
    ('MEMBER_MANAGE', 'STAFF_CREATE'),
    ('MEMBER_MANAGE', 'STAFF_EDIT_PROFILE'),
    ('MEMBER_MANAGE', 'STAFF_RESET_PASSWORD'),
    ('MEMBER_MANAGE', 'STAFF_STATUS_MANAGE'),
    ('MEMBER_MANAGE', 'STAFF_DELETE'),
    ('MEMBER_MANAGE', 'STAFF_PERMISSION_MANAGE'),
    ('MEMBER_MANAGE', 'STAFF_NOTIFICATION_MANAGE'),
    ('TELEGRAM_MANAGE', 'SHOP_TELEGRAM_MANAGE')
), candidates AS (
  SELECT DISTINCT
    old."shopId",
    old."shopAdminId",
    old."grantedById",
    old."grantedAt",
    mapping."newCode"
  FROM "ShopMemberPermission" old
  JOIN mapping ON mapping."oldCode" = old."permissionCode"
  JOIN "PermissionDefinition" target ON target."code" = mapping."newCode"
  LEFT JOIN LATERAL (
    SELECT package."id"
    FROM "ShopPackageVersion" package
    WHERE package."shopId" = old."shopId"
      AND package."effectiveOn" <= CURRENT_DATE
    ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
    LIMIT 1
  ) active_package ON TRUE
  LEFT JOIN "ShopPackageFeature" feature_line
    ON feature_line."packageVersionId" = active_package."id"
   AND feature_line."featureCode" = target."featureCode"
  LEFT JOIN "ShopPackageFeature" customer_feature
    ON customer_feature."packageVersionId" = active_package."id"
   AND customer_feature."featureCode" = 'CUSTOMER_CRM'
  LEFT JOIN "ShopPackageFeature" nasiya_feature
    ON nasiya_feature."packageVersionId" = active_package."id"
   AND nasiya_feature."featureCode" = 'NASIYA'
  WHERE (target."featureCode" IS NULL OR feature_line."enabled" = TRUE)
    AND (mapping."newCode" <> 'IMPORT_CUSTOMERS' OR customer_feature."enabled" = TRUE)
    AND (mapping."newCode" <> 'IMPORT_OLD_NASIYA' OR nasiya_feature."enabled" = TRUE)
    AND NOT EXISTS (
      SELECT 1
      FROM "ShopMemberPermission" existing
      WHERE existing."shopAdminId" = old."shopAdminId"
        AND existing."permissionCode" = mapping."newCode"
    )
)
INSERT INTO "_StaffPermissionsV2Materialized"
  ("shopId", "shopAdminId", "grantedById", "grantedAt", "newCode", "clearLegacy")
SELECT
  candidates."shopId",
  candidates."shopAdminId",
  candidates."grantedById",
  candidates."grantedAt",
  candidates."newCode",
  FALSE
FROM candidates
ON CONFLICT ("shopAdminId", "newCode") DO NOTHING;

-- Materialize the exact capabilities that the compatibility flag already
-- represented. This grants no new V2-only powers and lets runtime access stop
-- depending on an implicit broad flag after the one-time migration.
WITH legacy_codes("newCode") AS (
  VALUES
    ('INVENTORY_VIEW'), ('DEVICE_CREATE'), ('DEVICE_EDIT'), ('DEVICE_DELETE'),
    ('SALE_VIEW'), ('SALE_CREATE'), ('SALE_EDIT'), ('SALE_PAYMENT_RECEIVE'),
    ('SALE_REMINDER_MANAGE'), ('NASIYA_VIEW'), ('NASIYA_CREATE'), ('NASIYA_EDIT'),
    ('NASIYA_PAYMENT_RECEIVE'), ('NASIYA_DEFER'), ('NASIYA_REMINDER_MANAGE'),
    ('OLIB_VIEW'), ('OLIB_CREATE'), ('SUPPLIER_PAYMENT_MARK_PAID'),
    ('CUSTOMER_VIEW'), ('CUSTOMER_CREATE'), ('CUSTOMER_EDIT'),
    ('CUSTOMER_PASSPORT_PHOTO_VIEW'), ('CUSTOMER_PASSPORT_MANAGE'),
    ('CUSTOMER_TRUST_OVERRIDE'), ('LOG_VIEW')
), candidates AS (
  SELECT
    member."shopId",
    member."id" AS "shopAdminId",
    shop."ownerAdminId" AS "grantedById",
    CURRENT_TIMESTAMP AS "grantedAt",
    legacy_codes."newCode"
  FROM "ShopAdmin" member
  JOIN "Shop" shop ON shop."id" = member."shopId"
  CROSS JOIN legacy_codes
  JOIN "PermissionDefinition" target ON target."code" = legacy_codes."newCode"
  LEFT JOIN LATERAL (
    SELECT package."id"
    FROM "ShopPackageVersion" package
    WHERE package."shopId" = member."shopId"
      AND package."effectiveOn" <= CURRENT_DATE
    ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
    LIMIT 1
  ) active_package ON TRUE
  LEFT JOIN "ShopPackageFeature" feature_line
    ON feature_line."packageVersionId" = active_package."id"
   AND feature_line."featureCode" = target."featureCode"
  WHERE member."legacyFullAccess" = TRUE
    AND member."deletedAt" IS NULL
    AND shop."ownerAdminId" IS NOT NULL
    AND member."id" <> shop."ownerAdminId"
    AND active_package."id" IS NOT NULL
    AND (target."featureCode" IS NULL OR feature_line."enabled" = TRUE)
)
INSERT INTO "_StaffPermissionsV2Materialized"
  ("shopId", "shopAdminId", "grantedById", "grantedAt", "newCode", "clearLegacy")
SELECT
  candidates."shopId",
  candidates."shopAdminId",
  candidates."grantedById",
  candidates."grantedAt",
  candidates."newCode",
  TRUE
FROM candidates
ON CONFLICT ("shopAdminId", "newCode") DO UPDATE
SET "clearLegacy" = "_StaffPermissionsV2Materialized"."clearLegacy" OR EXCLUDED."clearLegacy";

INSERT INTO "ShopMemberPermission"
  ("id", "shopId", "shopAdminId", "permissionCode", "grantedAt", "grantedById")
SELECT
  'staffpermv2_' || md5(materialized."shopAdminId" || ':' || materialized."newCode"),
  materialized."shopId",
  materialized."shopAdminId",
  materialized."newCode",
  materialized."grantedAt",
  materialized."grantedById"
FROM "_StaffPermissionsV2Materialized" materialized
ON CONFLICT ("shopAdminId", "permissionCode") DO NOTHING;

WITH affected AS (
  SELECT DISTINCT materialized."shopAdminId", materialized."shopId"
  FROM "_StaffPermissionsV2Materialized" materialized
)
UPDATE "ShopAdmin" member
SET
  "permissionVersion" = member."permissionVersion" + 1,
  "sessionVersion" = member."sessionVersion" + 1,
  "legacyFullAccess" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "_StaffPermissionsV2Materialized" materialized
      WHERE materialized."shopAdminId" = member."id"
        AND materialized."clearLegacy" = TRUE
    ) THEN FALSE
    ELSE member."legacyFullAccess"
  END
FROM affected
WHERE member."id" = affected."shopAdminId"
  AND member."shopId" = affected."shopId";

WITH affected AS (
  SELECT DISTINCT materialized."shopAdminId"
  FROM "_StaffPermissionsV2Materialized" materialized
)
UPDATE "AuthSession" session
SET "revokedAt" = CURRENT_TIMESTAMP
FROM affected
WHERE session."actorType" = 'SHOP_ADMIN'
  AND session."actorId" = affected."shopAdminId"
  AND session."revokedAt" IS NULL;

UPDATE "Shop"
SET "authorizationVersion" = "authorizationVersion" + 1
WHERE "id" IN (
  SELECT DISTINCT materialized."shopId"
  FROM "_StaffPermissionsV2Materialized" materialized
);

COMMIT;
