import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('early reminder schema fields', () => {
  const schema = read('prisma/schema.prisma')

  it('Nasiya and Sale both have earlyReminderEnabled/earlyReminderDays', () => {
    const nasiyaBlock = schema.slice(schema.indexOf('model Nasiya '), schema.indexOf('model NasiyaSchedule'))
    const saleBlock = schema.slice(schema.indexOf('model Sale '), schema.indexOf('model SalePayment'))
    expect(nasiyaBlock).toContain('earlyReminderEnabled')
    expect(nasiyaBlock).toContain('earlyReminderDays')
    expect(saleBlock).toContain('earlyReminderEnabled')
    expect(saleBlock).toContain('earlyReminderDays')
  })

  it('the additive migration file exists', () => {
    const migration = read('prisma/migrations/202607080001_early_reminder_fields/migration.sql')
    expect(migration).toContain('ADD COLUMN "earlyReminderEnabled" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain('ADD COLUMN "earlyReminderDays" INTEGER')
  })
})

describe('early reminder validation (days must be 1-60, required only when enabled)', () => {
  const validations = read('src/lib/validations.ts')

  it('createNasiyaSchema and createSaleSchema both validate earlyReminderDays bounds', () => {
    expect(validations).toContain('earlyReminderEnabled: earlyReminderEnabledSchema')
    expect(validations).toContain('earlyReminderDays: earlyReminderDaysSchema')
    expect(validations).toContain(".max(60,")
    expect(validations).toContain(".min(1,")
  })

  it('requires earlyReminderDays only when earlyReminderEnabled is true', () => {
    const occurrences = validations.split('!data.earlyReminderEnabled || data.earlyReminderDays !== undefined').length - 1
    expect(occurrences).toBe(3) // nasiya, sale, and olib-sotdim (supplier side)
  })
})

describe('early reminder checkboxes are present in both creation flows', () => {
  it('nasiyalar/new has the "Ertaroq eslatilsinmi?" checkbox and days input', () => {
    const page = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')
    expect(page).toContain('Ertaroq eslatilsinmi?')
    expect(page).toContain('Necha kun oldin?')
    expect(page).toContain('earlyReminderEnabled: earlyReminder')
  })

  it('sotuv/new shows the checkbox only for later-payment (fullyPaid === false) sales', () => {
    const page = read('src/app/(shop)/shop/sotuv/new/page.tsx')
    expect(page).toContain('Ertaroq eslatilsinmi?')
    expect(page).toContain('earlyReminderEnabled: fullyPaid ? false : earlyReminder')
  })
})
