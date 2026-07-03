# Manual QA Checklist

Use a staging database with disposable shop/customer data.

1. Change a Super Admin Telegram ID. Confirm the profile shows unverified and no notifications are sent.
2. Send `/start` from that Telegram account. Confirm the bot welcomes the admin and notifications resume.
3. Change a Shop Admin Telegram ID. Confirm it resets to unverified until `/start`.
4. Send `/start` from an unknown Telegram account. Confirm the reply includes that Telegram ID and does not link anything.
5. Disable a partial sale reminder. Run the cron route for due and overdue dates. Confirm no sale reminder notification is queued.
6. Export CSV rows containing `=HYPERLINK(...)`, `+SUM(...)`, `-10`, `@cmd`, and `+998...`. Confirm cells are apostrophe-prefixed in CSV.
7. Return a cash sale with refund `0`. Confirm it succeeds.
8. Return a cash sale with refund equal to collected money. Confirm it succeeds.
9. Try refund greater than collected money. Confirm it is rejected with the Uzbek cap error.
10. Return an imported old nasiya with no post-import payments. Confirm any positive refund is rejected.
11. Double-submit a shop subscription payment with the same idempotency key. Confirm one `ShopPayment` row and one due-date extension.
12. Double-submit a nasiya carry-over with the same idempotency key. Confirm the date changes once, no `NasiyaPayment` row is created, and one deferral ledger row exists.
13. Import an old nasiya with blank IMEI. Repeat with the same customer phone, model, remaining debt, monthly payment, and original sale date. Confirm the duplicate is blocked.
14. Create a nasiya with uneven division. Confirm the preview schedule sum equals the created schedule sum and the last month absorbs the remainder.
15. Upload a valid JPG/PNG/WEBP device image. Confirm it displays through `/api/uploads/device`.
16. Try to create a device with an external `https://...` image URL. Confirm the API rejects it.
17. Try uploading SVG/HTML content renamed as `.png`. Confirm upload is rejected.
18. Attempt cross-shop device/image access as a Shop Admin. Confirm it is forbidden.
19. Review dashboard and reports. Confirm gross cash, net cash, refunds, expected payments, accrual profit, and nasiya interest are clearly labeled.
