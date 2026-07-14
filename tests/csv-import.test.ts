import { describe, expect, it } from 'vitest'
import { parseCustomerImportCsv } from '@/lib/csv-import'

describe('customer CSV import parser', () => {
  it('parses BOM headers, CRLF rows, quoted commas, and escaped quotes', () => {
    expect(parseCustomerImportCsv(
      '\uFEFFname,phone,note\r\n"Malika, Aliyeva",+998901234567,"Said ""hello"""\r\n',
    )).toEqual([{
      name: 'Malika, Aliyeva',
      phone: '+998901234567',
      note: 'Said "hello"',
    }])
  })

  it('accepts the supported Uzbek header aliases and ignores blank rows', () => {
    expect(parseCustomerImportCsv('Mijoz ismi,Telefon raqami,Izoh\nAli,+998901234567,\n\n')).toEqual([
      { name: 'Ali', phone: '+998901234567' },
    ])
  })

  it('rejects missing required headers, empty data, and unterminated quotes', () => {
    expect(() => parseCustomerImportCsv('note\nhello')).toThrow('name va phone')
    expect(() => parseCustomerImportCsv('name,phone\n')).toThrow("mijozlar yo'q")
    expect(() => parseCustomerImportCsv('name,phone\n"Ali,+998901234567')).toThrow("yopilmagan qo'shtirnoq")
  })

  it('enforces the 500-row command limit', () => {
    const rows = Array.from({ length: 501 }, (_, index) => `User ${index},+99890${String(index).padStart(7, '0')}`)
    expect(() => parseCustomerImportCsv(`name,phone\n${rows.join('\n')}`)).toThrow('500 ta')
  })
})
