import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Apple ID reminder checkbox removal', () => {
  it('does not expose the dead Apple ID reminder checkbox in the nasiya form', () => {
    const src = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')

    expect(src).not.toContain('Apple ID eslatmasi yuborish')
    expect(src).not.toContain('appleId')
    expect(src).not.toContain('appleIdNote')
  })

  it('does not accept Apple ID reminder values in nasiya validation or creation API', () => {
    expect(read('src/lib/validations.ts')).not.toContain('appleIdNote')
    expect(read('src/app/api/devices/[id]/nasiya/route.ts')).not.toContain('appleIdNote')
  })
})
