-- Ops/observability telemetry table (system health, jobs, failures).
-- Separate from the business audit "Log" table. Apply with `migrate deploy`.

-- CreateEnum
CREATE TYPE "OpsLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "OpsEvent" (
    "id" TEXT NOT NULL,
    "level" "OpsLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "shopId" TEXT,
    "actorId" TEXT,
    "actorType" "ActorType",
    "entityType" TEXT,
    "entityId" TEXT,
    "status" TEXT,
    "errorCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsEvent_level_idx" ON "OpsEvent"("level");

-- CreateIndex
CREATE INDEX "OpsEvent_event_idx" ON "OpsEvent"("event");

-- CreateIndex
CREATE INDEX "OpsEvent_createdAt_idx" ON "OpsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OpsEvent_event_createdAt_idx" ON "OpsEvent"("event", "createdAt");
