-- "Ertaroq eslatilsinmi?" — an optional extra reminder N days before a
-- nasiya schedule's due date / a later-payment sale's due date, in addition
-- to the existing due-day reminder. Additive, nullable/defaulted columns:
-- no backfill needed, existing rows behave exactly as before (disabled).

ALTER TABLE "Nasiya"
  ADD COLUMN "earlyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "earlyReminderDays" INTEGER;

ALTER TABLE "Sale"
  ADD COLUMN "earlyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "earlyReminderDays" INTEGER;
