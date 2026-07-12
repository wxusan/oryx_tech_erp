-- Durable cursor stream for fine-grained browser synchronization.
-- No business payload is copied: /api/sync resolves the current authorized
-- canonical DTO after reading these minimal event references.

CREATE TABLE "ChangeEvent" (
    "sequence" BIGSERIAL NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "mutationKind" TEXT NOT NULL,
    "entityVersion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("sequence")
);

CREATE INDEX "ChangeEvent_scopeType_scopeId_sequence_idx"
    ON "ChangeEvent"("scopeType", "scopeId", "sequence");
CREATE INDEX "ChangeEvent_scopeType_scopeId_domain_sequence_idx"
    ON "ChangeEvent"("scopeType", "scopeId", "domain", "sequence");
CREATE INDEX "ChangeEvent_createdAt_idx" ON "ChangeEvent"("createdAt");

CREATE OR REPLACE FUNCTION "oryx_record_change_event_from_log"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_domain TEXT;
    event_operation TEXT;
    event_kind TEXT;
    admin_global BOOLEAN;
BEGIN
    event_domain := CASE NEW."targetType"
        WHEN 'Device' THEN 'devices'
        WHEN 'Sale' THEN 'sales'
        WHEN 'SalePayment' THEN 'payments'
        WHEN 'Nasiya' THEN 'nasiyas'
        WHEN 'NasiyaPayment' THEN 'payments'
        WHEN 'NasiyaReminder' THEN 'nasiyas'
        WHEN 'Customer' THEN 'customers'
        WHEN 'DeviceReturn' THEN 'returns'
        WHEN 'SupplierPayable' THEN 'olibSotdim'
        WHEN 'CurrencyRate' THEN 'currency'
        WHEN 'Shop' THEN CASE WHEN NEW."actorType" = 'SUPER_ADMIN' THEN 'adminShops' ELSE 'settings' END
        WHEN 'ShopAdmin' THEN CASE WHEN NEW."actorType" = 'SUPER_ADMIN' THEN 'adminShops' ELSE 'settings' END
        WHEN 'SuperAdmin' THEN 'settings'
        ELSE 'logs'
    END;

    event_operation := CASE
        WHEN NEW."action" IN ('DELETE', 'SOFT_DELETE') THEN 'deleted'
        WHEN NEW."action" IN ('CREATE', 'IMPORT') THEN 'created'
        WHEN NEW."action" IN ('PAYMENT', 'PAY') THEN 'updated'
        ELSE 'updated'
    END;

    event_kind := lower(NEW."targetType") || '.' || lower(NEW."action");
    admin_global := NEW."actorType" = 'SUPER_ADMIN'
        AND NEW."targetType" IN ('Shop', 'ShopAdmin', 'CurrencyRate');

    IF NEW."shopId" IS NOT NULL THEN
        INSERT INTO "ChangeEvent" (
            "scopeType", "scopeId", "domain", "entityType", "entityId",
            "operation", "mutationKind"
        ) VALUES (
            'SHOP', NEW."shopId", event_domain, NEW."targetType", NEW."targetId",
            event_operation, event_kind
        );
    END IF;

    IF admin_global OR NEW."shopId" IS NULL THEN
        INSERT INTO "ChangeEvent" (
            "scopeType", "scopeId", "domain", "entityType", "entityId",
            "operation", "mutationKind"
        ) VALUES (
            CASE WHEN NEW."targetType" = 'SuperAdmin' THEN 'ADMIN' ELSE 'GLOBAL' END,
            CASE WHEN NEW."targetType" = 'SuperAdmin' THEN NEW."actorId" ELSE 'GLOBAL' END,
            event_domain, NEW."targetType", NEW."targetId",
            event_operation, event_kind
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Log_incremental_change_event"
AFTER INSERT ON "Log"
FOR EACH ROW
EXECUTE FUNCTION "oryx_record_change_event_from_log"();
