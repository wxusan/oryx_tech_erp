import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('demo seed compatibility guard', () => {
  it('assigns every seeded notification to the intended tenant member', () => {
    const source = readFileSync('scripts/seed-demo.mjs', 'utf8')

    expect(source).toContain("await insert('Notification'")
    expect(source).toContain('recipientShopAdminId: adminId')
  })
})
