import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const DETAIL = 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx'

describe('Nasiya editing UX contract', () => {
  const source = read(DETAIL)

  it('separates contact, optional operational notes, reminder settings and read-only financial context', () => {
    expect(source).toContain("Mijoz va aloqa")
    expect(source).toContain("Ishchi ma'lumotlar")
    expect(source).toContain("Eslatma sozlamasi")
    expect(source).toContain("Shartnoma va moliyaviy ma'lumotlar")
  })

  it('labels ordinary notes as optional and does not show an unexplained adjustment message', () => {
    expect(source).toContain('<Field label="Ichki izoh" help="Ixtiyoriy">')
    expect(source).toContain('<Field label="Import izohi" help="Ixtiyoriy">')
    expect(source).not.toContain('adjustment')
    expect(read('src/app/api/nasiya/[id]/route.ts')).not.toContain('adjustment')
  })

  it('uses shared phone validation and Field accessibility so the first invalid control is focused', () => {
    expect(source).toContain("import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'")
    expect(source).toContain('<Field label="Mijoz ismi" required error={editFieldErrors.customerName}>')
    expect(source).toContain('<Field label="Telefon" required error={editFieldErrors.customerPhone}>')
    expect(source).toContain('setEditFieldErrors(fieldErrors)')
    expect(source).toContain("document.getElementById(fieldErrors.customerName ? 'nasiya-edit-customer' : 'nasiya-edit-phone')?.focus()")
  })

  it('patches the canonical mutation result locally and emits the targeted Nasiya cache event', () => {
    expect(source).toContain('const updated = json.data as NasiyaEditPatch')
    expect(source).toContain('setNasiya((current) => current')
    expect(source).toContain("kind: 'nasiya.updated'")
  })

  it('does not send an invented note/reason simply to make ordinary edits succeed', () => {
    const saveBody = source.slice(source.indexOf('async function handleEditSave'), source.indexOf('const json = await res.json()'))
    expect(saveBody).not.toContain('reason:')
  })
})
