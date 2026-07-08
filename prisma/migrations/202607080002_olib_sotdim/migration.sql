-- "Olib-sotdim": source a device from another shop/person and sell it to our
-- customer in the same operation. Adds two additive Device columns (nullable /
-- defaulted, no backfill) and a new SupplierPayable table tracking money WE
-- owe an external supplier, kept fully separate from Sale.remainingAmount
-- (money the customer owes us).

ALTER TABLE "Device"
  ADD COLUMN "condition" TEXT,
  ADD COLUMN "isExternalSourced" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SupplierPayableStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'OVERDUE');

CREATE TABLE "SupplierPayable" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierPhone" TEXT NOT NULL,
    "supplierLocation" TEXT,
    "supplierNote" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "SupplierPayableStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "earlyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "earlyReminderDays" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deleteNote" TEXT,

    CONSTRAINT "SupplierPayable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPayable_saleId_key" ON "SupplierPayable"("saleId");
CREATE INDEX "SupplierPayable_shopId_idx" ON "SupplierPayable"("shopId");
CREATE INDEX "SupplierPayable_status_idx" ON "SupplierPayable"("status");
CREATE INDEX "SupplierPayable_shopId_status_dueDate_idx" ON "SupplierPayable"("shopId", "status", "dueDate");
CREATE INDEX "SupplierPayable_status_dueDate_idx" ON "SupplierPayable"("status", "dueDate");

ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
