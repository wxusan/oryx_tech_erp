# Telegram Message Inventory

Updated: 2026-07-09 after the HTML copy/design pass.

All messages use Telegram HTML. The first line is the only bold text, dynamic
values are escaped, and queued messages use the same HTML for `sendMessage` and
`sendPhoto` captions.

## Summary

| # | Function/template | Trigger | Receiver | Delivery |
|---:|---|---|---|---|
| 1 | `telegramIdUnavailableMessage` | `/start` without sender ID | Current chat | Direct HTML reply |
| 2 | `startSuperAdminMessage` | Recognised super admin `/start` | Current chat | Direct HTML reply |
| 3 | `startShopAdminMessage` | Recognised shop admin `/start` | Current chat | Direct HTML reply |
| 4 | `startUnknownMessage` | Unlinked `/start` | Current chat | Direct HTML reply |
| 5 | `unknownCommandMessage` | Unsupported slash command | Current chat | Direct HTML reply |
| 6 | `deviceAddedMessage` | Device created | Verified shop admins | Photo/text queue |
| 7 | `deviceSoldMessage` | Normal sale created | Verified shop admins | Photo/text queue |
| 8 | `deviceReturnedMessage` | Device returned | Verified shop admins | Photo/text queue |
| 9 | `deviceRestockedMessage` | Device restocked | Verified shop admins | Photo/text queue |
| 10 | `nasiyaCreatedMessage` | Nasiya created | Verified shop admins | Photo/text queue |
| 11 | `nasiyaPaymentMessage` | Positive nasiya payment | Verified shop admins | Photo/text queue |
| 12 | `nasiyaCompletedMessage` | Nasiya becomes completed | Verified shop admins | Photo/text queue |
| 13 | `nasiyaImportedMessage` | Historical nasiya imported | Verified shop admins | Photo/text queue |
| 14 | `nasiyaEarlyReminderMessage` | Configured days before due | Verified shop admins | Photo/text queue |
| 15 | `nasiyaDueTodayMessage` | Nasiya schedule due today | Verified shop admins | Photo/text queue |
| 16 | `nasiyaOverdueMessage` | Nasiya schedule overdue | Verified shop admins | Photo/text queue |
| 17 | `salePaymentMessage` | Later normal-sale payment | Verified shop admins | Photo/text queue |
| 18 | `saleEarlyReminderMessage` | Configured days before due | Verified shop admins | Photo/text queue |
| 19 | `saleDueTodayMessage` | Sale debt due today | Verified shop admins | Photo/text queue |
| 20 | `saleOverdueMessage` | Sale debt overdue | Verified shop admins | Photo/text queue |
| 21 | `olibSotdimCreatedMessage` | Olib-sotdim created | Verified shop admins | Photo/text queue |
| 22 | `supplierPayableEarlyReminderMessage` | Supplier debt approaching | Verified shop admins | Photo/text queue |
| 23 | `supplierPayableDueTodayMessage` | Supplier debt due today | Verified shop admins | Photo/text queue |
| 24 | `supplierPayableOverdueMessage` | Supplier debt overdue | Verified shop admins | Photo/text queue |
| 25 | `supplierPayablePaidMessage` | Supplier payable marked paid | Verified shop admins | Photo/text queue |

## Detailed inventory

Optional lines shown below disappear when their value is absent. Device groups
can include `Xotira`, `Rang`, `Batareya`, and `IMEI` as applicable.

### 1. Telegram ID unavailable

```html
<b>⚠️ Telegram ID aniqlanmadi</b>

Iltimos, botni shaxsiy Telegram akkauntingizdan oching.
```

### 2. Super-admin welcome

```html
<b>👋 Oryx ERP botiga xush kelibsiz</b>

👨‍💼 Admin: {adminName}

Siz Oryx ERP super admin sifatida ulandingiz.

Endi platformadagi muhim bildirishnomalar shu bot orqali keladi.
```

### 3. Shop-admin welcome

