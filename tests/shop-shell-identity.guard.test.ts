import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(resolve(process.cwd(), 'src/app/(shop)/layout.tsx'), 'utf8')
const client = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop-layout-client.tsx'), 'utf8')

describe('shop shell identity', () => {
  it('server-seeds the authenticated shop and administrator identity', () => {
    expect(layout).toContain('select: { name: true }')
    expect(layout).toContain('shopName={shop?.name')
    expect(layout).toContain('adminName={guarded.session.user.name}')
  })

  it('does not render the old hard-coded shop identity', () => {
    expect(client).not.toContain('Malika shop OS')
    expect(client).toContain('{shopName}')
    expect(client).toContain('{adminName}')
    expect(client).toContain('{initials(adminName)}')
  })
})
