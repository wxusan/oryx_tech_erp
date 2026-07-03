import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { csvRows } from '@/lib/csv'
import { displayImei } from '@/lib/device-display'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('import placeholder IMEI user-facing guard', () => {
  it('routes Telegram device specs through the Telegram IMEI helper', () => {
    const src = read('src/lib/telegram-templates.ts')

    expect(src).toContain("import { telegramImei } from '@/lib/device-display'")
    expect(src).toContain("optionalLine('IMEI', telegramImei(device.imei))")
    expect(src).not.toContain("optionalLine('IMEI', device.imei)")
  })

  it('routes device exports through the display IMEI helper', () => {
    const src = read('src/app/api/export/[entity]/route.ts')

    expect(src).toContain("import { displayImei } from '@/lib/device-display'")
    expect(src).toContain('displayImei(d.imei)')
    expect(src).toContain('displayImei(item.device.imei)')
    expect(src).not.toContain(' d.imei,')
    expect(src).not.toContain(' item.device.imei,')
  })

  it('writes placeholder IMEIs as Kiritilmagan in exported CSV rows', () => {
    const csv = csvRows(['imei'], [[displayImei('IMPORT-abc')], [displayImei('123456789012345')]])

    expect(csv).toContain('"Kiritilmagan"')
    expect(csv).toContain('"123456789012345"')
    expect(csv).not.toContain('IMPORT-')
  })

  it('masks known user-facing UI and shared formatter surfaces', () => {
    const files = [
      'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
      'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'src/app/(shop)/shop/sotuv/new/page.tsx',
      'src/app/(shop)/shop/nasiyalar/new/page.tsx',
      'src/lib/log-format.ts',
    ]

    for (const file of files) {
      expect(read(file), file).toContain('displayImei')
    }
  })
})
