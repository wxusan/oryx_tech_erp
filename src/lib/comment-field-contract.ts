/**
 * User-authored comments have a deliberately small, explicit contract.
 *
 * An Izoh/Sharh/Eslatma explains ordinary work and must never block a valid
 * payment, deferment, edit, or form submission.  The few exceptions below
 * are destructive or financial/security commands.  They keep a required
 * dedicated Sabab instead of pretending an ordinary comment is mandatory.
 *
 * The executable guard lives in tests/comment-field-contract.test.ts.
 */

export const HIGH_RISK_AUDIT_REASON_SURFACE_IDS = [
  'admin.shop.package.update',
  'admin.shop.owner.resolve',
  'admin.shop.status.change',
  'admin.shop.delete',
  'admin.shop-member.password-reset',
  'admin.shop-member.delete',
  'shop.staff.update',
  'device.delete',
  'device.return',
  'device.restock',
  'nasiya.resolve',
] as const

/** Every editable ordinary-comment UI surface.  Add an entry with any new
 * comment input so the parity guard checks its visible required marker. */
export const ORDINARY_COMMENT_UI_INVENTORY = [
  { source: 'src/app/(admin)/admin/shops/[id]/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(admin)/admin/shops/new/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/qurilmalar/new/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/mijozlar/customers-client.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx', labels: ['Ichki izoh', 'Import izohi'] },
  { source: 'src/app/(shop)/shop/nasiyalar/import/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/nasiyalar/new/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/olib-sotdim/new/page.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx', labels: ['Izoh'] },
  { source: 'src/app/(shop)/shop/sotuv/new/page.tsx', labels: ['Izoh'] },
  { source: 'src/components/shop/nasiya-defer-modal.tsx', labels: ['Izoh'] },
  { source: 'src/components/shop/nasiya-payment-modal.tsx', labels: ['Izoh'] },
] as const

export const ORDINARY_COMMENT_FIELD_KEYS = ['note', 'importNote', 'reason'] as const
