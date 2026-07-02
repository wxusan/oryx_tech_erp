-- Search and list-performance indexes for shop-facing routes.
--
-- These indexes support the current Prisma `contains` searches (ILIKE-style)
-- across device, nasiya, customer and log screens. Prisma schema cannot model
-- PostgreSQL pg_trgm operator-class indexes, so this migration is raw SQL.
--
-- NOTE: on large existing production tables, create these indexes
-- CONCURRENTLY by hand instead. Prisma migrations run in a transaction and
-- cannot use CREATE INDEX CONCURRENTLY.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Device search: /api/devices searches model, IMEI, color, storage and
-- supplier phone with contains/insensitive matching.
CREATE INDEX "Device_model_trgm_idx" ON "Device" USING GIN ("model" gin_trgm_ops);
CREATE INDEX "Device_imei_trgm_idx" ON "Device" USING GIN ("imei" gin_trgm_ops);
CREATE INDEX "Device_color_trgm_idx" ON "Device" USING GIN ("color" gin_trgm_ops);
CREATE INDEX "Device_storage_trgm_idx" ON "Device" USING GIN ("storage" gin_trgm_ops);
CREATE INDEX "Device_supplierPhone_trgm_idx" ON "Device" USING GIN ("supplierPhone" gin_trgm_ops);
CREATE INDEX "Supplier_phone_trgm_idx" ON "Supplier" USING GIN ("phone" gin_trgm_ops);

-- Nasiya/customer search.
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Customer_phone_trgm_idx" ON "Customer" USING GIN ("phone" gin_trgm_ops);

-- Logs search and admin shop-name search.
CREATE INDEX "Log_action_trgm_idx" ON "Log" USING GIN ("action" gin_trgm_ops);
CREATE INDEX "Log_targetType_trgm_idx" ON "Log" USING GIN ("targetType" gin_trgm_ops);
CREATE INDEX "Log_targetId_trgm_idx" ON "Log" USING GIN ("targetId" gin_trgm_ops);
CREATE INDEX "Log_note_trgm_idx" ON "Log" USING GIN ("note" gin_trgm_ops);
CREATE INDEX "Shop_name_trgm_idx" ON "Shop" USING GIN ("name" gin_trgm_ops);

-- Composite list filters/orderings used by high-traffic shop pages and export
-- preflight/list routes.
CREATE INDEX "Device_shopId_status_createdAt_idx" ON "Device"("shopId", "status", "createdAt");
CREATE INDEX "Nasiya_shopId_status_createdAt_idx" ON "Nasiya"("shopId", "status", "createdAt");
CREATE INDEX "Customer_shopId_createdAt_idx" ON "Customer"("shopId", "createdAt");
CREATE INDEX "Sale_shopId_createdAt_idx" ON "Sale"("shopId", "createdAt");
CREATE INDEX "DeviceReturn_shopId_createdAt_idx" ON "DeviceReturn"("shopId", "createdAt");
CREATE INDEX "Log_shopId_actorType_createdAt_idx" ON "Log"("shopId", "actorType", "createdAt");
