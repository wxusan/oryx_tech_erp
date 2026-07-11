-- Keep RETURNED for legacy records, but add an explicit lifecycle state for a
-- simple sale whose contract balance is still open. This migration is
-- additive-only and deliberately does not rewrite existing production rows.

ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'SOLD_DEBT';
