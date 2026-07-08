const TASHKENT_TIME_ZONE = 'Asia/Tashkent'
const TASHKENT_UTC_OFFSET_HOURS = 5

function tashkentParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''

  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    yearText: part('year'),
    monthText: part('month'),
    dayText: part('day'),
  }
}

function utcFromTashkentDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -TASHKENT_UTC_OFFSET_HOURS, 0, 0, 0))
}

export function tashkentDayRange(now = new Date()) {
  const parts = tashkentParts(now)
  const start = utcFromTashkentDate(parts.year, parts.month, parts.day)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  return {
    start,
    end,
    dayKey: `${parts.yearText}-${parts.monthText}-${parts.dayText}`,
  }
}

/**
 * Today's calendar date in Asia/Tashkent as a `YYYY-MM-DD` string, suitable as
 * the default value of an `<input type="date">`. Never derived from server
 * local time or UTC directly (both can be off by a day from Tashkent).
 */
export function tashkentTodayInputValue(now = new Date()): string {
  return tashkentDayRange(now).dayKey
}

export function tashkentMonthRange(now = new Date()) {
  const parts = tashkentParts(now)
  const start = utcFromTashkentDate(parts.year, parts.month, 1)
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year
  const end = utcFromTashkentDate(nextYear, nextMonth, 1)

  return {
    start,
    end,
    monthKey: `${parts.yearText}-${parts.monthText}`,
  }
}
