-- Durable Telegram disable lifecycle.
--
-- No financial tables are touched. Existing identities that are already
-- ineligible are cleared before the cross-role uniqueness guards can reserve
-- them indefinitely, and their actionable notifications are cancelled with a
-- privacy-safe reason.

BEGIN;

ALTER TABLE "OpsEvent"
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "OpsEvent_dedupeKey_key" ON "OpsEvent"("dedupeKey");
CREATE INDEX "OpsEvent_level_lastOccurredAt_idx" ON "OpsEvent"("level", "lastOccurredAt" DESC);
CREATE INDEX "OpsEvent_event_lastOccurredAt_idx" ON "OpsEvent"("event", "lastOccurredAt" DESC);

ALTER TABLE "Notification"
  ADD COLUMN "recipientUnavailableReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "Notification_status_cancelledAt_id_idx"
  ON "Notification"("status", "cancelledAt" DESC, "id" DESC);

-- Normal notifications remain bound to a tenant member. The sole null-target
-- exception is a privacy-safe, non-actionable recipient-gap marker used by
-- Tizim. It cannot contain a message, Telegram ID, or related business ID.
CREATE OR REPLACE FUNCTION "oryx_notification_requires_recipient"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_is_gap_marker BOOLEAN := FALSE;
  new_is_gap_marker BOOLEAN;
BEGIN
  new_is_gap_marker := NEW."recipientShopAdminId" IS NULL
    AND NEW."status" = 'CANCELLED'::"NotificationStatus"
    AND NEW."recipientUnavailableReason" IN (
      'unlinked_or_unverified',
      'personal_disabled',
      'shop_disabled',
      'package_not_entitled',
      'recipient_limit_reached'
    )
    AND NEW."type" IN (
      'DEVICE_CREATED',
      'RESTOCK',
      'SALE',
      'NASIYA',
      'RETURN',
      'PAYMENT_RECEIVED',
      'NASIYA_COMPLETED',
      'NASIYA_IMPORTED',
      'OLIB_SOTDIM_CREATED',
      'SUPPLIER_PAYABLE_PAID',
      'REMINDER',
      'OVERDUE',
      'EARLY_REMINDER',
      'SALE_REMINDER',
      'SALE_OVERDUE',
      'SALE_EARLY_REMINDER',
      'SUPPLIER_PAYABLE_REMINDER',
      'SUPPLIER_PAYABLE_OVERDUE',
      'SUPPLIER_PAYABLE_EARLY_REMINDER',
      'TELEGRAM'
    )
    AND NEW."cancelledAt" IS NOT NULL
    AND NEW."message" = ''
    AND NEW."telegramId" = ''
    AND NEW."dedupeKey" ~ '^TELEGRAM_GAP:[0-9a-f]{64}$'
    AND NEW."lastError" = 'Cancelled before delivery: ' || NEW."recipientUnavailableReason"
    AND NEW."relatedId" IS NULL
    AND NEW."relatedType" IS NULL
    AND NEW."sentAt" IS NULL
    AND NEW."attemptCount" = 0
    AND NEW."lastAttemptAt" IS NULL
    AND NEW."nextAttemptAt" IS NULL
    AND NEW."mediaKeys" = ARRAY[]::TEXT[]
    AND NEW."mediaSentPositions" = ARRAY[]::INTEGER[]
    AND NEW."mediaSnapshotAt" IS NULL
    AND NEW."textSentAt" IS NULL;

  IF TG_OP = 'UPDATE' THEN
    old_is_gap_marker := OLD."recipientShopAdminId" IS NULL
      AND OLD."status" = 'CANCELLED'::"NotificationStatus"
      AND OLD."recipientUnavailableReason" IN (
        'unlinked_or_unverified',
        'personal_disabled',
        'shop_disabled',
        'package_not_entitled',
        'recipient_limit_reached'
      )
      AND OLD."type" IN (
      'DEVICE_CREATED',
      'RESTOCK',
      'SALE',
      'NASIYA',
      'RETURN',
      'PAYMENT_RECEIVED',
      'NASIYA_COMPLETED',
      'NASIYA_IMPORTED',
      'OLIB_SOTDIM_CREATED',
      'SUPPLIER_PAYABLE_PAID',
      'REMINDER',
      'OVERDUE',
      'EARLY_REMINDER',
      'SALE_REMINDER',
      'SALE_OVERDUE',
      'SALE_EARLY_REMINDER',
      'SUPPLIER_PAYABLE_REMINDER',
      'SUPPLIER_PAYABLE_OVERDUE',
      'SUPPLIER_PAYABLE_EARLY_REMINDER',
      'TELEGRAM'
    )
      AND OLD."cancelledAt" IS NOT NULL
      AND OLD."message" = ''
      AND OLD."telegramId" = ''
      AND OLD."dedupeKey" ~ '^TELEGRAM_GAP:[0-9a-f]{64}$'
      AND OLD."lastError" = 'Cancelled before delivery: ' || OLD."recipientUnavailableReason"
      AND OLD."relatedId" IS NULL
      AND OLD."relatedType" IS NULL
      AND OLD."sentAt" IS NULL
      AND OLD."attemptCount" = 0
      AND OLD."lastAttemptAt" IS NULL
      AND OLD."nextAttemptAt" IS NULL
      AND OLD."mediaKeys" = ARRAY[]::TEXT[]
      AND OLD."mediaSentPositions" = ARRAY[]::INTEGER[]
      AND OLD."mediaSnapshotAt" IS NULL
      AND OLD."textSentAt" IS NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND old_is_gap_marker THEN
    RAISE EXCEPTION 'Telegram recipient gap markers are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'Notification_gap_marker_immutable';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW."recipientShopAdminId" IS NULL AND NOT new_is_gap_marker)
    OR (
      TG_OP = 'UPDATE'
      AND (
        (OLD."recipientShopAdminId" IS NOT NULL AND NEW."recipientShopAdminId" IS NULL AND NOT new_is_gap_marker)
        OR (old_is_gap_marker AND NOT new_is_gap_marker)
      )
    )
  THEN
    RAISE EXCEPTION 'new notification rows require an intended shop-member recipient or strict gap marker'
      USING ERRCODE = '23514', CONSTRAINT = 'Notification_recipient_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "Notification_recipient_required" ON "Notification";
