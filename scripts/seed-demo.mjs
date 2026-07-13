import bcrypt from 'bcrypt'
import { Client } from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const confirm = process.env.SEED_DEMO_CONFIRM === 'yes'
const resetDemo = process.env.SEED_DEMO_RESET === 'yes'
const password = process.env.SEED_DEMO_PASSWORD || 'Demo12345!'

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required')
}

if (!confirm) {
  throw new Error('Refusing to seed demo data. Re-run with SEED_DEMO_CONFIRM=yes')
}
if (Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('SEED_DEMO_PASSWORD must not exceed bcrypt\'s 72-byte UTF-8 limit')
}

const client = new Client({ connectionString })
const now = new Date()
const day = 24 * 60 * 60 * 1000

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function dateFromNow(days) {
  return new Date(now.getTime() + days * day)
}

function decimal(value) {
  return value.toFixed(2)
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '')
  return digits || null
}

async function insert(table, data) {
  const keys = Object.keys(data)
  const columns = keys.map((key) => `"${key}"`).join(', ')
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ')
  const values = keys.map((key) => data[key])

  await client.query(`insert into "${table}" (${columns}) values (${placeholders})`, values)
}

async function getSuperAdminId() {
  const demoLogin = 'demo-admin'
  const passwordHash = await bcrypt.hash(password, 12)
  const existingDemo = await client.query(
    'select id from "SuperAdmin" where login = $1 and "deletedAt" is null limit 1',
    [demoLogin],
  )

  if (existingDemo.rowCount) {
    await client.query(
      'update "SuperAdmin" set name = $1, login = $2, "passwordHash" = $3, "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now() where id = $4',
      ['Demo Super Admin', demoLogin, passwordHash, existingDemo.rows[0].id],
    )
    return existingDemo.rows[0].id
  }

  const superAdminId = id('sa')

  await insert('SuperAdmin', {
    id: superAdminId,
    name: 'Demo Super Admin',
    login: demoLogin,
    passwordHash,
    sessionVersion: 1,
    role: 'SUPER_ADMIN',
    createdAt: dateFromNow(-60),
    updatedAt: now,
  })

  return superAdminId
}

async function assertNoDemoData() {
  const result = await client.query(
    `select count(*)::int as count
     from "Shop"
     where name like 'Demo %' or name in ('Malika Mobile Pro', 'Smart House 77', 'iPoint Trade')`,
  )

  if (result.rows[0].count > 0 && !resetDemo) {
    throw new Error('Demo data already exists. Use SEED_DEMO_RESET=yes to replace demo records.')
  }
}

async function resetExistingDemoData() {
  const result = await client.query(
    `select id from "Shop"
     where name like 'Demo %' or name in ('Malika Mobile Pro', 'Smart House 77', 'iPoint Trade')`,
  )
  const shopIds = result.rows.map((row) => row.id)

  if (!shopIds.length) return

  // The ERP 2.0 owner invariant protects a current owner from deletion, and
  // package snapshots are immutable during normal application work. This
  // explicit, transaction-local maintenance flag only permits deleting demo
  // snapshots after SEED_DEMO_RESET=yes was confirmed above.
  await client.query("set local oryx.allow_package_snapshot_delete = 'on'")
  await client.query(
    `update "Shop"
     set "ownerAdminId" = null,
         "ownershipStatus" = 'UNMATCHED',
         "ownershipResolvedAt" = null,
         "ownershipResolvedById" = null
     where id = any($1)`,
    [shopIds],
  )
  await client.query('delete from "ChangeEvent" where "scopeType" = \'SHOP\' and "scopeId" = any($1)', [shopIds])
  await client.query('delete from "Log" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Notification" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "NasiyaPayment" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "NasiyaSchedule" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Nasiya" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "SalePayment" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "SupplierPayable" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Sale" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "DeviceReturn" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "DeviceImei" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Device" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Customer" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Supplier" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "ShopMemberPermission" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "ShopPayment" where "shopId" = any($1)', [shopIds])
  await client.query(
    `delete from "ShopPackageFeature"
     where "packageVersionId" in (
       select id from "ShopPackageVersion" where "shopId" = any($1)
     )`,
    [shopIds],
  )
  await client.query('delete from "ShopPackageVersion" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "ShopAdmin" where "shopId" = any($1)', [shopIds])
  await client.query('delete from "Shop" where id = any($1)', [shopIds])
}

