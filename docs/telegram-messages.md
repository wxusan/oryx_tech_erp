# Telegram Message Catalog

All Telegram messages are plain text (no Markdown / `parse_mode`) built by the
centralized template layer in [`src/lib/telegram-templates.ts`](../src/lib/telegram-templates.ts).
Money is grouped `ru-RU` style (`8 500 000 so'm`); dates are `dd.mm.yyyy`.
Optional lines are omitted when empty — never rendered as `undefined`/`null`.

**Connection model:** an admin enters their Telegram ID in the panel, then sends
`/start` to the bot. The bot matches the ID to an active SuperAdmin/ShopAdmin and
replies. **There is no `/link` code flow** (removed — see bottom).

**Recipient rule (event & cron messages):** every active, non-deleted shop admin
with a **verified** `telegramId` (`telegramVerifiedAt` set). Cross-shop isolation
is enforced by `shopId` scoping.

**Delivery:** event messages are written as `Notification` rows inside the
mutation transaction and flushed by `processPendingNotifications()` after the
response (cron is the retry backstop). Cron messages are upserted with a
`dedupeKey` (idempotent per day). Bot replies are sent directly.

---

## Bot direct replies (`/api/telegram/webhook`)

### 1. `/start` — super admin
Sent when a super admin's Telegram ID is recognised.
```
👋 Assalomu alaykum, {adminName}

Siz Oryx ERP super admin sifatida ulandingiz.

Endi platformadagi muhim bildirishnomalar shu bot orqali keladi.
```
Fields: `adminName`.

### 2. `/start` — shop admin
Sent when a shop admin's Telegram ID is recognised.
```
👋 Assalomu alaykum, {adminName}

Siz {shopName} do'koni uchun Oryx ERP bildirishnomalariga ulandingiz.

Endi sotuv, nasiya, to'lov va eslatmalar shu yerga keladi.
```
Fields: `adminName`, `shopName`.

### 3. `/start` — unknown user
Sent when the Telegram ID is not found.
```
⚠️ Telegram akkauntingiz Oryx ERP hisobiga ulanmagan.

Iltimos, admin panelda Telegram ID'ingiz to'g'ri kiritilganini tekshiring.
```

### 4. Unknown command
Any unsupported `/command`.
```
❓ Bu buyruq mavjud emas.

Botdan foydalanish uchun /start yuboring.
```

---

## Device messages

### 5. Device added — `/api/devices` (POST)
```
📦 Yangi qurilma qo'shildi

Do'kon: {shopName}

Qurilma: {deviceModel}
Xotira: {storage}          (optional)
Rang: {color}              (optional)
Batareya: {batteryHealth}% (optional)
IMEI: {imei}               (optional)

Kelish narxi: {purchasePrice} so'm
Yetkazib beruvchi: {supplierPhone}  (optional)

Admin: {adminName}         (optional)
```

### 6. Device sold — `/api/devices/[id]/sell`
```
✅ Qurilma sotildi

Do'kon: {shopName}

<device specs incl. Batareya>

Mijoz: {customerName}
Tel: {customerPhone}       (optional)

Sotuv narxi: {salePrice} so'm
To'langan: {paidAmount} so'm
Qolgan qarz: {remaining} so'm   → "Yo'q" when fully paid
To'lov usuli: {paymentMethod}   (optional)

Admin: {adminName}         (optional)
```

### 7. Device returned — `/api/devices/[id]/return`
```
↩️ Qurilma qaytarildi

Do'kon: {shopName}

<device specs incl. Batareya>

Qaytarilgan summa: {refundAmount} so'm   (shows "0 so'm" if zero)
Qaytarish usuli: {refundMethod}          (omitted when refund 0 and no method)

Sabab: {note}
Admin: {adminName}         (optional)
```

### 8. Device restocked — `/api/devices/[id]/restock`
```
🔄 Qurilma qayta sotuvga chiqarildi

Do'kon: {shopName}

<device specs incl. Batareya>

Sabab: {note}
Admin: {adminName}         (optional)
```

---

## Nasiya messages