CREATE TRIGGER "Notification_recipient_required"
BEFORE INSERT OR UPDATE ON "Notification"
FOR EACH ROW EXECUTE FUNCTION "oryx_notification_requires_recipient"();

CREATE TABLE "TelegramDisableTransition" (
  "id" TEXT NOT NULL,
  "packageVersionId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "effectiveOn" DATE NOT NULL,
  "processedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "lastError" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TelegramDisableTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramDisableTransition_packageVersionId_key"
  ON "TelegramDisableTransition"("packageVersionId");
CREATE UNIQUE INDEX "TelegramDisableTransition_packageVersionId_shopId_key"
  ON "TelegramDisableTransition"("packageVersionId", "shopId");
CREATE INDEX "TelegramDisableTransition_processedAt_effectiveOn_id_idx"
  ON "TelegramDisableTransition"("processedAt", "effectiveOn", "id");
CREATE INDEX "TelegramDisableTransition_shopId_processedAt_effectiveOn_idx"
  ON "TelegramDisableTransition"("shopId", "processedAt", "effectiveOn");
CREATE INDEX "TelegramDisableTransition_due_idx"
  ON "TelegramDisableTransition"("effectiveOn", "id")
  WHERE "processedAt" IS NULL;

ALTER TABLE "TelegramDisableTransition"
  ADD CONSTRAINT "TelegramDisableTransition_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramDisableTransition"
  ADD CONSTRAINT "TelegramDisableTransition_packageVersionId_shopId_fkey"
  FOREIGN KEY ("packageVersionId", "shopId") REFERENCES "ShopPackageVersion"("id", "shopId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Reminder dedupe keys historically used the mutable Telegram ID as their
-- third segment. Rewrite the nine known four-segment reminder formats to the
-- stable recipient actor ID before a resumed same-day cron can enqueue the
-- same logical reminder under the new format. The preflight table ranks every
-- old/new member of a logical key, preferring SENT proof and then one active
-- row. Redundant actionable rows are cancelled before their obsolete keys are
-- nulled, preserving complete notification history without allowing the
-- collision workaround itself to make duplicate messages deliverable.
CREATE TEMP TABLE "_ReminderDedupeRewrite" ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    notification."id",
    split_part(notification."dedupeKey", ':', 1)
      || ':' || split_part(notification."dedupeKey", ':', 2)
      || ':' || notification."recipientShopAdminId"
      || ':' || split_part(notification."dedupeKey", ':', 4) AS "newDedupeKey"
  FROM "Notification" notification
  WHERE notification."recipientShopAdminId" IS NOT NULL
    AND notification."dedupeKey" IS NOT NULL
    AND notification."type" IN (
      'REMINDER',
      'OVERDUE',
      'EARLY_REMINDER',
      'SALE_REMINDER',
      'SALE_OVERDUE',
      'SALE_EARLY_REMINDER',
      'SUPPLIER_PAYABLE_REMINDER',
      'SUPPLIER_PAYABLE_OVERDUE',
      'SUPPLIER_PAYABLE_EARLY_REMINDER'
    )
    AND split_part(notification."dedupeKey", ':', 1) = notification."type"
    AND split_part(notification."dedupeKey", ':', 2) <> ''
    AND split_part(notification."dedupeKey", ':', 3) <> ''
    AND split_part(notification."dedupeKey", ':', 4) <> ''
    AND split_part(notification."dedupeKey", ':', 5) = ''
    AND split_part(notification."dedupeKey", ':', 3) <> notification."recipientShopAdminId"
), logical_members AS (
  SELECT
    candidate."newDedupeKey",
    notification."id",
    notification."status",
    notification."lastAttemptAt",
    notification."createdAt"
  FROM candidates candidate
  JOIN "Notification" notification ON notification."id" = candidate."id"

  UNION ALL

  SELECT
    logical_key."newDedupeKey",
    notification."id",
    notification."status",
    notification."lastAttemptAt",
    notification."createdAt"
  FROM (SELECT DISTINCT "newDedupeKey" FROM candidates) logical_key
  JOIN "Notification" notification
    ON notification."dedupeKey" = logical_key."newDedupeKey"
), ranked AS (
  SELECT
    member."id",
    member."newDedupeKey",
    member."status",
    member."lastAttemptAt",
    ROW_NUMBER() OVER (
      PARTITION BY member."newDedupeKey"
      ORDER BY
        CASE
          WHEN member."status" = 'SENT' THEN 0
          WHEN member."status" = 'PENDING' THEN 1
          WHEN member."status" = 'FAILED' THEN 2
          WHEN member."status" = 'PROCESSING' THEN 3
          ELSE 4
        END ASC,
        member."createdAt" ASC,
        member."id" ASC
    ) AS "targetRank",
    COUNT(*) OVER (PARTITION BY member."newDedupeKey") AS "memberCount"
  FROM logical_members member
)
SELECT * FROM ranked;

-- A fresh PROCESSING row may already be inside Telegram delivery on the live
-- deployment. Abort the whole migration and retry after the normal stale
-- boundary instead of rewriting a key around an in-flight duplicate.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_ReminderDedupeRewrite" rewrite
    WHERE rewrite."memberCount" > 1
      AND rewrite."status" = 'PROCESSING'
      AND rewrite."lastAttemptAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes'
  ) THEN
    RAISE EXCEPTION 'Fresh reminder delivery collision; retry migration after processing lease expires'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

