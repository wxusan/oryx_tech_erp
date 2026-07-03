# Security Audit Fixes

## P0

- Telegram ID saves no longer verify manually entered IDs. Existing verified IDs remain trusted; any new, changed, or cleared ID resets `telegramVerifiedAt` until that Telegram account sends `/start`.
- Sale overdue reminders now respect `reminderEnabled`.
- CSV exports prefix spreadsheet-formula strings with an apostrophe before escaping.
- Device returns cap `refundAmount` to money actually collected in Oryx.
- Shop subscription payments require an idempotency key and store it on `ShopPayment`.
- Nasiya defer/carry-over operations require an idempotency key and are recorded in `NasiyaDeferral`; no payment row is created for a defer.

## P1

- Dashboard/report labels now distinguish gross cash-in, net after refunds, refunds, expected payments, accrual profit, and nasiya interest.
- Cash-flow stats include actual payment rows even if the sale/nasiya was later returned or cancelled.
- Nasiya preview uses the same calculation and schedule helpers as the server.
- Imported old nasiya now blocks exact duplicate imports beyond IMEI.
- New device image writes accept only private storage keys under the resolved shop.
- Main create/payment/import schemas have bounded text fields; log date filters reject invalid dates.

## P2

- Passport and device image uploads verify file signatures for JPEG, PNG, and WebP before private storage upload.
- Large-file refactors were intentionally skipped because they were not required for the hardening fixes.

## Deployment Notes

- Run migrations with `npm run prisma:migrate:deploy`; do not use `prisma db push` on shared or production databases.
- New migration: `202607030006_audit_hardening_idempotency`.
- After deployment, ask admins who change Telegram IDs to send `/start` to the bot before expecting notifications.

## Remaining Risks

- No malware scanning or EXIF stripping is implemented yet.
- Live DB race/integration coverage is still represented by TODOs/source guards unless a dedicated test database is configured.
- Notification delivery remains at-least-once if a worker crashes after Telegram send but before marking a row sent.
