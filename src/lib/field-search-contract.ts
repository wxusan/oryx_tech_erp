/**
 * Oryx ERP 2.0 field/search contract.
 *
 * This is intentionally executable metadata, not a prose checklist. A new
 * mutation form or search surface must be registered here and in the source
 * inventory test. Requiredness describes the submitted command (not whether
 * a database column happens to be nullable for legacy compatibility).
 */

export type FieldRequirement = 'ALWAYS' | 'CONDITIONAL' | 'OPTIONAL'
export type FieldClassification =
  | 'BUSINESS_IDENTIFIER'
  | 'DATE_FILTER'
  | 'MONEY'
  | 'PRIVATE_DOCUMENT'
  | 'SECRET'
  | 'STATUS_FILTER'
  | 'TEXT'

export interface FormFieldContract {
  /** Stable operation-qualified identifier used by tests and documentation. */
  id: string
  /** JSON/request field name. Dot notation represents nested/repeated data. */
  submittedKey: string
  requirement: FieldRequirement
  requiredWhen?: string
  classification: FieldClassification
  /** Search/filter surfaces where this identifier is intentionally reusable. */
  searchSurfaceIds?: readonly string[]
  /** Required when an identifier is deliberately not searchable. */
  noSearchReason?: string
}

export interface FormSurfaceContract {
  id: string
  source: string
  endpoint: string
  schemaSource: string
  fields: readonly FormFieldContract[]
}

export interface SearchSurfaceContract {
  id: string
  source: string
  endpoint: string
  /** Transport used for search/filter values. Protected documents use JSON_BODY. */
  transport: 'QUERY' | 'JSON_BODY'
  /** Search and explicit filter parameters only; pagination is intentionally omitted. */
  parameters: readonly string[]
  searchableFields: readonly string[]
  scope: 'SHOP_SESSION' | 'SUPER_ADMIN'
  privacy: string
}

const field = (
  operation: string,
  submittedKey: string,
  requirement: FieldRequirement,
  classification: FieldClassification = 'TEXT',
  options: Pick<FormFieldContract, 'requiredWhen' | 'searchSurfaceIds' | 'noSearchReason'> = {},
): FormFieldContract => ({
  id: `${operation}.${submittedKey}`,
  submittedKey,
  requirement,
  classification,
  ...options,
})

const always = (
  operation: string,
  submittedKey: string,
  classification?: FieldClassification,
  options?: Pick<FormFieldContract, 'searchSurfaceIds' | 'noSearchReason'>,
) => field(operation, submittedKey, 'ALWAYS', classification, options)

const optional = (
  operation: string,
  submittedKey: string,
  classification?: FieldClassification,
  options?: Pick<FormFieldContract, 'searchSurfaceIds' | 'noSearchReason'>,
) => field(operation, submittedKey, 'OPTIONAL', classification, options)

const conditional = (
  operation: string,
  submittedKey: string,
  requiredWhen: string,
  classification?: FieldClassification,
  options?: Pick<FormFieldContract, 'searchSurfaceIds' | 'noSearchReason'>,
) => field(operation, submittedKey, 'CONDITIONAL', classification, { ...options, requiredWhen })