UPDATE "Notification" notification
SET "status" = 'CANCELLED',
    "nextAttemptAt" = NULL,
    "lastError" = 'Duplicate reminder cancelled during Telegram recipient dedupe migration',
    "cancelledAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_ReminderDedupeRewrite" rewrite
WHERE notification."id" = rewrite."id"
  AND rewrite."memberCount" > 1
  AND rewrite."targetRank" > 1
  AND (
    notification."status" IN ('PENDING', 'FAILED')
    OR (
      notification."status" = 'PROCESSING'
      AND (
        notification."lastAttemptAt" IS NULL
        OR notification."lastAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes'
      )
    )
  );

UPDATE "Notification" notification
SET "dedupeKey" = NULL
FROM "_ReminderDedupeRewrite" rewrite
WHERE notification."id" = rewrite."id"
  AND rewrite."memberCount" > 1
  AND rewrite."targetRank" > 1;

UPDATE "Notification" notification
SET "dedupeKey" = rewrite."newDedupeKey"
FROM "_ReminderDedupeRewrite" rewrite
WHERE notification."id" = rewrite."id"
  AND rewrite."targetRank" = 1;

-- Materialize the ineligible actor set once so cancellation and identity
-- clearing use the exact same snapshot. Owner personal=false is deliberately
-- not a disable state; owners are governed by package + shop master switches.
CREATE TEMP TABLE "_TelegramIneligibleShopAdmin" ON COMMIT DROP AS
SELECT
  admin."id",
  admin."shopId",
  admin."telegramId" AS "oldTelegramId",
  CASE
    WHEN shop."deletedAt" IS NOT NULL
      OR shop."status" <> 'ACTIVE'
      OR shop."telegramNotificationsEnabled" = FALSE
      THEN 'shop_disabled'
    WHEN active_package."id" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "ShopPackageFeature" reason_feature
        WHERE reason_feature."packageVersionId" = active_package."id"
          AND reason_feature."featureCode" = 'TELEGRAM'
          AND reason_feature."enabled" = TRUE
      )
      THEN 'package_not_entitled'
    WHEN admin."id" IS DISTINCT FROM shop."ownerAdminId"
      AND admin."telegramNotificationsEnabled" = FALSE
      THEN 'personal_disabled'
    WHEN admin."id" IS DISTINCT FROM shop."ownerAdminId"
      AND NOT EXISTS (
        SELECT 1
        FROM "ShopPackageFeature" staff_reason_feature
        WHERE staff_reason_feature."packageVersionId" = active_package."id"
          AND staff_reason_feature."featureCode" = 'STAFF_ACCESS'
          AND staff_reason_feature."enabled" = TRUE
      )
      THEN 'package_not_entitled'
    ELSE 'unlinked_or_unverified'
  END AS "warningReason"
