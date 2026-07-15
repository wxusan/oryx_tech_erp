-- Start Super Admin subscription-revenue reporting from zero without deleting
-- historical ShopPayment receipts. The retained receipts remain immutable
-- audit/CSV evidence; platform aggregates read this explicit boundary.

CREATE TABLE "PlatformRevenueReportWindow" (
  "id" TEXT NOT NULL,
  "subscriptionRevenueStartsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformRevenueReportWindow_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformRevenueReportWindow" ("id", "subscriptionRevenueStartsAt")
VALUES ('platform', CURRENT_TIMESTAMP);