```html
<b>👋 Oryx ERP botiga xush kelibsiz</b>

👨‍💼 Admin: {adminName}
🏪 Do‘kon: {shopName}

Siz do‘kon bildirishnomalariga muvaffaqiyatli ulandingiz.

Endi sotuv, nasiya, to‘lov va eslatmalar shu yerga keladi.
```

### 4. Unlinked account

```html
<b>⚠️ Telegram akkaunt ulanmagan</b>

Telegram akkauntingiz Oryx ERP hisobiga ulanmagan.

Iltimos, admin panelda Telegram ID’ingiz to‘g‘ri kiritilganini tekshiring.

🆔 Telegram ID: {telegramId}
```

### 5. Unknown command

```html
<b>❓ Buyruq topilmadi</b>

Botdan foydalanish uchun /start buyrug‘ini yuboring.
```

### 6–9. Device messages

Titles:

- `<b>📦 Yangi qurilma qo‘shildi</b>`
- `<b>✅ Qurilma sotildi</b>`
- `<b>↩️ Qurilma qaytarildi</b>`
- `<b>🔄 Qurilma qayta sotuvga chiqarildi</b>`

Shared device body:

```txt
🏪 Do‘kon: {shopName}

📱 Qurilma: {deviceModel}
💾 Xotira: {storage}
🎨 Rang: {color}
🔋 Batareya: {batteryHealth}%
🔢 IMEI: {imei}
```

Device-added financial block:

```txt
💵 Olingan narx: {purchasePrice}
📞 Yetkazib beruvchi: {supplierPhone}
```

Device-sold customer/financial block:

```txt
👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

💵 Sotilish narxi: {salePrice}
💰 To‘langan: {paidAmount}
⏳ Qolgan qarz: {remainingAmount | Yo‘q}
💳 To‘lov usuli: {method}
📊 Foyda: {profit}
```

Return/restock note block:

```txt
💵 Qaytarilgan summa: {refundAmount}
💳 Qaytarish usuli: {refundMethod}

📝 Izoh: {note}
👨‍💼 Admin: {adminName}
```

### 10. Nasiya created

```html
<b>📝 Yangi nasiya yaratildi</b>

🏪 Do‘kon: {shopName}

👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

{device group}

💵 Sotilish narxi: {totalAmount}
💰 Boshlang‘ich to‘lov: {downPayment}
⏳ Qolgan qarz: {baseRemainingAmount}

📈 Nasiya foizi: {interestPercent}%
➕ Foiz summasi: {interestAmount}
📊 Nasiya jami: {finalNasiyaAmount}

📅 Muddat: {months} oy
💵 Oylik to‘lov: {monthlyPayment}
🗓 Keyingi to‘lov: {nextPaymentDate}

👨‍💼 Admin: {adminName}
```

At zero interest, the remaining/interest block disappears and `Nasiya jami`
stays in the main financial block.

### 11. Nasiya payment

```html
<b>💰 Nasiya to‘lovi qabul qilindi</b>

🏪 Do‘kon: {shopName}

👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

{device group without battery}

📆 Oy: {month | Bir nechta oy}
💰 To‘langan: {paidAmount}
🔄 Shartnomaga qo‘llandi: {contractAmount}
{payment method block}
⏳ Qolgan qarz: {remaining | To‘liq yopildi}

📋 To‘lov taqsimoti:
• {amount} joriy oy uchun yopildi
• {amount} {month}-oyga oldindan qo‘llandi

📝 Izoh: {note}
👨‍💼 Admin: {adminName}
```

`Shartnomaga qo‘llandi` appears only for cross-currency input. Allocation
lines appear only for multi-schedule payments.

Split payment:

```txt
💳 To‘lov usuli:
• Naqd: 500 000 so‘m
• Karta: 500 000 so‘m
```

### 12. Nasiya completed

```html
<b>✅ Nasiya yakunlandi</b>

🏪 Do‘kon: {shopName}

👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

{device group without battery}

💰 Jami to‘langan: {finalNasiyaAmount}

👨‍💼 Admin: {adminName}
```

### 13. Historical nasiya imported

