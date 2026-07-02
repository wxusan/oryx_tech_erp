ALTER TABLE "SuperAdmin"
ADD COLUMN "login" TEXT;

CREATE UNIQUE INDEX "SuperAdmin_login_key" ON "SuperAdmin"("login");
