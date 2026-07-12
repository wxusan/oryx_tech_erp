-- READ ONLY. Review results before approving any manual production repair.

-- Ambiguous/unparsed legacy storage (bare numbers are intentionally not guessed).
SELECT "id", "shopId", "model", "storage"
FROM "Device"
WHERE "deletedAt" IS NULL
  AND "storage" IS NOT NULL
  AND ("storageAmount" IS NULL OR "storageUnit" IS NULL)
ORDER BY "shopId", "createdAt";

-- Legacy conditions that could not be mapped exactly to Yangi/B/U.
SELECT "id", "shopId", "model", "condition"
FROM "Device"
WHERE "deletedAt" IS NULL
  AND "conditionCode" IS NULL
ORDER BY "shopId", "createdAt";

-- Placeholder/invalid/colliding legacy primary IMEIs requiring review.
SELECT d."id", d."shopId", d."model", d."imei", i."normalizedValue", i."isLegacy"
FROM "Device" d
LEFT JOIN "DeviceImei" i
  ON i."deviceId" = d."id" AND i."slot" = 'PRIMARY' AND i."deletedAt" IS NULL
WHERE d."deletedAt" IS NULL
  AND (d."imei" LIKE 'IMPORT-%' OR d."imei" LIKE 'NOIMEI-%' OR i."normalizedValue" IS NULL)
ORDER BY d."shopId", d."createdAt";

-- Phone rows that were ambiguous or collided during canonicalization.
SELECT "id", "shopId", "name", "phone", "normalizedPhone"
FROM "Customer"
WHERE "phoneNormalizationNeedsReview" = true
ORDER BY "shopId", "createdAt";
