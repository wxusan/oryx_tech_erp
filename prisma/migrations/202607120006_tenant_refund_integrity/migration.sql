-- Preserve the native amount/currency/rate used for a return. `refundAmount`
-- remains the existing UZS compatibility/accounting snapshot.
ALTER TABLE "DeviceReturn"
  ADD COLUMN "refundInputAmount" DECIMAL(12,2),
  ADD COLUMN "refundInputCurrency" "CurrencyCode",
  ADD COLUMN "refundExchangeRateAtCreation" DECIMAL(12,4);

-- PostgreSQL requires an exact composite unique key as the target of each
-- tenant-aware foreign key. `id` remains the primary key; these additive keys
-- let the database prove that child.shopId matches parent.shopId.
CREATE UNIQUE INDEX "Supplier_id_shopId_key" ON "Supplier"("id", "shopId");
CREATE UNIQUE INDEX "Customer_id_shopId_key" ON "Customer"("id", "shopId");
CREATE UNIQUE INDEX "Sale_id_shopId_key" ON "Sale"("id", "shopId");
CREATE UNIQUE INDEX "Nasiya_id_shopId_key" ON "Nasiya"("id", "shopId");
CREATE UNIQUE INDEX "NasiyaSchedule_id_shopId_key" ON "NasiyaSchedule"("id", "shopId");

-- Add the constraints as NOT VALID first so PostgreSQL takes only a short
-- metadata lock. VALIDATE scans existing rows without holding a long
-- ACCESS EXCLUSIVE lock; any historic cross-tenant corruption blocks the
-- release instead of being silently accepted.
ALTER TABLE "Device" ADD CONSTRAINT "Device_supplierId_shopId_fkey"
  FOREIGN KEY ("supplierId", "shopId") REFERENCES "Supplier"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_deviceId_shopId_fkey"
  FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_shopId_fkey"
  FOREIGN KEY ("customerId", "shopId") REFERENCES "Customer"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_shopId_fkey"
  FOREIGN KEY ("saleId", "shopId") REFERENCES "Sale"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_deviceId_shopId_fkey"
  FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_saleId_shopId_fkey"
  FOREIGN KEY ("saleId", "shopId") REFERENCES "Sale"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_deviceId_shopId_fkey"
  FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Nasiya" ADD CONSTRAINT "Nasiya_customerId_shopId_fkey"
  FOREIGN KEY ("customerId", "shopId") REFERENCES "Customer"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "NasiyaSchedule" ADD CONSTRAINT "NasiyaSchedule_nasiyaId_shopId_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "NasiyaDeferral" ADD CONSTRAINT "NasiyaDeferral_nasiyaId_shopId_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "NasiyaDeferral" ADD CONSTRAINT "NasiyaDeferral_scheduleId_shopId_fkey"
  FOREIGN KEY ("nasiyaScheduleId", "shopId") REFERENCES "NasiyaSchedule"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "NasiyaPayment" ADD CONSTRAINT "NasiyaPayment_nasiyaId_shopId_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "NasiyaPayment" ADD CONSTRAINT "NasiyaPayment_scheduleId_shopId_fkey"
  FOREIGN KEY ("nasiyaScheduleId", "shopId") REFERENCES "NasiyaSchedule"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_deviceId_shopId_fkey"
  FOREIGN KEY ("deviceId", "shopId") REFERENCES "Device"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_saleId_shopId_fkey"
  FOREIGN KEY ("saleId", "shopId") REFERENCES "Sale"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DeviceReturn" ADD CONSTRAINT "DeviceReturn_nasiyaId_shopId_fkey"
  FOREIGN KEY ("nasiyaId", "shopId") REFERENCES "Nasiya"("id", "shopId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "Device" VALIDATE CONSTRAINT "Device_supplierId_shopId_fkey";
ALTER TABLE "Sale" VALIDATE CONSTRAINT "Sale_deviceId_shopId_fkey";
ALTER TABLE "Sale" VALIDATE CONSTRAINT "Sale_customerId_shopId_fkey";
ALTER TABLE "SalePayment" VALIDATE CONSTRAINT "SalePayment_saleId_shopId_fkey";
ALTER TABLE "SupplierPayable" VALIDATE CONSTRAINT "SupplierPayable_deviceId_shopId_fkey";
ALTER TABLE "SupplierPayable" VALIDATE CONSTRAINT "SupplierPayable_saleId_shopId_fkey";
ALTER TABLE "Nasiya" VALIDATE CONSTRAINT "Nasiya_deviceId_shopId_fkey";
ALTER TABLE "Nasiya" VALIDATE CONSTRAINT "Nasiya_customerId_shopId_fkey";
ALTER TABLE "NasiyaSchedule" VALIDATE CONSTRAINT "NasiyaSchedule_nasiyaId_shopId_fkey";
ALTER TABLE "NasiyaDeferral" VALIDATE CONSTRAINT "NasiyaDeferral_nasiyaId_shopId_fkey";
ALTER TABLE "NasiyaDeferral" VALIDATE CONSTRAINT "NasiyaDeferral_scheduleId_shopId_fkey";
ALTER TABLE "NasiyaPayment" VALIDATE CONSTRAINT "NasiyaPayment_nasiyaId_shopId_fkey";
ALTER TABLE "NasiyaPayment" VALIDATE CONSTRAINT "NasiyaPayment_scheduleId_shopId_fkey";
ALTER TABLE "DeviceReturn" VALIDATE CONSTRAINT "DeviceReturn_deviceId_shopId_fkey";
ALTER TABLE "DeviceReturn" VALIDATE CONSTRAINT "DeviceReturn_saleId_shopId_fkey";
ALTER TABLE "DeviceReturn" VALIDATE CONSTRAINT "DeviceReturn_nasiyaId_shopId_fkey";
