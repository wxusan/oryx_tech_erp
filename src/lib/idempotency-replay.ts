export function canonicalPaymentBreakdown(value: unknown, currency: 'UZS' | 'USD'): string | null {
  if (value == null) return null
  if (!Array.isArray(value)) return '__invalid__'

  const scale = currency === 'USD' ? 100 : 1
  const parts = value.map((part) => {
    if (typeof part !== 'object' || part === null || !('method' in part) || !('amount' in part)) return null
    const method = String(part.method)
    const amount = Number(part.amount)
    if (!Number.isFinite(amount)) return null
    return { method, amountInMinorUnits: Math.round(amount * scale) }
  })
  if (parts.some((part) => part === null)) return '__invalid__'

  return JSON.stringify(
    parts
      .filter((part): part is { method: string; amountInMinorUnits: number } => part !== null)
      .sort((left, right) => left.method.localeCompare(right.method)),
  )
}

export function sameMoney(left: unknown, right: unknown, currency: 'UZS' | 'USD') {
  const scale = currency === 'USD' ? 100 : 1
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    && Math.round(leftNumber * scale) === Math.round(rightNumber * scale)
}

export function sameOptionalText(left: string | null | undefined, right: string | null | undefined) {
  return (left?.trim() || null) === (right?.trim() || null)
}

export function sameInstant(left: Date | null | undefined, right: Date | null | undefined) {
  if (left == null || right == null) return left == null && right == null
  return left.getTime() === right.getTime()
}
