-- A single owner checkbox grants both archive and restore. The API enforces
-- each operation separately, but existing staff who could archive must also
-- receive the paired restore capability so the UI and backend never diverge.

BEGIN;

CREATE TEMP TABLE "_NasiyaArchivePermissionBundle" (
  "shopId" TEXT NOT NULL,
  "shopAdminId" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL
) ON COMMIT DROP;

INSERT INTO "_NasiyaArchivePermissionBundle" ("shopId", "shopAdminId", "grantedById", "grantedAt")
SELECT archive_permission."shopId", archive_permission."shopAdminId", archive_permission."grantedById", archive_permission."grantedAt"
FROM "ShopMemberPermission" archive_permission
JOIN "PermissionDefinition" reopen_permission ON reopen_permission."code" = 'NASIYA_REOPEN'
WHERE archive_permission."permissionCode" = 'NASIYA_ARCHIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "ShopMemberPermission" existing
    WHERE existing."shopAdminId" = archive_permission."shopAdminId"
      AND existing."permissionCode" = 'NASIYA_REOPEN'
  );

INSERT INTO "ShopMemberPermission" ("id", "shopId", "shopAdminId", "permissionCode", "grantedAt", "grantedById")
SELECT
  'nasiya-archive-reopen_' || md5(bundle."shopAdminId" || ':NASIYA_REOPEN'),
  bundle."shopId",
  bundle."shopAdminId",
  'NASIYA_REOPEN',
  bundle."grantedAt",
  bundle."grantedById"
FROM "_NasiyaArchivePermissionBundle" bundle
ON CONFLICT ("shopAdminId", "permissionCode") DO NOTHING;

UPDATE "ShopAdmin" member
SET
  "permissionVersion" = member."permissionVersion" + 1,
  "sessionVersion" = member."sessionVersion" + 1
FROM "_NasiyaArchivePermissionBundle" bundle
WHERE member."id" = bundle."shopAdminId"
  AND member."shopId" = bundle."shopId";

UPDATE "AuthSession" session
SET "revokedAt" = CURRENT_TIMESTAMP
FROM "_NasiyaArchivePermissionBundle" bundle
WHERE session."actorType" = 'SHOP_ADMIN'
  AND session."actorId" = bundle."shopAdminId"
  AND session."revokedAt" IS NULL;

UPDATE "Shop"
SET "authorizationVersion" = "authorizationVersion" + 1
WHERE "id" IN (
  SELECT DISTINCT "shopId"
  FROM "_NasiyaArchivePermissionBundle"
);

COMMIT;
