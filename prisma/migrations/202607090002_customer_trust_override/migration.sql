-- Item 12 — nasiya client trust/rating system. The tier itself is computed
-- on read (src/lib/nasiya-customer-trust.ts) from nasiya history and is
-- never persisted. This column only stores an OPTIONAL admin override
-- ('NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'), null = use the
-- computed tier. Additive only, no drops/renames.

ALTER TABLE "Customer"
  ADD COLUMN "trustOverride" TEXT;
