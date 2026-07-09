# Telegram Message Copy Review

Review date: 2026-07-09.

## Result

All 25 user-visible Telegram messages were revised into one consistent,
business-friendly Uzbek system:

- 5 bot/start replies
- 4 device messages
- 7 nasiya messages
- 4 normal-sale messages
- 1 olib-sotdim message
- 4 supplier-payable messages

## Decisions applied

| Area           | Previous state              | Current state                                                   |
| -------------- | --------------------------- | --------------------------------------------------------------- |
| Titles         | Plain text                  | One bold HTML title with a clear icon                           |
| Body           | Mixed label styles          | Normal-weight grouped sections                                  |
| Apostrophes    | Mostly ASCII `'`            | Uzbek typography `‘/’` in visible copy                          |
| Dynamic values | Not HTML-escaped            | Escaped through `escapeTelegramHtml`                            |
| Delivery       | No parse mode               | `parse_mode: 'HTML'` for messages, captions, and direct replies |
| Split payment  | Comma-separated inline text | Multi-line bullet list                                          |
| Due today      | Repeated date               | Clear `Muddat: Bugun`                                           |
| Notes          | Mixed `Sabab`/`Izoh`        | Consistent `Izoh`                                               |
| Device price   | `Kelish narxi`              | `Olingan narx`                                                  |
| Sale price     | `Sotuv narxi`               | `Sotilish narxi`                                                |

## Business logic intentionally unchanged

- Recipients and shop isolation
- Notification types and triggers
- Reminder scheduling/deduplication
- Payment, debt, profit, and currency calculations
- Device-image lookup and private-storage rules
- Photo-versus-text caption limit decision
- Photo failure fallback and notification retries

## Variant review

- Full payment: `Qolgan qarz: To‘liq yopildi`
- Partial payment: formatted remaining debt
- Split payment: bullet list, one method per line
- Cross-currency: user-facing message shows only the shop display currency;
  internal applied contract amount is not shown as a second money line
- Multi-month nasiya: separate allocation bullet block
- Notes: included only when non-empty and HTML-escaped
- Optional device fields: omitted cleanly
- Early/due/overdue reminders: consistent customer/device/amount/date grouping
- Image caption and text delivery: identical improved message body

## Known product boundaries

- Initial device-sale creation does not carry a split-payment breakdown.
- Supplier payables remain all-or-nothing; no partial supplier-payment message.
- Customers and suppliers do not receive Telegram messages; messages go to
  verified shop admins.
- Super admins only receive their direct `/start` welcome.
