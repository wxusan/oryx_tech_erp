-- Keep operational history for audit while allowing a Super Admin to start a
-- new live-alert window after resolving old incidents.

CREATE TABLE "OpsAlertState" (
  "id" TEXT NOT NULL,
  "alertWindowStartsAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OpsAlertState_pkey" PRIMARY KEY ("id")
);
