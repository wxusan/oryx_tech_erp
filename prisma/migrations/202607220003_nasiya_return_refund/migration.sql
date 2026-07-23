-- Nasiya physical return/refund is deliberately separate from early
-- settlement and from retired cancellation grants. Owners receive active
-- capabilities automatically; staff must be granted this destructive action
-- explicitly through the existing permissions UI.

BEGIN;

INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder", "isActive")
VALUES
  ('NASIYA_RETURN_REFUND', 'Nasiyani qaytarish va pulni qaytarish', 'Qurilmani omborga qaytarib, nasiya qarzini yopish va tasdiqlangan tushum chegarasida pul qaytarish', 'NASIYA', 167, TRUE)
ON CONFLICT ("code") DO UPDATE SET
  "nameUz" = EXCLUDED."nameUz",
  "descriptionUz" = EXCLUDED."descriptionUz",
  "featureCode" = EXCLUDED."featureCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
