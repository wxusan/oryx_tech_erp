# Telegram Message Style Guide

## Core format

Every Oryx ERP Telegram message follows this structure:

```html
<b>{one clear emoji} {title}</b>

{grouped normal-weight body}
```

- Exactly one bold element: the first-line title.
- Body text is never bold.
- Use one meaningful icon per label; avoid decorative emoji noise.
- Separate customer/device/payment groups with one blank line.
- Omit absent optional lines instead of showing empty values.

## Standard labels

Use these Uzbek labels consistently:

`Do‘kon`, `Qurilma`, `Xotira`, `Rang`, `Batareya`, `IMEI`, `Mijoz`,
`Tel`, `Sotilish narxi`, `To‘langan`, `Qolgan qarz`, `To‘lov usuli`,
`Foyda`, `Boshlang‘ich to‘lov`, `Nasiya foizi`, `Foiz summasi`,
`Nasiya jami`, `Muddat`, `Oylik to‘lov`, `Keyingi to‘lov`,
`To‘lov summasi`, `Qolgan to‘lov`, `Kechikkan`, `Yetkazib beruvchi`,
`Kimdan olindi`, `Olingan narx`, `Admin`, and `Izoh`.

Use typographic Uzbek apostrophes: `o‘`, `g‘`, and `so‘m`.

## Money display

- Show exactly one money currency: the shop's selected display currency.
- USD display: use `$...`; never show `so‘m`, `so'm`, or `(~...)`.
- UZS display: use `... so‘m`; never show `$` or `(~...)`.
- Do not show internal conversion text such as `Shartnomaga qo‘llandi` in
  Telegram payment confirmations. Internal ledgers still store the applied
  contract amount; Telegram shows the user-facing paid amount in display
  currency only.
- Historical payment messages convert with the payment's saved
  `paymentExchangeRate`; live remaining balances/reminders use the app's
  current display conversion rule.

## Standard icon mapping

| Meaning            | Icon   |
| ------------------ | ------ |
| Shop               | 🏪     |
| Device             | 📱     |
| Storage            | 💾     |
| Color              | 🎨     |
| Battery            | 🔋     |
| IMEI               | 🔢     |
| Customer           | 👤     |
| Phone              | 📞     |
| Amount/price       | 💵     |
| Paid               | 💰     |
| Remaining/deadline | ⏳     |
| Payment method     | 💳     |
| Date               | 📅 / 🗓 |
| Profit             | 📊     |
| Note               | 📝     |
| Admin              | 👨‍💼     |

## Split payments

Single method:

```txt
💳 To‘lov usuli: Naqd
```

Split method:

```txt
💳 To‘lov usuli:
• Naqd: 500 000 so‘m
• Karta: 500 000 so‘m
```

Never combine the single-method line and split breakdown.

## Reminder tone

- Early: `🔔` — informative and calm.
- Due today: `⏰` — clear immediate action.
- Overdue: `⚠️` — urgent without blaming the customer.
- Show the customer/device, amount, due date, and remaining/late days.

## HTML safety

- Sender and photo-caption delivery use `parse_mode: 'HTML'`.
- Only the static title contains HTML markup.
- Every dynamic string goes through `escapeTelegramHtml`.
- Escape `&`, `<`, `>`, `"`, and `'`.
- Do not add arbitrary user-provided HTML.
- Never include passport/customer-document images, raw storage URLs, tokens,
  logins, passwords, or database IDs.

## Photo captions

Photo captions use the exact same message as text delivery. A photo is selected
only when a safe device image exists and the raw HTML caption is at most 1,024
characters. Longer captions use `sendMessage`. A failed `sendPhoto` immediately
falls back to the same HTML message through `sendMessage`.