```html
<b>📥 Eski nasiya import qilindi</b>

🏪 Do‘kon: {shopName}

👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

{device group without battery}

💵 Eski nasiya summasi: {originalTotalAmount}
💰 Importgacha to‘langan: {alreadyPaidBeforeImport}
⏳ Qolgan qarz: {remainingDebt}

💵 Oylik to‘lov: {monthlyPayment}
🗓 Keyingi to‘lov: {nextPaymentDate}

👨‍💼 Admin: {adminName}
```

### 14–16. Nasiya reminders

Titles:

- `<b>🔔 Nasiya to‘lovi yaqinlashmoqda</b>`
- `<b>⏰ Bugun to‘lov kuni</b>`
- `<b>⚠️ To‘lov muddati o‘tgan</b>`

Body:

```txt
👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

{device group without battery}

📆 Oy: {monthNumber}-oy
💵 To‘lov summasi / Qolgan to‘lov: {amount}
📅 Muddat: {date | Bugun}
⏳ Qoldi / Kechikkan: {days} kun
```

### 17–20. Normal-sale debt messages

Titles:

- `<b>💰 Qarz to‘lovi qabul qilindi</b>`
- `<b>🔔 Qarz to‘lovi yaqinlashmoqda</b>`
- `<b>⏰ Bugun to‘lov kuni</b>`
- `<b>⚠️ To‘lov muddati o‘tgan</b>`

Payment body supports the same single/split and same/cross-currency formats as
the nasiya payment. A completed sale debt says `Qolgan qarz: To‘liq yopildi`.
Reminder bodies use `To‘lov summasi`, `Qolgan to‘lov`, `Muddat`,
`Qoldi`, and `Kechikkan` consistently.

### 21. Olib-sotdim created

```html
<b>🔄 Olib-sotdim operatsiyasi</b>

🏪 Do‘kon: {shopName}

{device group}

🏬 Kimdan olindi: {supplierName}
📞 Yetkazib beruvchi: {supplierPhone}
📍 Manzil: {supplierLocation}

👤 Mijoz: {customerName}
📞 Tel: {customerPhone}

💵 Olingan narx: {purchasePrice}
💰 Sotilish narxi: {salePrice}
📊 Foyda / Kutilayotgan foyda: {profit}
💳 Yetkazib beruvchiga to‘lov: {hozir to‘landi | keyinroq to‘lanadi}

👨‍💼 Admin: {adminName}
```

### 22–25. Supplier payable messages

Titles:

- `<b>🔔 Yetkazib beruvchiga to‘lov yaqinlashmoqda</b>`
- `<b>📌 Yetkazib beruvchiga to‘lov</b>`
- `<b>⚠️ Yetkazib beruvchiga to‘lov muddati o‘tgan</b>`
- `<b>✅ Yetkazib beruvchiga to‘lov qilindi</b>`

Body:

```txt
{device group without battery}

🏬 Kimdan olindi: {supplierName}
📞 Yetkazib beruvchi: {supplierPhone}

💵 To‘lov summasi / Qolgan to‘lov: {contractAmount}
📅 Muddat: {date | Bugun}
⏳ Qoldi / Kechikkan: {days} kun
```

Paid confirmation additionally includes shop, `💰 To‘langan`,
`💳 To‘lov usuli`, and admin.

## Delivery and privacy

- Queued recipients remain verified active shop admins in the owning shop.
- Customers, suppliers, super admins, and Telegram groups do not receive queued
  business notifications.
- `sendMessage`, photo captions, and direct replies use HTML parse mode.
- Dynamic values are escaped before Telegram parses the HTML.
- A safe first device image is attached when available and the caption is at
  most 1,024 characters.
- A long caption uses text; failed photo delivery falls back to the same text.
- Only device images are eligible. Passport/customer-document images and raw
  private URLs are never included.
- Notification retries, deduplication, scheduling, and business triggers are
  unchanged.

## Not implemented

- Customer/supplier-facing Telegram delivery
- Telegram-group delivery
- Nasiya deferral notification
- Separate normal-sale completion message
- Partial or split supplier-payable payment
- Initial device-sale split-payment breakdown
