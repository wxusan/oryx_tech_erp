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
11. In a USD shop, open a return for a UZS-native Sale and Nasiya. Confirm every amount and the editable refund show only USD, then complete a cash refund for an original card receipt.
12. In a UZS shop, open a return for a USD-native contract. Confirm every amount and the editable refund show only UZS.
13. Change the shop currency or governed USD/UZS quote after opening the return modal. Confirm submission is rejected as stale and no device/contract/return row changes.
14. Refund a full USD-native receipt in UZS after the rate increased. Confirm the return succeeds, the exact UZS input and frozen rate provenance are exported, and the FX loss reduces actual profit.
15. Double-submit a shop subscription payment with the same idempotency key. Confirm one `ShopPayment` row and one due-date extension.
16. Double-submit a nasiya carry-over with the same idempotency key. Confirm the date changes once, no `NasiyaPayment` row is created, and one deferral ledger row exists.
17. Import an old nasiya with blank IMEI. Repeat with the same customer phone, model, remaining debt, monthly payment, and original sale date. Confirm the duplicate is blocked.
18. Create a nasiya with uneven division. Confirm the preview schedule sum equals the created schedule sum and the last month absorbs the remainder.
19. Upload a valid JPG/PNG/WEBP device image. Confirm it displays through `/api/uploads/device`.
20. Try to create a device with an external `https://...` image URL. Confirm the API rejects it.
21. Try uploading SVG/HTML content renamed as `.png`. Confirm upload is rejected.
22. Attempt cross-shop device/image access as a Shop Admin. Confirm it is forbidden.
23. Review dashboard and reports. Confirm gross cash, net cash, refunds, expected payments, accrual profit, and nasiya interest are clearly labeled.
