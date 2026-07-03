import { describe, expect, it } from 'vitest'
import { csvCell, csvRows } from '@/lib/csv'

describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("https://evil.example")', '"\'=HYPERLINK(""https://evil.example"")"'],
    ['+SUM(A1:A2)', '"\'+SUM(A1:A2)"'],
    ['-10', '"\'-10"'],
    ['@cmd', '"\'@cmd"'],
    [' \t=HYPERLINK("https://evil.example")', '"\' \t=HYPERLINK(""https://evil.example"")"'],
    ['\n=HYPERLINK("https://evil.example")', '"\'\n=HYPERLINK(""https://evil.example"")"'],
    ['+998901234567', '"\'+998901234567"'],
  ])('prefixes formula-like strings: %s', (input, expected) => {
    expect(csvCell(input)).toBe(expected)
  })

  it('escapes quotes while leaving normal strings unchanged', () => {
    expect(csvCell('Ali "aka"')).toBe('"Ali ""aka"""')
    expect(csvCell('Oddiy matn')).toBe('"Oddiy matn"')
  })

  it('keeps true numeric cells numeric-looking', () => {
    expect(csvCell(998901234567)).toBe('"998901234567"')
    expect(csvCell(-10)).toBe('"-10"')
  })

  it('uses the same escaping path for headers and all rows', () => {
    expect(csvRows(['name'], [['=HYPERLINK("x")']])).toBe('"name"\n"\'=HYPERLINK(""x"")"')
  })
})
