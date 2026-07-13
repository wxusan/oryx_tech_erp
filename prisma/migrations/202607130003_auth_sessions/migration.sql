-- Durable server-side session state.
-- Existing JWTs intentionally require one fresh login after this deployment;
-- no historical authentication data is inferred or backfilled.

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "shopId" TEXT,
  "sessionVersion" INTEGER NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_actor_shape_check" CHECK (
    ("actorType" = 'SUPER_ADMIN' AND "shopId" IS NULL)
    OR ("actorType" = 'SHOP_ADMIN' AND "shopId" IS NOT NULL)
  )
);

CREATE INDEX "AuthSession_actorType_actorId_revokedAt_idx"
  ON "AuthSession"("actorType", "actorId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "AuthSession_revokedAt_lastSeenAt_idx"
  ON "AuthSession"("revokedAt", "lastSeenAt");
