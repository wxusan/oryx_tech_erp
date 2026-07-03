-- Remove the Telegram link-code flow. Telegram is now linked only by entering
-- the Telegram ID in the admin panel and sending /start to the bot.
-- Dropping the column also drops its unique index. Safe: nullable column, and
-- the codes it held are being abandoned by product decision. Apply with
-- `npm run prisma:migrate:deploy`.

DROP INDEX IF EXISTS "ShopAdmin_telegramLinkCode_key";

ALTER TABLE "ShopAdmin" DROP COLUMN IF EXISTS "telegramLinkCode";
