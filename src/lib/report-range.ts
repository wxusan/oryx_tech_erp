import { tashkentMonthRangeFromKey } from '@/lib/timezone'

export type ReportRangePreset = 'single' | 'trailing3' | 'trailing6' | 'trailing12' | 'custom'

export interface ReportRange {
  preset: ReportRangePreset
  startMonth: string
  endMonth: string
  monthKeys: string[]
  start: Date
  end: Date
}

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_CUSTOM_MONTHS = 36

export function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2200
}

export function shiftMonthKey(monthKey: string, offset: number): string {
  if (!isMonthKey(monthKey)) throw new Error('Oy YYYY-MM formatida bo\'lishi kerak')
  const year = Number(monthKey.slice(0, 4))
  const monthIndex = Number(monthKey.slice(5, 7)) - 1
  const absoluteMonth = year * 12 + monthIndex + Math.trunc(offset)
  const shiftedYear = Math.floor(absoluteMonth / 12)
  const shiftedMonth = absoluteMonth % 12
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, '0')}`
}

export function monthKeysInRange(startMonth: string, endMonth: string): string[] {
  if (!isMonthKey(startMonth) || !isMonthKey(endMonth)) {
    throw new Error('Oylar YYYY-MM formatida bo\'lishi kerak')
  }
  if (startMonth > endMonth) throw new Error('Boshlanish oyi yakun oyidan keyin bo\'lishi mumkin emas')

  const keys: string[] = []
  for (let key = startMonth; key <= endMonth; key = shiftMonthKey(key, 1)) {
    keys.push(key)
    if (keys.length > MAX_CUSTOM_MONTHS) {
      throw new Error(`Hisobot oralig'i ${MAX_CUSTOM_MONTHS} oydan oshmasligi kerak`)
    }
  }
  return keys
}

export function resolveReportRange(input: {
  preset?: string | null
  month?: string | null
  startMonth?: string | null
  endMonth?: string | null
  defaultEndMonth: string
}): ReportRange {
  const preset: ReportRangePreset =
    input.preset === 'trailing3' ||
    input.preset === 'trailing6' ||
    input.preset === 'trailing12' ||
    input.preset === 'custom'
      ? input.preset
      : 'single'

  if (!isMonthKey(input.defaultEndMonth)) throw new Error('Standart yakun oyi noto\'g\'ri')

  let endMonth = input.endMonth && isMonthKey(input.endMonth) ? input.endMonth : input.defaultEndMonth
  let startMonth: string
  if (preset === 'single') {
    const month = input.month && isMonthKey(input.month) ? input.month : endMonth
    startMonth = month
    endMonth = month
  } else if (preset === 'custom') {
    if (!input.startMonth || !isMonthKey(input.startMonth) || !input.endMonth || !isMonthKey(input.endMonth)) {
      throw new Error("Maxsus oraliq uchun boshlanish va yakun oylari talab qilinadi")
    }
    startMonth = input.startMonth
    endMonth = input.endMonth
  } else {
    const count = preset === 'trailing3' ? 3 : preset === 'trailing6' ? 6 : 12
    startMonth = shiftMonthKey(endMonth, -(count - 1))
  }

  const monthKeys = monthKeysInRange(startMonth, endMonth)
  const start = tashkentMonthRangeFromKey(startMonth).start
  const end = tashkentMonthRangeFromKey(endMonth).end
  return { preset, startMonth, endMonth, monthKeys, start, end }
}
