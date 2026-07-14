export interface CustomerImportRow {
  name: string
  phone: string
  note?: string
}

function parseCsvMatrix(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('CSV faylda yopilmagan qo\'shtirnoq bor')
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLocaleLowerCase('uz')
}

export function parseCustomerImportCsv(input: string): CustomerImportRow[] {
  const matrix = parseCsvMatrix(input)
  if (!matrix.length) throw new Error("CSV fayl bo'sh")

  const headers = matrix[0].map(normalizedHeader)
  const findHeader = (accepted: readonly string[]) => headers.findIndex((header) => accepted.includes(header))
  const nameIndex = findHeader(['name', 'ism', 'ismi', 'mijoz', 'mijoz ismi'])
  const phoneIndex = findHeader(['phone', 'telefon', 'telefon raqam', 'telefon raqami'])
  const noteIndex = findHeader(['note', 'izoh'])
  if (nameIndex < 0 || phoneIndex < 0) {
    throw new Error('CSV sarlavhasida name va phone ustunlari bo\'lishi kerak')
  }

  const rows = matrix.slice(1).map((values) => ({
    name: (values[nameIndex] ?? '').trim(),
    phone: (values[phoneIndex] ?? '').trim(),
    ...((values[noteIndex] ?? '').trim() ? { note: (values[noteIndex] ?? '').trim() } : {}),
  })).filter((row) => row.name || row.phone || row.note)
  if (!rows.length) throw new Error("CSV faylda mijozlar yo'q")
  if (rows.length > 500) throw new Error("Bir importda ko'pi bilan 500 ta mijoz mumkin")
  return rows
}
