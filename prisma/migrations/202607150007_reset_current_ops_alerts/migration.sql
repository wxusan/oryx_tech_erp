-- One-time acknowledgement requested by the Super Admin: keep all historical
-- OpsEvent and Notification rows, but start the live operations alert window
-- anew. A signed-in Super Admin can make later acknowledgements through the
-- operations console; this release-time reset is recorded as a system action.

INSERT INTO "OpsAlertState" (
  "id",
  "alertWindowStartsAt",
  "acknowledgedAt",
  "acknowledgedById"
)
VALUES ('platform', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system-release')
ON CONFLICT ("id") DO UPDATE
SET
  "alertWindowStartsAt" = EXCLUDED."alertWindowStartsAt",
  "acknowledgedAt" = EXCLUDED."acknowledgedAt",
  "acknowledgedById" = EXCLUDED."acknowledgedById",
  "updatedAt" = CURRENT_TIMESTAMP;
