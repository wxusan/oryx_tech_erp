-- ERP 2.0 session, RBAC, package-snapshot, and notification-recipient hardening.
-- Additive only: historic sessions and notification rows are retained, while
-- every newly created record is held to the stricter policy.

CREATE TYPE "AuthSessionPolicy" AS ENUM ('IDLE_10_MINUTES', 'REMEMBERED_30_DAYS');

ALTER TABLE "AuthSession"
  ADD COLUMN "packageVersionId" TEXT,
  ADD COLUMN "policy" "AuthSessionPolicy",
  ADD COLUMN "lastUserActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "AuthSession"
SET
  "policy" = CASE
    WHEN "actorType" = 'SUPER_ADMIN' THEN 'IDLE_10_MINUTES'::"AuthSessionPolicy"
    ELSE 'REMEMBERED_30_DAYS'::"AuthSessionPolicy"
  END,
  "lastUserActivityAt" = "lastSeenAt";

-- Existing shop sessions are bound to the package active on the migration
-- business date. A future package automatically invalidates that binding on
-- the first protected request after it becomes effective.
UPDATE "AuthSession" session
SET "packageVersionId" = (
  SELECT package."id"
  FROM "ShopPackageVersion" package
  WHERE package."shopId" = session."shopId"
    AND package."effectiveOn" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tashkent')::DATE
  ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
  LIMIT 1
)
WHERE session."actorType" = 'SHOP_ADMIN';

ALTER TABLE "AuthSession"
  ALTER COLUMN "policy" SET DEFAULT 'IDLE_10_MINUTES',
  ALTER COLUMN "policy" SET NOT NULL;

CREATE UNIQUE INDEX "ShopPackageVersion_shopId_effectiveOn_key"
  ON "ShopPackageVersion"("shopId", "effectiveOn");
CREATE INDEX "AuthSession_packageVersionId_shopId_idx"
  ON "AuthSession"("packageVersionId", "shopId");
CREATE INDEX "AuthSession_revokedAt_lastUserActivityAt_idx"
  ON "AuthSession"("revokedAt", "lastUserActivityAt");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_packageVersionId_shopId_fkey"
  FOREIGN KEY ("packageVersionId", "shopId") REFERENCES "ShopPackageVersion"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The grantor must be a member of the same shop as the permission recipient.
-- Deployment intentionally fails here if historic data violates tenant
-- integrity; the production preflight reports the exact count beforehand.
ALTER TABLE "ShopMemberPermission"
  ADD CONSTRAINT "ShopMemberPermission_grantedById_shopId_fkey"
  FOREIGN KEY ("grantedById", "shopId") REFERENCES "ShopAdmin"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN "recipientShopAdminId" TEXT;

-- Bind legacy rows only when the current Telegram identity has one unambiguous
-- member inside the same tenant. Unmatched/ambiguous history remains nullable
-- and is handled by the legacy delivery path without guessing an owner.
UPDATE "Notification" notification
SET "recipientShopAdminId" = candidate."id"
FROM "ShopAdmin" candidate
WHERE candidate."shopId" = notification."shopId"
  AND candidate."telegramId" = notification."telegramId"
  AND candidate."deletedAt" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "ShopAdmin" possible
    WHERE possible."shopId" = notification."shopId"
      AND possible."telegramId" = notification."telegramId"
      AND possible."deletedAt" IS NULL
  ) = 1;

CREATE INDEX "Notification_recipientShopAdminId_shopId_idx"
  ON "Notification"("recipientShopAdminId", "shopId");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientShopAdminId_shopId_fkey"
  FOREIGN KEY ("recipientShopAdminId", "shopId") REFERENCES "ShopAdmin"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "oryx_notification_requires_recipient"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."recipientShopAdminId" IS NULL THEN
    RAISE EXCEPTION 'new notification rows require an intended shop-member recipient'
      USING ERRCODE = '23514', CONSTRAINT = 'Notification_recipient_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Notification_recipient_required"
BEFORE INSERT ON "Notification"
FOR EACH ROW EXECUTE FUNCTION "oryx_notification_requires_recipient"();

-- The deferred completeness trigger proves a new package includes the whole
-- active catalog. This companion trigger closes the remaining append-only
-- hole by allowing feature inserts only in the transaction that created the
-- parent snapshot.
CREATE OR REPLACE FUNCTION "oryx_package_feature_insert_same_transaction"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_xmin XID;
BEGIN
  SELECT xmin INTO parent_xmin
  FROM "ShopPackageVersion"
  WHERE "id" = NEW."packageVersionId";

  IF parent_xmin IS NULL OR (parent_xmin::TEXT)::BIGINT <> txid_current() THEN
    RAISE EXCEPTION 'published package snapshots are immutable; create a replacement version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ShopPackageFeature_insert_immutable"
BEFORE INSERT ON "ShopPackageFeature"
FOR EACH ROW EXECUTE FUNCTION "oryx_package_feature_insert_same_transaction"();