FROM "ShopAdmin" admin
JOIN "Shop" shop ON shop."id" = admin."shopId"
LEFT JOIN LATERAL (
  SELECT package."id"
  FROM "ShopPackageVersion" package
  WHERE package."shopId" = shop."id"
    AND package."effectiveOn" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tashkent')::date
  ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
  LIMIT 1
) active_package ON TRUE
WHERE (
    admin."deletedAt" IS NOT NULL
    OR admin."isActive" = FALSE
    OR shop."deletedAt" IS NOT NULL
    OR shop."status" <> 'ACTIVE'
    OR shop."telegramNotificationsEnabled" = FALSE
    OR active_package."id" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "ShopPackageFeature" feature
      WHERE feature."packageVersionId" = active_package."id"
        AND feature."featureCode" = 'TELEGRAM'
        AND feature."enabled" = TRUE
    )
    OR (
      admin."id" IS DISTINCT FROM shop."ownerAdminId"
      AND (
        admin."telegramNotificationsEnabled" = FALSE
        OR NOT EXISTS (
          SELECT 1
          FROM "ShopPackageFeature" staff_feature
          WHERE staff_feature."packageVersionId" = active_package."id"
            AND staff_feature."featureCode" = 'STAFF_ACCESS'
            AND staff_feature."enabled" = TRUE
        )
      )
    )
  );

UPDATE "Notification" notification
SET "status" = 'CANCELLED',
    "nextAttemptAt" = NULL,
    "lastError" = 'Telegram identity removed because delivery was disabled',
    "recipientUnavailableReason" = actor."warningReason",
    "cancelledAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_TelegramIneligibleShopAdmin" actor
WHERE notification."shopId" = actor."shopId"
  AND (
    notification."recipientShopAdminId" = actor."id"
    OR (
      notification."recipientShopAdminId" IS NULL
      AND actor."oldTelegramId" IS NOT NULL
      AND notification."telegramId" = actor."oldTelegramId"
    )
  )
  AND (
    notification."status" IN ('PENDING', 'FAILED')
    OR (
      notification."status" = 'PROCESSING'
      AND (
        notification."lastAttemptAt" IS NULL
        OR notification."lastAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes'
      )
    )
  );

UPDATE "ShopAdmin" admin
SET "telegramId" = NULL,
    "telegramVerifiedAt" = NULL
FROM "_TelegramIneligibleShopAdmin" actor
WHERE admin."id" = actor."id";

UPDATE "SuperAdmin"
SET "telegramId" = NULL,
    "telegramVerifiedAt" = NULL
WHERE "deletedAt" IS NOT NULL
  AND ("telegramId" IS NOT NULL OR "telegramVerifiedAt" IS NOT NULL);

-- Seed every future false snapshot, not only the next one. If deployments or
-- cron are delayed, each due transition still purges once even when a newer
-- package has re-enabled Telegram in the meantime.
INSERT INTO "TelegramDisableTransition" (
  "id", "packageVersionId", "shopId", "effectiveOn", "createdAt", "updatedAt"
)
SELECT
  'telegram-disable:' || package."id",
  package."id",
  package."shopId",
  package."effectiveOn",
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "ShopPackageVersion" package
WHERE package."effectiveOn" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tashkent')::date
  AND EXISTS (
    SELECT 1
    FROM "ShopPackageFeature" feature
    WHERE feature."packageVersionId" = package."id"
      AND feature."featureCode" = 'TELEGRAM'
      AND feature."enabled" = FALSE
  )
ON CONFLICT ("packageVersionId") DO NOTHING;

COMMIT;
