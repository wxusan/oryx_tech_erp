import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')

describe('staff Telegram creation UI guard', () => {
  it('only exposes and submits a Telegram ID for an owner with package and personal delivery enabled', () => {
    expect(staffUi).toContain('!editing && isOwner && <Field')
    expect(staffUi).toContain("disabled={!enabledFeatures.has('TELEGRAM') || !form.telegramNotificationsEnabled}")
    expect(staffUi).toContain("isOwner && enabledFeatures.has('TELEGRAM') && form.telegramNotificationsEnabled")
    expect(staffUi).toContain("Do\\'kon paketida Telegram yoqilmagan. ID biriktirib bo\\'lmaydi.")
  })

  it('clears an unsaved staff Telegram ID when personal delivery is turned off', () => {
    expect(staffUi).toContain("...(!event.target.checked ? { telegramId: '' } : {})")
  })
})
