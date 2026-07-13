-- Request correlation for operational and business audit trails.
--
-- Existing rows intentionally remain NULL. `Log.ipAddress` stores only a
-- one-way deployment-secret-scoped network fingerprint for new HTTP business
-- operations; raw client IP addresses are not persisted by this release.

ALTER TABLE "Log" ADD COLUMN "requestId" TEXT;
ALTER TABLE "OpsEvent" ADD COLUMN "requestId" TEXT;

ALTER TABLE "Log" ADD CONSTRAINT "Log_requestId_shape_check"
  CHECK ("requestId" IS NULL OR (length("requestId") BETWEEN 8 AND 160)) NOT VALID;
ALTER TABLE "OpsEvent" ADD CONSTRAINT "OpsEvent_requestId_shape_check"
  CHECK ("requestId" IS NULL OR (length("requestId") BETWEEN 8 AND 160)) NOT VALID;