### 9 / 10. Nasiya created — `/api/devices/[id]/nasiya`
Interest lines appear only when `interestPercent > 0`.
```
📝 Yangi nasiya yaratildi

Do'kon: {shopName}

Mijoz: {customerName}
Tel: {customerPhone}       (optional)

<device specs incl. Batareya>

Narx: {totalAmount} so'm
Boshlang'ich to'lov: {downPayment} so'm
Qolgan summa: {baseRemainingAmount} so'm   (only when interest > 0)

Nasiya foizi: {interestPercent}%           (only when interest > 0)
Foiz summasi: {interestAmount} so'm         (only when interest > 0)
Nasiya jami: {finalNasiyaAmount} so'm

Muddat: {months} oy
Oylik to'lov: {monthlyPayment} so'm
Keyingi to'lov: {nextPaymentDate}

Admin: {adminName}         (optional)
```

### 11. Nasiya payment received — `/api/nasiya/[id]/payment`
No raw nasiya ID. Battery line omitted.
```
💰 Nasiya to'lovi qabul qilindi

Do'kon: {shopName}

Mijoz: {customerName}
Tel: {customerPhone}       (optional)

Qurilma / Xotira / Rang / IMEI

Oy: {monthNumber}-oy       → "Bir nechta oy" if several schedules paid
To'langan: {paidAmount} so'm
To'lov usuli: {paymentMethod}   (optional)
Qolgan qarz: {remaining} so'm   → "To'liq yopildi" when cleared

Izoh: {note}               (optional)
Admin: {adminName}         (optional)
```

### 13. Nasiya due today — cron `/api/cron/reminders`
```
⏰ Bugun nasiya to'lovi kuni

Mijoz: {customerName}
Tel: {customerPhone}

Qurilma / Xotira / Rang / IMEI

Oy: {monthNumber}-oy       (optional)
To'lov summasi: {amountDue} so'm
Muddat: {dueDate}          (effective date = delayedUntil ?? dueDate)
```

### 14. Nasiya overdue — cron
```
⚠️ Nasiya to'lovi muddati o'tgan

Mijoz / Tel / device specs (no battery)

Oy: {monthNumber}-oy       (optional)
Qolgan to'lov: {amountDue} so'm
Muddat: {dueDate}
Kechikkan: {daysLate} kun   (from effective due date)
```

---

## Normal sale debt messages

### 15. Sale debt payment received — `/api/sales/[id]/payment`
```
💰 Qarz to'lovi qabul qilindi

Do'kon: {shopName}

Mijoz / Tel (optional) / device specs (no battery)

To'langan: {paidAmount} so'm
To'lov usuli: {paymentMethod}   (optional)
Qolgan qarz: {remaining} so'm   → "To'liq yopildi" when cleared

Izoh: {note}               (optional)
Admin: {adminName}         (optional)
```

### 16. Sale debt due today — cron
```
⏰ Bugun qarz to'lovi kuni

Mijoz / Tel / device specs (no battery)

To'lov summasi: {remainingAmount} so'm
Muddat: {dueDate}
```

### 17. Sale debt overdue — cron
```
⚠️ Qarz to'lovi muddati o'tgan

Mijoz / Tel / device specs (no battery)

Qolgan qarz: {remainingAmount} so'm
Muddat: {dueDate}
Kechikkan: {daysLate} kun
```

---

## Privacy

Messages never include: passport image URLs, signed/private storage URLs,
passwords, logins, tokens/secrets, database URLs, or raw internal DB IDs
(enforced by tests in `tests/telegram.test.ts`).

## Intentionally removed

- **`/link CODE` flow** — no `/link` command, no code generation/validation, no
  expired/used codes, no `telegramLinkCode` column. Telegram is linked only by
  entering the Telegram ID in the panel and sending `/start`.

## Future / not currently sent

- **12. Nasiya delayed/deferred** — the carry-over route (`deferredToNext`,
  amount 0) currently has **no idempotency key**, so a re-submitted defer could
  duplicate a notification. Not wired until the defer path is made idempotent.
- Device edited / device deleted, shop created / suspended / reactivated,
  subscription payment, ops/error alerts — deliberately not sent as Telegram
  messages.
