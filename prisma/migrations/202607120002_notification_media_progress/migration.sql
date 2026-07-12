-- Durable Telegram multi-image delivery progress. Additive and legacy-safe:
-- existing notifications begin with no snapshot and resolve media on retry.
ALTER TABLE "Notification"
  ADD COLUMN "mediaKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mediaSentPositions" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "mediaSnapshotAt" TIMESTAMP(3),
  ADD COLUMN "textSentAt" TIMESTAMP(3);
