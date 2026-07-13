-- E2-003 / E2-008: append-only deferral and receivable-resolution evidence.
-- Financial contract/schedule/payment rows remain the source of truth. This
-- migration adds an independent operational collection state and immutable
-- events; it does not rewrite any historical money.

CREATE TYPE "NasiyaResolutionState" AS ENUM ('ACTIVE', 'ARCHIVED', 'WRITTEN_OFF');
CREATE TYPE "NasiyaResolutionEventType" AS ENUM ('ARCHIVE', 'WRITE_OFF', 'REOPEN');

ALTER TABLE "Nasiya"
  ADD COLUMN "resolutionState" "NasiyaResolutionState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "resolutionUpdatedAt" TIMESTAMP(3);

CREATE INDEX "Nasiya_shopId_resolutionState_status_idx"
  ON "Nasiya"("shopId", "resolutionState", "status");

-- Preserve the prior effective date for every existing deferral. When a
-- schedule was deferred multiple times, the immediately preceding deferral is
-- the old effective date; otherwise the original schedule due date is used.
ALTER TABLE "NasiyaDeferral"
  ADD COLUMN "originalDueDate" TIMESTAMP(3),
  ADD COLUMN "newDueDate" TIMESTAMP(3),
  ADD COLUMN "createdByType" "ActorType" NOT NULL DEFAULT 'SHOP_ADMIN';

UPDATE "NasiyaDeferral" current_deferral
SET
  "originalDueDate" = COALESCE(
    (
      SELECT previous_deferral."delayedUntil"
      FROM "NasiyaDeferral" previous_deferral
      WHERE previous_deferral."shopId" = current_deferral."shopId"
        AND previous_deferral."nasiyaScheduleId" = current_deferral."nasiyaScheduleId"
        AND (
          previous_deferral."createdAt" < current_deferral."createdAt"
          OR (
            previous_deferral."createdAt" = current_deferral."createdAt"
            AND previous_deferral."id" < current_deferral."id"
          )
        )
      ORDER BY previous_deferral."createdAt" DESC, previous_deferral."id" DESC
      LIMIT 1
    ),
    (
      SELECT schedule."dueDate"
      FROM "NasiyaSchedule" schedule
      WHERE schedule."id" = current_deferral."nasiyaScheduleId"
        AND schedule."shopId" = current_deferral."shopId"
    ),
    current_deferral."delayedUntil"
  ),
  "newDueDate" = current_deferral."delayedUntil",
  "createdByType" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "SuperAdmin" actor
      WHERE actor."id" = current_deferral."createdBy"
    ) THEN 'SUPER_ADMIN'::"ActorType"
    ELSE 'SHOP_ADMIN'::"ActorType"
  END;

ALTER TABLE "NasiyaDeferral"
  ALTER COLUMN "originalDueDate" SET NOT NULL,
  ALTER COLUMN "newDueDate" SET NOT NULL,
  ALTER COLUMN "createdByType" DROP DEFAULT,
  ADD CONSTRAINT "NasiyaDeferral_due_dates_match_check"
    CHECK ("newDueDate" = "delayedUntil"),
  ADD CONSTRAINT "NasiyaDeferral_due_dates_forward_check"
    CHECK ("newDueDate" > "originalDueDate") NOT VALID;

CREATE TABLE "NasiyaResolutionEvent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "nasiyaId" TEXT NOT NULL,
  "eventType" "NasiyaResolutionEventType" NOT NULL,
  "previousState" "NasiyaResolutionState" NOT NULL,
  "newState" "NasiyaResolutionState" NOT NULL,
  "contractCurrency" "CurrencyCode" NOT NULL,
  "nativeRemainingAmount" DECIMAL(14,2) NOT NULL,
  "frozenUzsAmount" DECIMAL(14,2) NOT NULL,
  "frozenUsdUzsRate" DECIMAL(14,4) NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reversesEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NasiyaResolutionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NasiyaResolutionEvent_amounts_check"
    CHECK (
      "nativeRemainingAmount" >= 0
      AND "frozenUzsAmount" >= 0
      AND "frozenUsdUzsRate" > 0
    ),
  CONSTRAINT "NasiyaResolutionEvent_reason_check"
    CHECK (char_length(btrim("reason")) >= 5),
  CONSTRAINT "NasiyaResolutionEvent_transition_check"
    CHECK (
      (
        "eventType" = 'ARCHIVE'
        AND "previousState" = 'ACTIVE'
        AND "newState" = 'ARCHIVED'
        AND "reversesEventId" IS NULL
      ) OR (
        "eventType" = 'WRITE_OFF'
        AND "previousState" IN ('ACTIVE', 'ARCHIVED')
        AND "newState" = 'WRITTEN_OFF'
        AND "reversesEventId" IS NULL
      ) OR (
        "eventType" = 'REOPEN'
        AND "previousState" IN ('ARCHIVED', 'WRITTEN_OFF')
        AND "newState" = 'ACTIVE'
        AND "reversesEventId" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "NasiyaResolutionEvent_id_shopId_nasiyaId_key"
  ON "NasiyaResolutionEvent"("id", "shopId", "nasiyaId");
CREATE UNIQUE INDEX "NasiyaResolutionEvent_shopId_idempotencyKey_key"
  ON "NasiyaResolutionEvent"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX "NasiyaResolutionEvent_shopId_reversesEventId_key"
  ON "NasiyaResolutionEvent"("shopId", "reversesEventId");
CREATE INDEX "NasiyaResolutionEvent_shopId_nasiyaId_createdAt_idx"
  ON "NasiyaResolutionEvent"("shopId", "nasiyaId", "createdAt");
CREATE INDEX "NasiyaResolutionEvent_shopId_eventType_createdAt_idx"
  ON "NasiyaResolutionEvent"("shopId", "eventType", "createdAt");
CREATE INDEX "NasiyaResolutionEvent_shopId_newState_createdAt_idx"
  ON "NasiyaResolutionEvent"("shopId", "newState", "createdAt");

ALTER TABLE "NasiyaResolutionEvent"
  ADD CONSTRAINT "NasiyaResolutionEvent_nasiyaId_shopId_fkey"
  FOREIGN KEY ("nasiyaId", "shopId")
  REFERENCES "Nasiya"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "NasiyaResolutionEvent"
  ADD CONSTRAINT "NasiyaResolutionEvent_reversal_same_contract_fkey"
  FOREIGN KEY ("reversesEventId", "shopId", "nasiyaId")
  REFERENCES "NasiyaResolutionEvent"("id", "shopId", "nasiyaId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "NasiyaResolutionEvent"
  VALIDATE CONSTRAINT "NasiyaResolutionEvent_nasiyaId_shopId_fkey";
ALTER TABLE "NasiyaResolutionEvent"
  VALIDATE CONSTRAINT "NasiyaResolutionEvent_reversal_same_contract_fkey";

CREATE OR REPLACE FUNCTION "oryx_immutable_nasiya_command_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable nasiya command events cannot be updated or deleted';
END;
$$;

CREATE TRIGGER "NasiyaDeferral_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaDeferral"
  FOR EACH ROW EXECUTE FUNCTION "oryx_immutable_nasiya_command_event"();

CREATE TRIGGER "NasiyaResolutionEvent_immutable"
  BEFORE UPDATE OR DELETE ON "NasiyaResolutionEvent"
  FOR EACH ROW EXECUTE FUNCTION "oryx_immutable_nasiya_command_event"();
