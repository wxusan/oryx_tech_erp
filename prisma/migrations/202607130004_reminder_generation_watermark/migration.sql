-- Durable, resumable reminder-generation progress. This is intentionally
-- independent from OpsEvent: telemetry is best-effort, while a watermark must
-- be authoritative so an outage or function timeout cannot skip reminders.

CREATE TABLE "ReminderGenerationState" (
  "id" TEXT NOT NULL,
  "completedThrough" TIMESTAMP(3) NOT NULL,
  "windowStart" TIMESTAMP(3),
  "windowEnd" TIMESTAMP(3),
  "phase" TEXT,
  "cursor" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReminderGenerationState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReminderGenerationState_phase_check" CHECK (
    "phase" IS NULL OR "phase" IN (
      'NASIYA_DUE', 'NASIYA_OVERDUE', 'NASIYA_EARLY',
      'SALE_DUE', 'SALE_OVERDUE', 'SALE_EARLY',
      'SUPPLIER_DUE', 'SUPPLIER_OVERDUE', 'SUPPLIER_EARLY'
    )
  ),
  CONSTRAINT "ReminderGenerationState_window_check" CHECK (
    ("windowStart" IS NULL AND "windowEnd" IS NULL AND "phase" IS NULL AND "cursor" IS NULL)
    OR
    ("windowStart" IS NOT NULL AND "windowEnd" IS NOT NULL AND "phase" IS NOT NULL AND "windowStart" < "windowEnd")
  ),
  CONSTRAINT "ReminderGenerationState_lease_check" CHECK (
    ("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)
  )
);

CREATE INDEX "ReminderGenerationState_leaseExpiresAt_idx"
  ON "ReminderGenerationState"("leaseExpiresAt");