export const FORM_SURFACE_CONTRACT = [
  {
    id: 'auth.superadmin.login',
    source: 'src/components/auth/role-login-form.tsx',
    endpoint: 'NextAuth credentials:superadmin',
    schemaSource: 'src/lib/auth.ts#authConfig.providers.superadmin.authorize',
    fields: [
      always('auth.superadmin.login', 'login', 'SECRET', { noSearchReason: 'Authentication identifiers are never exposed through business search.' }),
      always('auth.superadmin.login', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
    ],
  },
  {
    id: 'auth.shop.login',
    source: 'src/components/auth/role-login-form.tsx',
    endpoint: 'NextAuth credentials:shopadmin',
    schemaSource: 'src/lib/auth.ts#authConfig.providers.shopadmin.authorize',
    fields: [
      always('auth.shop.login', 'login', 'SECRET', { noSearchReason: 'Authentication identifiers are never exposed through business search.' }),
      always('auth.shop.login', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      optional('auth.shop.login', 'rememberMe', 'STATUS_FILTER'),
    ],
  },
  {
    id: 'admin.profile.update',
    source: 'src/app/(admin)/admin/settings/settings-client.tsx',
    endpoint: 'PATCH /api/admin/profile',
    schemaSource: 'src/app/api/admin/profile/route.ts#updateProfileSchema',
    fields: [always('admin.profile.update', 'name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Single super-admin self profile; no lookup surface.' })],
  },
  {
    id: 'admin.currency-rate.create',
    source: 'src/app/(admin)/admin/settings/settings-client.tsx',
    endpoint: 'POST /api/admin/currency-rate',
    schemaSource: 'src/app/api/admin/currency-rate/route.ts#manualRateSchema',
    fields: [always('admin.currency-rate.create', 'rate', 'MONEY'), optional('admin.currency-rate.create', 'note')],
  },
  {
    id: 'admin.telegram.update',
    source: 'src/app/(admin)/admin/settings/settings-client.tsx',
    endpoint: 'PATCH /api/admin/profile',
    schemaSource: 'src/app/api/admin/profile/route.ts#updateTelegramSchema',
    fields: [optional('admin.telegram.update', 'telegramId', 'SECRET', { noSearchReason: 'Private delivery identity; exact authorization lookup only.' })],
  },
  {
    id: 'admin.password.change',
    source: 'src/app/(admin)/admin/settings/settings-client.tsx',
    endpoint: 'PATCH /api/admin/profile',
    schemaSource: 'src/app/api/admin/profile/route.ts#changePasswordSchema',
    fields: [
      always('admin.password.change', 'currentPassword', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      always('admin.password.change', 'newPassword', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      always('admin.password.change', 'confirmPassword', 'SECRET', { noSearchReason: 'Client-only confirmation; never stored or searched.' }),
    ],
  },
  {
    id: 'admin.shop.create',
    source: 'src/app/(admin)/admin/shops/new/page.tsx',
    endpoint: 'POST /api/shops',
    schemaSource: 'src/lib/validations.ts#createShopSchema',
    fields: [
      always('admin.shop.create', 'name', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.create', 'ownerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.create', 'ownerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.create', 'shopNumber', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      optional('admin.shop.create', 'address'),
      optional('admin.shop.create', 'note'),
      always('admin.shop.create', 'accessMode', 'STATUS_FILTER'),
      always('admin.shop.create', 'admins.name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded member roster is selected directly inside its shop.' }),
      always('admin.shop.create', 'admins.phone', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded member roster is selected directly inside its shop.' }),
      optional('admin.shop.create', 'admins.telegramId', 'SECRET', { noSearchReason: 'Private Telegram identity is never free-text searchable.' }),
      always('admin.shop.create', 'admins.login', 'SECRET', { noSearchReason: 'Authentication credentials are never exposed through search.' }),
      always('admin.shop.create', 'admins.password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
    ],
  },
  {
    id: 'admin.shop.package.update',
    source: 'src/components/admin/shop-package-editor.tsx',
    endpoint: 'POST /api/shops/[id]/package',
    schemaSource: 'src/lib/shop-package-contract.ts#shopPackageDraftSchema',
    fields: [
      always('admin.shop.package.update', 'effectiveOn', 'DATE_FILTER'),
      always('admin.shop.package.update', 'currency', 'STATUS_FILTER'),
      always('admin.shop.package.update', 'basePrice', 'MONEY'),
      always('admin.shop.package.update', 'discountAmount', 'MONEY'),
      always('admin.shop.package.update', 'features.enabled', 'STATUS_FILTER'),
      always('admin.shop.package.update', 'features.recurringPrice', 'MONEY'),
      always('admin.shop.package.update', 'note'),
    ],
  },
  {
    id: 'admin.shop.owner.resolve',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'POST /api/shops/[id]/owner',
    schemaSource: 'src/app/api/shops/[id]/owner/route.ts#ownerResolutionSchema',
    fields: [always('admin.shop.owner.resolve', 'ownerAdminId', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Selected from the tenant-bound active member roster.' }), always('admin.shop.owner.resolve', 'note')],
  },
  {
    id: 'admin.shop.payment.create',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'POST /api/shops/[id]/payment',
    schemaSource: 'src/lib/validations.ts#addShopPaymentSchema',
    fields: [always('admin.shop.payment.create', 'amount', 'MONEY'), always('admin.shop.payment.create', 'months'), always('admin.shop.payment.create', 'paymentMethod', 'STATUS_FILTER'), optional('admin.shop.payment.create', 'note')],
  },
  {
    id: 'admin.shop.update',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'PATCH /api/shops/[id]',
    schemaSource: 'src/app/api/shops/[id]/route.ts#updateShopSchema',
    fields: [
      always('admin.shop.update', 'name', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.update', 'ownerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.update', 'ownerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('admin.shop.update', 'shopNumber', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      optional('admin.shop.update', 'address'), optional('admin.shop.update', 'note'),
    ],
  },
  {
    id: 'admin.shop.status.change',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'PATCH /api/shops/[id]',
    schemaSource: 'src/app/api/shops/[id]/route.ts#updateShopSchema+status guard',
    fields: [always('admin.shop.status.change', 'status', 'STATUS_FILTER'), always('admin.shop.status.change', 'reason')],
  },
  {
    id: 'admin.shop.delete',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'DELETE /api/shops/[id]',
    schemaSource: 'src/app/api/shops/[id]/route.ts#deleteShopSchema',
    fields: [always('admin.shop.delete', 'deleteNote')],
  },
  {
    id: 'admin.shop-member.create',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'POST /api/shops/[id]/admins',
    schemaSource: 'src/app/api/shops/[id]/admins/route.ts#addAdminSchema',
    fields: [
      always('admin.shop-member.create', 'name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded shop member roster.' }),
      always('admin.shop-member.create', 'phone', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded shop member roster.' }),
      optional('admin.shop-member.create', 'telegramId', 'SECRET', { noSearchReason: 'Private Telegram identity.' }),
      always('admin.shop-member.create', 'login', 'SECRET', { noSearchReason: 'Authentication login is not a public search key.' }),
      always('admin.shop-member.create', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
    ],
  },
  {
    id: 'admin.shop-member.password-reset',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'PATCH /api/shops/[id]/admins',
    schemaSource: 'src/app/api/shops/[id]/admins/route.ts#resetPasswordSchema',
    fields: [always('admin.shop-member.password-reset', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }), always('admin.shop-member.password-reset', 'note')],
  },
  {
    id: 'admin.shop-member.delete',
    source: 'src/app/(admin)/admin/shops/[id]/page.tsx',
    endpoint: 'DELETE /api/shops/[id]/admins',
    schemaSource: 'src/app/api/shops/[id]/admins/route.ts#deleteAdminSchema',
    fields: [always('admin.shop-member.delete', 'note')],
  },
  {
    id: 'shop.account.update',
    source: 'src/app/(shop)/shop/settings/page.tsx',
    endpoint: 'PATCH /api/shop-admin/profile',
    schemaSource: 'src/app/api/shop-admin/profile/route.ts#updateProfileSchema',
    fields: [always('shop.account.update', 'name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Self-profile field; member roster is bounded.' }), always('shop.account.update', 'phone', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Self-profile field; member roster is bounded.' })],
  },
  {
    id: 'shop.profile.update',
    source: 'src/app/(shop)/shop/settings/page.tsx',
    endpoint: 'PATCH /api/shop/profile',
    schemaSource: 'src/app/api/shop/profile/route.ts#updateShopProfileSchema',
    fields: [
      always('shop.profile.update', 'name', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('shop.profile.update', 'ownerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      always('shop.profile.update', 'ownerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['admin-shops'] }),
      optional('shop.profile.update', 'address'), optional('shop.profile.update', 'note'),
      always('shop.profile.update', 'preferredCurrency', 'STATUS_FILTER'),
      optional('shop.profile.update', 'telegramNotificationsEnabled', 'STATUS_FILTER'),
    ],
  },
  {
    id: 'shop.telegram.update',
    source: 'src/app/(shop)/shop/settings/page.tsx',
    endpoint: 'PATCH /api/shop-admin/profile',
    schemaSource: 'src/app/api/shop-admin/profile/route.ts#updateTelegramSchema',
    fields: [optional('shop.telegram.update', 'telegramId', 'SECRET', { noSearchReason: 'Private delivery identity.' })],
  },
  {
    id: 'shop.password.change',
    source: 'src/app/(shop)/shop/settings/page.tsx',
    endpoint: 'PATCH /api/shop-admin/profile',
    schemaSource: 'src/app/api/shop-admin/profile/route.ts#changePasswordSchema',
    fields: [
      always('shop.password.change', 'currentPassword', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      always('shop.password.change', 'newPassword', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      always('shop.password.change', 'confirmPassword', 'SECRET', { noSearchReason: 'Client-only confirmation.' }),
    ],
  },
  {
    id: 'shop.staff.create',
    source: 'src/components/shop/staff-management.tsx',
    endpoint: 'POST /api/shop/staff',
    schemaSource: 'src/lib/shop-staff-contract.ts#createShopStaffSchema',
    fields: [
      always('shop.staff.create', 'name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded owner-only staff roster.' }),
      always('shop.staff.create', 'phone', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded owner-only staff roster.' }),
      always('shop.staff.create', 'login', 'SECRET', { noSearchReason: 'Authentication login is never public search.' }),
      always('shop.staff.create', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      optional('shop.staff.create', 'telegramId', 'SECRET', { noSearchReason: 'Private delivery identity.' }),
      optional('shop.staff.create', 'telegramNotificationsEnabled', 'STATUS_FILTER'),
      optional('shop.staff.create', 'permissionCodes', 'STATUS_FILTER'),
    ],
  },
  {
    id: 'shop.staff.update',
    source: 'src/components/shop/staff-management.tsx',
    endpoint: 'PATCH /api/shop/staff/[id]',
    schemaSource: 'src/lib/shop-staff-contract.ts#updateShopStaffSchema',
    fields: [
      optional('shop.staff.update', 'name', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded owner-only staff roster.' }),
      optional('shop.staff.update', 'phone', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Bounded owner-only staff roster.' }),
      optional('shop.staff.update', 'password', 'SECRET', { noSearchReason: 'Passwords are never searchable.' }),
      optional('shop.staff.update', 'telegramNotificationsEnabled', 'STATUS_FILTER'), optional('shop.staff.update', 'permissionCodes', 'STATUS_FILTER'), optional('shop.staff.update', 'isActive', 'STATUS_FILTER'),
      always('shop.staff.update', 'note'),
    ],
  },
  {
    id: 'device.create',
    source: 'src/app/(shop)/shop/qurilmalar/new/page.tsx',
    endpoint: 'POST /api/devices',
    schemaSource: 'src/lib/validations.ts#addDeviceSchema',
    fields: [
      always('device.create', 'model', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }),
      optional('device.create', 'color', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      always('device.create', 'storageAmount', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      always('device.create', 'storageUnit', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      always('device.create', 'conditionCode', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }),
      optional('device.create', 'batteryHealth'), always('device.create', 'purchasePrice', 'MONEY'),
      always('device.create', 'imei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }),
      optional('device.create', 'secondaryImei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }),
      optional('device.create', 'supplierName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      optional('device.create', 'supplierPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      optional('device.create', 'note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      optional('device.create', 'imageUrls', 'PRIVATE_DOCUMENT', { noSearchReason: 'Private object keys and signed URLs are never searchable.' }),
    ],
  },
  {
    id: 'device.update',
    source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
    endpoint: 'PATCH /api/devices/[id]',
    schemaSource: 'src/app/api/devices/[id]/route.ts#updateDeviceSchema',
    fields: [
      always('device.update', 'model', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }), optional('device.update', 'color', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      always('device.update', 'storageAmount', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }), always('device.update', 'storageUnit', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }),
      always('device.update', 'conditionCode', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), optional('device.update', 'batteryHealth'), always('device.update', 'purchasePrice', 'MONEY'),
      always('device.update', 'imei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }), optional('device.update', 'secondaryImei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker', 'nasiya-list'] }),
      optional('device.update', 'supplierPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }), optional('device.update', 'note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'device-picker'] }), optional('device.update', 'reason'),
    ],
  },
  {
    id: 'device.delete', source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', endpoint: 'DELETE /api/devices/[id]', schemaSource: 'src/app/api/devices/[id]/route.ts#deleteDeviceSchema', fields: [always('device.delete', 'deleteNote')],
  },
  {
    id: 'device.return', source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', endpoint: 'POST /api/devices/[id]/return', schemaSource: 'src/app/api/devices/[id]/return/route.ts#returnDeviceSchema', fields: [always('device.return', 'note'), optional('device.return', 'refundAmount', 'MONEY'), conditional('device.return', 'refundMethod', 'refundAmount > 0', 'STATUS_FILTER')],
  },
  {
    id: 'device.restock', source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', endpoint: 'POST /api/devices/[id]/restock', schemaSource: 'src/app/api/devices/[id]/restock/route.ts#restockDeviceSchema', fields: [always('device.restock', 'note')],
  },
  {
    id: 'sale.create', source: 'src/app/(shop)/shop/sotuv/new/page.tsx', endpoint: 'POST /api/devices/[id]/sell', schemaSource: 'src/lib/validations.ts#createSaleSchema', fields: [
      always('sale.create', 'deviceId', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-picker'] }), always('sale.create', 'customerMode', 'STATUS_FILTER'),
      conditional('sale.create', 'customerId', 'customerMode = EXISTING', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), conditional('sale.create', 'customerName', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), conditional('sale.create', 'customerPhone', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }),
      always('sale.create', 'salePrice', 'MONEY'), always('sale.create', 'paymentMethod', 'STATUS_FILTER'), always('sale.create', 'paidFully', 'STATUS_FILTER'), conditional('sale.create', 'amountPaid', 'paidFully = false', 'MONEY'), conditional('sale.create', 'dueDate', 'paidFully = false', 'DATE_FILTER'), optional('sale.create', 'reminderEnabled', 'STATUS_FILTER'), conditional('sale.create', 'earlyReminderDays', 'earlyReminderEnabled = true'), optional('sale.create', 'note'),
    ],
  },
  {
    id: 'sale.payment', source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', endpoint: 'POST /api/sales/[id]/payment', schemaSource: 'src/lib/validations.ts#addSalePaymentSchema', fields: [always('sale.payment', 'amount', 'MONEY'), always('sale.payment', 'paymentMethod', 'STATUS_FILTER'), conditional('sale.payment', 'paymentBreakdown', 'split payment is enabled', 'MONEY'), optional('sale.payment', 'nextDueDate', 'DATE_FILTER'), optional('sale.payment', 'note')],
  },
  {
    id: 'sale.update', source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', endpoint: 'PATCH /api/sales/[id]', schemaSource: 'src/app/api/sales/[id]/route.ts#updateSaleSchema', fields: [
      always('sale.update', 'customerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'device-list'] }),
      always('sale.update', 'customerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'device-list'] }),
      always('sale.update', 'paymentMethod', 'STATUS_FILTER'), optional('sale.update', 'dueDate', 'DATE_FILTER'),
      always('sale.update', 'reminderEnabled', 'STATUS_FILTER'), optional('sale.update', 'note'), optional('sale.update', 'reason'),
    ],
  },
  {
    id: 'nasiya.create', source: 'src/app/(shop)/shop/nasiyalar/new/page.tsx', endpoint: 'POST /api/devices/[id]/nasiya', schemaSource: 'src/lib/validations.ts#createNasiyaSchema', fields: [
      always('nasiya.create', 'deviceId', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-picker', 'nasiya-list'] }), always('nasiya.create', 'customerMode', 'STATUS_FILTER'), conditional('nasiya.create', 'customerId', 'customerMode = EXISTING', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), conditional('nasiya.create', 'customerName', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'nasiya-list'] }), conditional('nasiya.create', 'customerPhone', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'nasiya-list'] }), conditional('nasiya.create', 'passportPhotoUrl', 'new customer or selected customer has no saved passport image', 'PRIVATE_DOCUMENT', { noSearchReason: 'Private image key is never searchable.' }),
      always('nasiya.create', 'totalAmount', 'MONEY'), always('nasiya.create', 'downPayment', 'MONEY'), always('nasiya.create', 'months'), optional('nasiya.create', 'interestPercent'), conditional('nasiya.create', 'monthlyPayment', 'monthly-payment override is enabled', 'MONEY'), always('nasiya.create', 'startDate', 'DATE_FILTER'), always('nasiya.create', 'paymentMethod', 'STATUS_FILTER'), conditional('nasiya.create', 'earlyReminderDays', 'earlyReminderEnabled = true'), optional('nasiya.create', 'note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['nasiya-list'] }),
    ],
  },
  {
    id: 'nasiya.import', source: 'src/app/(shop)/shop/nasiyalar/import/page.tsx', endpoint: 'POST /api/nasiya/import', schemaSource: 'src/lib/validations.ts#importNasiyaSchema', fields: [
      always('nasiya.import', 'customerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'nasiya-list'] }), always('nasiya.import', 'customerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'nasiya-list'] }), always('nasiya.import', 'deviceModel', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'nasiya-list'] }), optional('nasiya.import', 'imei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'nasiya-list'] }), optional('nasiya.import', 'secondaryImei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'nasiya-list'] }), optional('nasiya.import', 'storageAmount', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), optional('nasiya.import', 'storageUnit', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), always('nasiya.import', 'conditionCode', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), optional('nasiya.import', 'color', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), optional('nasiya.import', 'batteryHealth'), always('nasiya.import', 'originalTotalAmount', 'MONEY'), always('nasiya.import', 'alreadyPaidBeforeImport', 'MONEY'), always('nasiya.import', 'remainingDebt', 'MONEY'), always('nasiya.import', 'monthlyPayment', 'MONEY'), always('nasiya.import', 'nextPaymentDate', 'DATE_FILTER'), optional('nasiya.import', 'originalSaleDate', 'DATE_FILTER'), optional('nasiya.import', 'totalMonths'), optional('nasiya.import', 'importNote', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['nasiya-list'] }),
    ],
  },
  {
    id: 'nasiya.payment', source: 'src/components/shop/nasiya-payment-modal.tsx', endpoint: 'POST /api/nasiya/[id]/payment', schemaSource: 'src/lib/validations.ts#addNasiyaPaymentSchema', fields: [always('nasiya.payment', 'nasiyaScheduleId', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Selected from the tenant-bound contract schedule.' }), always('nasiya.payment', 'amount', 'MONEY'), always('nasiya.payment', 'paymentMethod', 'STATUS_FILTER'), conditional('nasiya.payment', 'paymentBreakdown', 'split payment is enabled', 'MONEY'), always('nasiya.payment', 'date', 'DATE_FILTER'), optional('nasiya.payment', 'note')],
  },
  {
    id: 'nasiya.defer', source: 'src/components/shop/nasiya-defer-modal.tsx', endpoint: 'POST /api/nasiya/[id]/defer', schemaSource: 'src/lib/validations.ts#deferNasiyaScheduleSchema', fields: [always('nasiya.defer', 'nasiyaScheduleId', 'BUSINESS_IDENTIFIER', { noSearchReason: 'Selected from the tenant-bound contract schedule.' }), always('nasiya.defer', 'newDueDate', 'DATE_FILTER'), optional('nasiya.defer', 'reason')],
  },
  {
    id: 'nasiya.resolve', source: 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx', endpoint: 'POST /api/nasiya/[id]/resolution', schemaSource: 'src/lib/validations.ts#resolveNasiyaSchema', fields: [always('nasiya.resolve', 'action', 'STATUS_FILTER'), always('nasiya.resolve', 'reason')],
  },
  {
    id: 'nasiya.update', source: 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx', endpoint: 'PATCH /api/nasiya/[id]', schemaSource: 'src/app/api/nasiya/[id]/route.ts#updateNasiyaSchema', fields: [
      always('nasiya.update', 'customerName', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'nasiya-list'] }),
      always('nasiya.update', 'customerPhone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'nasiya-list'] }),
      optional('nasiya.update', 'note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['nasiya-list'] }),
      optional('nasiya.update', 'importNote', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['nasiya-list'] }),
      always('nasiya.update', 'reminderEnabled', 'STATUS_FILTER'), optional('nasiya.update', 'reason'),
    ],
  },
  {
    id: 'nasiya.reminder.update', source: 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx', endpoint: 'PATCH /api/nasiya/[id]/reminder', schemaSource: 'src/app/api/nasiya/[id]/reminder/route.ts#reminderSchema', fields: [always('nasiya.reminder.update', 'reminderEnabled', 'STATUS_FILTER')],
  },
  {
    id: 'olib-sotdim.create', source: 'src/app/(shop)/shop/olib-sotdim/new/page.tsx', endpoint: 'POST /api/olib-sotdim', schemaSource: 'src/lib/validations.ts#createOlibSotdimSchema', fields: [
      always('olib-sotdim.create', 'device.model', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'olib-sotdim-list'] }), optional('olib-sotdim.create', 'device.color', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'olib-sotdim-list'] }), always('olib-sotdim.create', 'device.storageAmount', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), always('olib-sotdim.create', 'device.storageUnit', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), always('olib-sotdim.create', 'device.conditionCode', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }), always('olib-sotdim.create', 'device.imei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'olib-sotdim-list'] }), optional('olib-sotdim.create', 'device.secondaryImei', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list', 'olib-sotdim-list'] }), optional('olib-sotdim.create', 'device.note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['device-list'] }),
      always('olib-sotdim.create', 'supplier.name', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['olib-sotdim-list'] }), always('olib-sotdim.create', 'supplier.phone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['olib-sotdim-list'] }), always('olib-sotdim.create', 'supplier.purchasePrice', 'MONEY'), optional('olib-sotdim.create', 'supplier.note', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['olib-sotdim-list'] }), always('olib-sotdim.create', 'customerMode', 'STATUS_FILTER'), conditional('olib-sotdim.create', 'customerId', 'customerMode = EXISTING', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), conditional('olib-sotdim.create', 'customerName', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'olib-sotdim-list'] }), conditional('olib-sotdim.create', 'customerPhone', 'customerMode = NEW', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker', 'olib-sotdim-list'] }), always('olib-sotdim.create', 'salePrice', 'MONEY'), always('olib-sotdim.create', 'paymentMethod', 'STATUS_FILTER'), optional('olib-sotdim.create', 'note'),
    ],
  },
  {
    id: 'olib-sotdim.pay', source: 'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx', endpoint: 'POST /api/olib-sotdim/[id]/pay', schemaSource: 'src/lib/validations.ts#markSupplierPayablePaidSchema', fields: [always('olib-sotdim.pay', 'paymentMethod', 'STATUS_FILTER'), optional('olib-sotdim.pay', 'paidAt', 'DATE_FILTER'), optional('olib-sotdim.pay', 'note')],
  },
  {
    id: 'customer.create-or-update', source: 'src/app/(shop)/shop/mijozlar/customers-client.tsx', endpoint: 'POST/PATCH /api/customers', schemaSource: 'src/app/api/customers/route.ts#createCustomerSchema + [id]/route.ts#updateCustomerSchema', fields: [
      always('customer.create-or-update', 'name', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), always('customer.create-or-update', 'phone', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), optional('customer.create-or-update', 'additionalPhones', 'BUSINESS_IDENTIFIER', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), optional('customer.create-or-update', 'passportIdentifier', 'PRIVATE_DOCUMENT', { searchSurfaceIds: ['customer-list', 'customer-picker'] }), optional('customer.create-or-update', 'passportPhotoUrl', 'PRIVATE_DOCUMENT', { noSearchReason: 'Private object keys and signed URLs are never searchable.' }), optional('customer.create-or-update', 'note'),
    ],
  },
] as const satisfies readonly FormSurfaceContract[]

export const SEARCH_SURFACE_CONTRACT = [
  {
    id: 'admin-shops', source: 'src/app/api/shops/route.ts', endpoint: 'GET /api/shops', transport: 'QUERY', parameters: ['search', 'status', 'includeDeleted'], searchableFields: ['Shop.name', 'Shop.ownerName', 'Shop.ownerPhone', 'Shop.shopNumber', 'Shop.status'], scope: 'SUPER_ADMIN', privacy: 'Super-admin-only endpoint; never exposed to shop sessions.',
  },
  {
    id: 'customer-list', source: 'src/app/api/customers/search/route.ts', endpoint: 'POST /api/customers/search', transport: 'JSON_BODY', parameters: ['search'], searchableFields: ['Customer.name', 'Customer.phone', 'Customer.additionalPhones', 'Customer.passportIdentifierHash', 'Customer.note'], scope: 'SHOP_SESSION', privacy: 'shopId is resolved from the authenticated principal; passport search is an exact secret-scoped HMAC and the raw identifier never enters a URL, browser history, access log, response, or React Query key.',
  },
  {
    id: 'customer-picker', source: 'src/app/api/customers/picker/route.ts', endpoint: 'POST /api/customers/picker', transport: 'JSON_BODY', parameters: ['search'], searchableFields: ['Customer.name', 'Customer.phone', 'Customer.additionalPhones', 'Customer.passportIdentifierHash'], scope: 'SHOP_SESSION', privacy: 'Bounded POST-body search; no full passport identifier, image key, URL query value, query-cache value, or cross-tenant row is returned.',
  },
  {
    id: 'customer-by-phone', source: 'src/app/api/customers/by-phone/route.ts', endpoint: 'GET /api/customers/by-phone', transport: 'QUERY', parameters: ['phone'], searchableFields: ['Customer.normalizedPhone (exact)'], scope: 'SHOP_SESSION', privacy: 'Exact normalized-phone lookup is constrained by the resolved shopId and excludes soft-deleted customers.',
  },
  {
    id: 'device-list', source: 'src/app/api/devices/route.ts', endpoint: 'GET /api/devices', transport: 'QUERY', parameters: ['search', 'status', 'condition'], searchableFields: ['Device.model', 'Device.imei/DeviceImei', 'Device.color', 'Device.storage', 'Device.conditionCode', 'Device.note', 'Supplier.name', 'Supplier.phone', 'Customer.name/phone'], scope: 'SHOP_SESSION', privacy: 'Every predicate is nested under the resolved shopId.',
  },
  {
    id: 'device-picker', source: 'src/app/api/devices/route.ts', endpoint: 'GET /api/devices?view=picker', transport: 'QUERY', parameters: ['search'], searchableFields: ['Device.model', 'Device.imei/DeviceImei', 'Device.color', 'Device.storage', 'Device.note', 'Supplier.name/phone'], scope: 'SHOP_SESSION', privacy: 'Resolved shopId plus IN_STOCK-only bounded projection.',
  },
  {
    id: 'nasiya-list', source: 'src/app/api/nasiya/route.ts', endpoint: 'GET /api/nasiya', transport: 'QUERY', parameters: ['search', 'status'], searchableFields: ['Customer.name/phone/additionalPhones', 'Device.model', 'Device.imei/DeviceImei', 'Nasiya.note', 'derived status', 'resolution state'], scope: 'SHOP_SESSION', privacy: 'shopId is resolved server-side; status and resolution use explicit filters.',
  },
  {
    id: 'olib-sotdim-list', source: 'src/app/api/olib-sotdim/route.ts', endpoint: 'GET /api/olib-sotdim', transport: 'QUERY', parameters: ['search', 'status'], searchableFields: ['Supplier.name/phone/note', 'Customer.name/phone', 'Device.model/imei/secondaryImei'], scope: 'SHOP_SESSION', privacy: 'All joins remain constrained to the resolved shopId.',
  },
  {
    id: 'audit-log-list', source: 'src/app/api/logs/route.ts', endpoint: 'GET /api/logs', transport: 'QUERY', parameters: ['search', 'actorType', 'actorId', 'targetType', 'category', 'from', 'to'], searchableFields: ['Log.action', 'Log.targetType', 'Log.targetId', 'Log.note', 'Shop.name', 'explicit date range'], scope: 'SHOP_SESSION', privacy: 'Shop sessions are forced to their tenant; super admin may explicitly select a shop.',
  },
  {
    id: 'receivables-list', source: 'src/app/api/receivables/route.ts', endpoint: 'GET /api/receivables', transport: 'QUERY', parameters: ['cohort'], searchableFields: ['authoritative DUE_TODAY/OVERDUE cohort'], scope: 'SHOP_SESSION', privacy: 'No free-text money/date matching; Tashkent date cohort is an explicit tenant-scoped filter.',
  },
  {
    id: 'shop-report-range', source: 'src/app/api/reports/shop/route.ts', endpoint: 'GET /api/reports/shop', transport: 'QUERY', parameters: ['month', 'preset', 'startMonth', 'endMonth', 'admin'], searchableFields: ['explicit calendar-month range', 'admin attribution'], scope: 'SHOP_SESSION', privacy: 'Authoritative available-month, preset, range, and trend contract; REPORTS feature plus REPORT_VIEW permission and resolved shop are enforced.',
  },
  {
    id: 'legacy-shop-stats', source: 'src/app/api/stats/shop/route.ts', endpoint: 'GET /api/stats/shop', transport: 'QUERY', parameters: ['month', 'admin'], searchableFields: ['explicit single calendar month', 'admin attribution'], scope: 'SHOP_SESSION', privacy: 'Legacy dashboard-summary companion only; REPORT_VIEW and resolved-shop scope are enforced, while range discovery and trends remain authoritative in shop-report-range.',
  },
] as const satisfies readonly SearchSurfaceContract[]

/** Files containing user-authored mutation controls. Inventory tests compare
 * this set to source discovery so a future form cannot silently skip E2-004. */
export const MUTATION_FORM_SOURCE_INVENTORY = [...new Set(FORM_SURFACE_CONTRACT.map((surface) => surface.source))].sort()
