-- Make shop-admin usernames globally unique so shop login only needs login + password.
DROP INDEX IF EXISTS "ShopAdmin_shopId_login_key";
CREATE UNIQUE INDEX "ShopAdmin_login_key" ON "ShopAdmin"("login");