async function createFullDemoPackage(shopId, superAdminId) {
  const packageVersionId = id('pkg')
  await insert('ShopPackageVersion', {
    id: packageVersionId,
    shopId,
    effectiveOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    basePrice: decimal(150000),
    currency: 'UZS',
    discountAmount: decimal(0),
    pricingNeedsReview: false,
    note: 'Demo full package',
    createdById: superAdminId,
    createdAt: now,
  })

  const features = await client.query(
    `select code from "FeatureDefinition" where "isActive" = true order by "sortOrder", code`,
  )
  for (const feature of features.rows) {
    await insert('ShopPackageFeature', {
      id: id('pkgf'),
      packageVersionId,
      featureCode: feature.code,
      enabled: true,
      recurringPrice: decimal(0),
    })
  }

  return packageVersionId
}

async function seedShop(superAdminId, index, shop) {
  const shopId = id('shop')
  const adminId = id('admin')
  const passwordHash = await bcrypt.hash(password, 12)

  await insert('Shop', {
    id: shopId,
    name: shop.name,
    ownerName: shop.ownerName,
    ownerPhone: shop.ownerPhone,
    shopNumber: shop.shopNumber,
    address: shop.address,
    note: shop.note,
    status: shop.status,
    subscriptionDue: dateFromNow(shop.subscriptionDays),
    telegramGroupId: shop.telegramGroupId,
    createdAt: dateFromNow(-55 + index),
    updatedAt: now,
    createdById: superAdminId,
  })

  await insert('ShopAdmin', {
    id: adminId,
    shopId,
    name: shop.adminName,
    phone: shop.adminPhone,
    login: shop.adminLogin,
    telegramId: shop.telegramId,
    telegramVerifiedAt: shop.telegramId ? dateFromNow(-12) : null,
    passwordHash,
    passwordChangedAt: dateFromNow(-30),
    sessionVersion: 1,
    isActive: true,
    createdAt: dateFromNow(-50 + index),
  })

  await client.query(
    `update "Shop"
     set "ownerAdminId" = $1,
         "ownershipStatus" = 'RESOLVED',
         "ownershipResolvedAt" = $2,
         "ownershipResolvedById" = $3
     where id = $4`,
    [adminId, now, superAdminId, shopId],
  )
  await createFullDemoPackage(shopId, superAdminId)

  await insert('ShopPayment', {
    id: id('spay'),
    shopId,
    amount: decimal(450000),
    months: 3,
    paymentMethod: 'TRANSFER',
    note: 'Demo subscription payment',
    paidAt: dateFromNow(-35),
    recordedById: superAdminId,
  })

  const supplierIds = []
  for (const supplier of shop.suppliers) {
    const supplierId = id('sup')
    supplierIds.push(supplierId)
    await insert('Supplier', {
      id: supplierId,
      shopId,
      name: supplier.name,
      phone: supplier.phone,
      note: supplier.note,
      createdAt: dateFromNow(-45),
    })
  }

  const customerIds = []
  for (const customer of shop.customers) {
    const customerId = id('cust')
    customerIds.push(customerId)
    await insert('Customer', {
      id: customerId,
      shopId,
      name: customer.name,
      phone: customer.phone,
      normalizedPhone: normalizePhone(customer.phone),
      passportPhotoUrl: customer.passportPhotoUrl,
      note: customer.note,
      createdAt: dateFromNow(customer.createdDays),
    })
  }

  const deviceIds = []
  for (const [deviceIndex, device] of shop.devices.entries()) {
    const deviceId = id('dev')
    deviceIds.push(deviceId)
    await insert('Device', {
      id: deviceId,
      shopId,
      model: device.model,
      color: device.color,
      storage: device.storage,
      batteryHealth: device.batteryHealth,
      purchasePrice: decimal(device.purchasePrice),
      imei: `${shop.imeiPrefix}${String(deviceIndex + 1).padStart(8, '0')}`,
      supplierId: supplierIds[deviceIndex % supplierIds.length],
      supplierPhone: shop.suppliers[deviceIndex % supplierIds.length].phone,
      imageUrls: device.imageUrls,
      status: device.status,
      addedBy: adminId,
      note: device.note,
      createdAt: dateFromNow(device.createdDays),
      updatedAt: now,
    })
  }

  for (const sale of shop.sales) {
    const saleId = id('sale')
    const remainingAmount = sale.salePrice - sale.amountPaid
    await insert('Sale', {
      id: saleId,
      shopId,
      deviceId: deviceIds[sale.deviceIndex],
      customerId: customerIds[sale.customerIndex],
      salePrice: decimal(sale.salePrice),
      paymentMethod: sale.paymentMethod,
      paidFully: sale.paidFully,
      amountPaid: decimal(sale.amountPaid),
      remainingAmount: decimal(remainingAmount),
      dueDate: sale.dueDays === null ? null : dateFromNow(sale.dueDays),
      reminderEnabled: sale.reminderEnabled,
      note: sale.note,
      contractCurrency: 'UZS',
      contractSalePrice: decimal(sale.salePrice),
      contractAmountPaid: decimal(sale.amountPaid),
      contractRemainingAmount: decimal(remainingAmount),
      createdAt: dateFromNow(sale.createdDays),
      createdBy: adminId,
    })

    if (sale.amountPaid > 0) {
      await insert('SalePayment', {
        id: id('salepay'),
        saleId,
        shopId,
        amount: decimal(sale.amountPaid),
        paymentMethod: sale.paymentMethod,
        paidAt: dateFromNow(sale.createdDays),
        note: 'Demo sale payment',
        appliedAmountInContractCurrency: decimal(sale.amountPaid),
        idempotencyKey: `demo-sale-${saleId}`,
        createdBy: adminId,
        createdAt: dateFromNow(sale.createdDays),
      })
    }
  }

  for (const plan of shop.nasiya) {
    const nasiyaId = id('nas')
    const baseRemainingAmount = plan.totalAmount - plan.downPayment
    const finalNasiyaAmount = plan.months * plan.monthlyPayment
    const paidAmountBeforeSeed = plan.paidMonths * plan.monthlyPayment + (plan.partialMonth ? plan.partialPaid : 0)
    const remainingAmount = finalNasiyaAmount - paidAmountBeforeSeed
    const interestAmount = finalNasiyaAmount - baseRemainingAmount
    await insert('Nasiya', {
      id: nasiyaId,
      shopId,
      deviceId: deviceIds[plan.deviceIndex],
      customerId: customerIds[plan.customerIndex],
      totalAmount: decimal(plan.totalAmount),
      downPayment: decimal(plan.downPayment),
      baseRemainingAmount: decimal(baseRemainingAmount),
      interestPercent: decimal(baseRemainingAmount > 0 ? (interestAmount / baseRemainingAmount) * 100 : 0),
      interestAmount: decimal(interestAmount),
      finalNasiyaAmount: decimal(finalNasiyaAmount),
      remainingAmount: decimal(remainingAmount),
      months: plan.months,
      monthlyPayment: decimal(plan.monthlyPayment),
      startDate: dateFromNow(plan.startDays),
      status: plan.status,
      reminderEnabled: true,
      note: plan.note,
      contractCurrency: 'UZS',
      contractTotalAmount: decimal(plan.totalAmount),
      contractDownPayment: decimal(plan.downPayment),
      contractBaseRemainingAmount: decimal(baseRemainingAmount),
      contractInterestAmount: decimal(interestAmount),
      contractFinalAmount: decimal(finalNasiyaAmount),
      contractMonthlyPayment: decimal(plan.monthlyPayment),
      contractRemainingAmount: decimal(remainingAmount),
      contractPaidAmount: decimal(paidAmountBeforeSeed),
      createdAt: dateFromNow(plan.startDays),
      createdBy: adminId,
      updatedAt: now,
    })

    for (let month = 1; month <= plan.months; month += 1) {
      const paidAmount =
        plan.paidMonths >= month ? plan.monthlyPayment : plan.partialMonth === month ? plan.partialPaid : 0
      const status =
        plan.paidMonths >= month
          ? 'PAID'
          : plan.partialMonth === month
            ? 'PARTIAL'
            : month <= plan.overdueUntilMonth
              ? 'OVERDUE'
              : 'PENDING'
      const scheduleId = id('sch')

      await insert('NasiyaSchedule', {
        id: scheduleId,
        nasiyaId,
        shopId,
        monthNumber: month,
        dueDate: dateFromNow(plan.startDays + month * 30),
        expectedAmount: decimal(plan.monthlyPayment),
        paidAmount: decimal(paidAmount),
        status,
        paidAt: paidAmount >= plan.monthlyPayment ? dateFromNow(plan.startDays + month * 30 - 2) : null,
        paymentMethod: paidAmount > 0 ? 'CARD' : null,
        delayedUntil: null,
        deferredToNext: false,
        note: status === 'OVERDUE' ? 'Demo overdue installment' : null,
        contractCurrency: 'UZS',
        contractExpectedAmount: decimal(plan.monthlyPayment),
        contractPaidAmount: decimal(paidAmount),
        contractRemainingAmount: decimal(plan.monthlyPayment - paidAmount),
        createdAt: dateFromNow(plan.startDays),
      })

      if (paidAmount > 0) {
        await insert('NasiyaPayment', {
          id: id('npay'),
          nasiyaId,
          nasiyaScheduleId: scheduleId,
          shopId,
          amount: decimal(paidAmount),
          paymentMethod: 'CARD',
          paidAt: dateFromNow(plan.startDays + month * 30 - 2),
          note: 'Demo installment payment',
          appliedAmountInContractCurrency: decimal(paidAmount),
          idempotencyKey: `demo-nasiya-${scheduleId}`,
          createdBy: adminId,
          createdAt: dateFromNow(plan.startDays + month * 30 - 2),
        })
      }
    }
  }

  for (const notification of shop.notifications) {
    await insert('Notification', {
      id: id('notif'),
      shopId,
      dedupeKey: `demo-${shopId}-${notification.relatedType}-${notification.relatedId}`,
      type: notification.type,
      message: notification.message,
      telegramId: shop.telegramId || 'demo-telegram',
      status: notification.status,
      scheduledAt: dateFromNow(notification.scheduledDays),
      sentAt: notification.status === 'SENT' ? dateFromNow(notification.scheduledDays) : null,
      attemptCount: notification.status === 'FAILED' ? 2 : 0,
      lastAttemptAt: notification.status === 'FAILED' ? dateFromNow(-1) : null,
      nextAttemptAt: notification.status === 'FAILED' ? dateFromNow(1) : null,
      lastError: notification.status === 'FAILED' ? 'Demo Telegram delivery failure' : null,
      relatedId: notification.relatedId,
      relatedType: notification.relatedType,
      createdAt: dateFromNow(notification.scheduledDays - 1),
    })
  }

  for (const action of ['CREATE_DEVICE', 'CREATE_SALE', 'CREATE_NASIYA', 'RECORD_PAYMENT']) {
    await insert('Log', {
      id: id('log'),
      shopId,
      actorId: adminId,
      actorType: 'SHOP_ADMIN',
      action,
      targetType: action.includes('NASIYA') ? 'Nasiya' : action.includes('SALE') ? 'Sale' : 'Device',
      targetId: shopId,
      oldValue: null,
      newValue: { demo: true, shop: shop.name },
      note: `Demo ${action.toLowerCase().replaceAll('_', ' ')}`,
      ipAddress: '127.0.0.1',
      createdAt: dateFromNow(-Math.floor(Math.random() * 20)),
    })
  }

  return { shopId, adminLogin: shop.adminLogin }
}

