import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  HIGH_RISK_AUDIT_REASON_SURFACE_IDS,
  ORDINARY_COMMENT_FIELD_KEYS,
  ORDINARY_COMMENT_UI_INVENTORY,
} from '@/lib/comment-field-contract'
import { FORM_SURFACE_CONTRACT } from '@/lib/field-search-contract'
import {
  addNasiyaPaymentSchema,
  addSalePaymentSchema,
  deferNasiyaScheduleSchema,
} from '@/lib/validations'

function read(source: string) {
  return readFileSync(resolve(process.cwd(), source), 'utf8')
}

function walk(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    const source = join(directory, entry.name)
    return entry.isDirectory() ? walk(source) : entry.name.endsWith('.tsx') ? [source] : []
  })
}

const highRiskSurfaceIds = new Set<string>(HIGH_RISK_AUDIT_REASON_SURFACE_IDS)
const ordinaryFieldKeys = new Set<string>(ORDINARY_COMMENT_FIELD_KEYS)

describe('ordinary comment requiredness contract', () => {
  it('keeps every ordinary comment command optional, while explicit high-risk reasons stay required', () => {
    for (const surface of FORM_SURFACE_CONTRACT) {
      for (const field of surface.fields) {
        if (!ordinaryFieldKeys.has(field.submittedKey)) continue
        if (surface.id === 'nasiya.settle' && field.submittedKey === 'reason') {
          expect(field.requirement).toBe('CONDITIONAL')
          expect(field.requiredWhen).toBe('mode is WAIVE_REMAINING_PROFIT')
          continue
        }
        const expected = highRiskSurfaceIds.has(surface.id) ? 'ALWAYS' : 'OPTIONAL'
        expect(field.requirement, `${surface.id}.${field.submittedKey}`).toBe(expected)
      }
    }
  })

  it('invents no unregistered visible Izoh/Sharh/Eslatma input and shows no red required marker for one', () => {
    const registered = new Set(ORDINARY_COMMENT_UI_INVENTORY.map(({ source }) => source))
    const fieldSources = walk('src').filter((source) => {
      const content = read(source)
      return /<Field\b[\s\S]{0,220}?label=["'][^"']*(?:Izoh|Sharh|Eslatma|Comment|Note)[^"']*["']/i.test(content)
    })
    for (const source of fieldSources) {
      expect(registered, `${source} needs an ordinary-comment inventory entry or a dedicated Sabab label`).toContain(source)
    }

    for (const { source, labels } of ORDINARY_COMMENT_UI_INVENTORY) {
      expect(existsSync(resolve(process.cwd(), source)), source).toBe(true)
      const content = read(source)
      for (const label of labels) {
        const at = content.toLocaleLowerCase().indexOf(label.toLocaleLowerCase())
        expect(at, `${source}: ${label}`).toBeGreaterThanOrEqual(0)
        const fieldWindow = content.slice(Math.max(0, at - 160), at + 300)
        expect(fieldWindow, `${source}: ordinary ${label} must not be required`).not.toMatch(/\b(required|aria-required)\b/i)
      }
    }
  })

  it('normalizes blank payment/deferral comments to undefined rather than rejecting the command', () => {
    const sale = addSalePaymentSchema.safeParse({
      amount: 100,
      inputCurrency: 'UZS',
      paymentMethod: 'CASH',
      note: '   ',
      reason: '   ',
    })
    expect(sale.success).toBe(true)
    if (sale.success) {
      expect(sale.data.note).toBeUndefined()
      expect(sale.data.reason).toBeUndefined()
    }

    const nasiya = addNasiyaPaymentSchema.safeParse({
      nasiyaScheduleId: 'schedule_1',
      amount: 100,
      inputCurrency: 'UZS',
      paymentMethod: 'CASH',
      date: new Date('2026-07-14T00:00:00.000Z'),
      note: '   ',
    })
    expect(nasiya.success).toBe(true)
    if (nasiya.success) expect(nasiya.data.note).toBeUndefined()

    const deferred = deferNasiyaScheduleSchema.safeParse({
      nasiyaScheduleId: 'schedule_1',
      newDueDate: new Date('2026-07-20T00:00:00.000Z'),
      reason: '   ',
    })
    expect(deferred.success).toBe(true)
    if (deferred.success) expect(deferred.data.reason).toBeUndefined()
  })

  it('has no residual server-side gate that makes an ordinary payment or edit comment mandatory', () => {
    const salePayment = read('src/app/api/sales/[id]/payment/route.ts')
    const saleUpdate = read('src/app/api/sales/[id]/route.ts')
    const nasiyaUpdate = read('src/app/api/nasiya/[id]/route.ts')
    const deviceUpdate = read('src/app/api/devices/[id]/route.ts')
    const customerUpdate = read('src/app/api/customers/[id]/route.ts')
    const customerForm = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

    expect(salePayment).not.toContain("To'lov yozish yoki keyingi to'lov sanasini o'zgartirish uchun izoh yoki sabab kiritilishi shart")
    expect(salePayment).not.toContain('if (!auditNote)')
    expect(saleUpdate).not.toContain('reason: z.string().trim().min(5')
    expect(nasiyaUpdate).not.toContain('reason: z.string().trim().min(5')
    expect(deviceUpdate).not.toContain("Sotilgan yoki nasiya qurilma ma'lumotlarini o'zgartirish uchun izoh yoki sabab kiritilishi shart")
    expect(customerUpdate).not.toContain("Mijoz ismi yoki telefonini o'zgartirish uchun izoh yoki sabab kiritilishi shart")
    expect(customerForm).not.toContain('customer-reason')
    expect(customerForm).not.toContain('reason.trim().length < 5')
  })

  it('does not turn a high-risk audit reason into an ordinary Izoh label', () => {
    const packageEditor = read('src/components/admin/shop-package-editor.tsx')
    const packageReason = packageEditor.slice(packageEditor.indexOf('package-reason-heading'), packageEditor.indexOf('package-reason-heading') + 1_000)
    expect(packageReason).toContain('label="Sabab"')
    expect(packageReason).toContain('required')

    const resolution = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    const resolutionReason = resolution.slice(resolution.indexOf('nasiya-resolution-reason'), resolution.indexOf('nasiya-resolution-reason') + 900)
    expect(resolutionReason).toContain('Sabab')
    expect(resolutionReason).toContain('text-red-500')
  })
})