const shops = [
  {
    name: 'Malika Mobile Pro',
    ownerName: 'Azizbek Karimov',
    ownerPhone: '+998901112233',
    shopNumber: 'A-17',
    address: 'Malika Bazar, A blok, 17-dokon',
    note: 'Demo: high volume phone reseller',
    status: 'ACTIVE',
    subscriptionDays: 42,
    telegramGroupId: '-100111222333',
    adminName: 'Dilshod Admin',
    adminPhone: '+998909998877',
    adminLogin: 'malika-demo',
    telegramId: '901001001',
    imeiPrefix: '35678910',
    suppliers: [
      { name: 'Dubai Phone Wholesale', phone: '+971501112233', note: 'iPhone and Samsung stock' },
      { name: 'Tashkent Smart Import', phone: '+998977771122', note: 'Accessories and used phones' },
    ],
    customers: [
      { name: 'Madina Rasulova', phone: '+998901234567', note: 'Reliable repeat customer', passportPhotoUrl: null, createdDays: -38 },
      { name: 'Javohir Sobirov', phone: '+998935551144', note: 'Nasiya customer', passportPhotoUrl: null, createdDays: -32 },
      { name: 'Shahnoza Aliyeva', phone: '+998977778899', note: 'Asked for Telegram reminders', passportPhotoUrl: null, createdDays: -21 },
    ],
    devices: [
      { model: 'iPhone 15 Pro', color: 'Natural Titanium', storage: '256GB', batteryHealth: 100, purchasePrice: 11800000, status: 'SOLD_CASH', imageUrls: [], note: 'Demo cash sale', createdDays: -34 },
      { model: 'Samsung Galaxy S24 Ultra', color: 'Black', storage: '512GB', batteryHealth: 100, purchasePrice: 10900000, status: 'SOLD_NASIYA', imageUrls: [], note: 'Demo installment sale', createdDays: -31 },
      { model: 'iPhone 14 Pro Max', color: 'Deep Purple', storage: '256GB', batteryHealth: 91, purchasePrice: 8200000, status: 'IN_STOCK', imageUrls: [], note: 'Used, clean condition', createdDays: -12 },
      { model: 'MacBook Air M2', color: 'Midnight', storage: '512GB', batteryHealth: 98, purchasePrice: 10400000, status: 'IN_STOCK', imageUrls: [], note: 'Demo inventory device', createdDays: -8 },
      { model: 'iPhone 13', color: 'Blue', storage: '128GB', batteryHealth: 87, purchasePrice: 5200000, status: 'RETURNED', imageUrls: [], note: 'Demo returned device', createdDays: -20 },
    ],
    sales: [
      { deviceIndex: 0, customerIndex: 0, salePrice: 13300000, paymentMethod: 'CARD', paidFully: true, amountPaid: 13300000, dueDays: null, reminderEnabled: false, note: 'Fully paid demo sale', createdDays: -28 },
    ],
    nasiya: [
      { deviceIndex: 1, customerIndex: 1, totalAmount: 12800000, downPayment: 3000000, remainingAmount: 6800000, months: 4, monthlyPayment: 2450000, startDays: -95, status: 'ACTIVE', paidMonths: 1, partialMonth: 2, partialPaid: 1200000, overdueUntilMonth: 3, appleIdNote: 'Apple ID checked', note: 'Demo overdue nasiya plan' },
    ],
    notifications: [
      { type: 'NASIYA_REMINDER', message: 'Javohir Sobirov uchun nasiya tolovi yaqinlashmoqda.', status: 'PENDING', scheduledDays: 1, relatedId: 'demo-nasiya', relatedType: 'Nasiya' },
      { type: 'SALE_PAYMENT', message: 'Madina Rasulova tolovi qabul qilindi.', status: 'SENT', scheduledDays: -27, relatedId: 'demo-sale', relatedType: 'Sale' },
    ],
  },
  {
    name: 'Smart House 77',
    ownerName: 'Bekzod Usmonov',
    ownerPhone: '+998977002244',
    shopNumber: 'B-04',
    address: 'Malika Bazar, B blok, 4-dokon',
    note: 'Demo: mixed phones and laptops',
    status: 'ACTIVE',
    subscriptionDays: 9,
    telegramGroupId: null,
    adminName: 'Nodira Admin',
    adminPhone: '+998991010203',
    adminLogin: 'smart-demo',
    telegramId: null,
    imeiPrefix: '86753090',
    suppliers: [
      { name: 'Seoul Gadget Line', phone: '+821055551111', note: 'Android devices' },
      { name: 'Local Trade Group', phone: '+998901919191', note: 'Local supplier' },
    ],
    customers: [
      { name: 'Otabek Mirzayev', phone: '+998909090901', note: 'Bought laptop', passportPhotoUrl: null, createdDays: -18 },
      { name: 'Nilufar Komilova', phone: '+998974445566', note: 'Partial cash sale', passportPhotoUrl: null, createdDays: -14 },
      { name: 'Sardor Ahmedov', phone: '+998936667788', note: 'Installment plan', passportPhotoUrl: null, createdDays: -9 },
    ],
    devices: [
      { model: 'Samsung Galaxy A55', color: 'Iceblue', storage: '256GB', batteryHealth: 100, purchasePrice: 3600000, status: 'SOLD_CASH', imageUrls: [], note: 'Partial payment demo', createdDays: -16 },
      { model: 'MacBook Pro 14 M3', color: 'Space Black', storage: '1TB', batteryHealth: 100, purchasePrice: 20700000, status: 'SOLD_NASIYA', imageUrls: [], note: 'Premium installment demo', createdDays: -11 },
      { model: 'iPad Air 5', color: 'Starlight', storage: '256GB', batteryHealth: 96, purchasePrice: 6200000, status: 'IN_STOCK', imageUrls: [], note: 'Display unit', createdDays: -7 },
      { model: 'AirPods Pro 2', color: 'White', storage: null, batteryHealth: 100, purchasePrice: 1900000, status: 'IN_STOCK', imageUrls: [], note: 'Accessories stock', createdDays: -3 },
    ],
    sales: [
      { deviceIndex: 0, customerIndex: 1, salePrice: 4350000, paymentMethod: 'CASH', paidFully: false, amountPaid: 2500000, dueDays: 5, reminderEnabled: true, note: 'Demo receivable sale', createdDays: -6 },
    ],
    nasiya: [
      { deviceIndex: 1, customerIndex: 2, totalAmount: 24200000, downPayment: 6200000, remainingAmount: 18000000, months: 6, monthlyPayment: 3000000, startDays: -35, status: 'ACTIVE', paidMonths: 1, partialMonth: 0, partialPaid: 0, overdueUntilMonth: 0, appleIdNote: null, note: 'Healthy active plan' },
    ],
    notifications: [
      { type: 'SALE_DUE', message: 'Nilufar Komilova boyicha qolgan tolov muddati yaqin.', status: 'PENDING', scheduledDays: 2, relatedId: 'demo-sale', relatedType: 'Sale' },
      { type: 'TELEGRAM', message: 'Telegram boglash kutilmoqda.', status: 'FAILED', scheduledDays: -1, relatedId: 'demo-admin', relatedType: 'ShopAdmin' },
    ],
  },
  {
    name: 'iPoint Trade',
    ownerName: 'Murod Juraev',
    ownerPhone: '+998935005500',
    shopNumber: 'C-22',
    address: 'Malika Bazar, C blok, 22-dokon',
    note: 'Demo: suspended shop to preview admin states',
    status: 'SUSPENDED',
    subscriptionDays: -6,
    telegramGroupId: '-100999888777',
    adminName: 'Kamola Admin',
    adminPhone: '+998907770077',
    adminLogin: 'ipoint-demo',
    telegramId: '902002002',
    imeiPrefix: '35911122',
    suppliers: [
      { name: 'Apple Parts Asia', phone: '+8613800138000', note: 'Apple-focused supplier' },
      { name: 'Malika Used Stock', phone: '+998998887766', note: 'Used local devices' },
    ],
    customers: [
      { name: 'Diyorbek Hamidov', phone: '+998901212121', note: 'Overdue example', passportPhotoUrl: null, createdDays: -70 },
      { name: 'Gulnoza Ergasheva', phone: '+998939191919', note: 'Completed customer', passportPhotoUrl: null, createdDays: -48 },
      { name: 'Bobur Qodirov', phone: '+998977070707', note: 'New lead', passportPhotoUrl: null, createdDays: -5 },
    ],
    devices: [
      { model: 'iPhone 12 Pro', color: 'Graphite', storage: '128GB', batteryHealth: 84, purchasePrice: 4100000, status: 'SOLD_NASIYA', imageUrls: [], note: 'Older overdue plan', createdDays: -68 },
      { model: 'iPhone 15', color: 'Pink', storage: '128GB', batteryHealth: 100, purchasePrice: 8900000, status: 'SOLD_CASH', imageUrls: [], note: 'Completed sale', createdDays: -43 },
      { model: 'Apple Watch Series 9', color: 'Midnight', storage: null, batteryHealth: 100, purchasePrice: 3300000, status: 'IN_STOCK', imageUrls: [], note: 'Watch stock', createdDays: -4 },
    ],
    sales: [
      { deviceIndex: 1, customerIndex: 1, salePrice: 10100000, paymentMethod: 'TRANSFER', paidFully: true, amountPaid: 10100000, dueDays: null, reminderEnabled: false, note: 'Demo transfer sale', createdDays: -40 },
    ],
    nasiya: [
      { deviceIndex: 0, customerIndex: 0, totalAmount: 5900000, downPayment: 900000, remainingAmount: 2000000, months: 5, monthlyPayment: 1000000, startDays: -160, status: 'OVERDUE', paidMonths: 3, partialMonth: 4, partialPaid: 500000, overdueUntilMonth: 5, appleIdNote: 'Old Apple ID removed', note: 'Strong overdue demo state' },
    ],
    notifications: [
      { type: 'OVERDUE', message: 'Diyorbek Hamidov boyicha kechikkan tolov bor.', status: 'PENDING', scheduledDays: 0, relatedId: 'demo-overdue', relatedType: 'Nasiya' },
      { type: 'SHOP_SUBSCRIPTION', message: 'iPoint Trade obunasi muddati tugagan.', status: 'SENT', scheduledDays: -5, relatedId: 'demo-shop', relatedType: 'Shop' },
    ],
  },
]

await client.connect()

try {
  await client.query('begin')
  await assertNoDemoData()
  if (resetDemo) await resetExistingDemoData()

  const superAdminId = await getSuperAdminId()
  const seeded = []

  for (const [index, shop] of shops.entries()) {
    seeded.push(await seedShop(superAdminId, index, shop))
  }

  await insert('Log', {
    id: id('log'),
    shopId: null,
    actorId: superAdminId,
    actorType: 'SUPER_ADMIN',
    action: 'SEED_DEMO',
    targetType: 'Database',
    targetId: 'demo',
    oldValue: null,
    newValue: { shops: seeded.map((item) => item.shopId) },
    note: 'Created demo data for visual QA',
    ipAddress: '127.0.0.1',
    createdAt: now,
  })

  await client.query('commit')

  console.log('Demo data seeded successfully.')
  console.log(`Shop admin password for all demo shops: ${password}`)
  for (const item of seeded) {
    console.log(`- ${item.adminLogin}`)
  }
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
