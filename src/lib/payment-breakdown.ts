export type PaymentBreakdownMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'

export interface PaymentBreakdownPart {
  method: PaymentBreakdownMethod
  amount: number
}

/**
 * Split payment (e.g. half cash, half card). Validates that a breakdown is
 * well-formed: at least 2 parts (a single part is just a normal payment,
 * not a "split"), every part has a real method and a positive amount, no
 * two parts use the same method (a "split" between the same method twice
 * isn't a split — reject it rather than silently allowing it), and the
 * parts sum to the submitted payment total (a 0.01 tolerance absorbs float
 * rounding across currencies — matches the cent/so'm precision already used
 * throughout this codebase's money math). The frontend already prevents a
 * duplicate-method split and a total that disagrees with the parts, but
 * this is the backend's own source of truth — it must reject the same
 * cases independently, not just trust the client.
 *
 * Returns an error message string, or `null` when valid.
 */
export function validatePaymentBreakdown(parts: PaymentBreakdownPart[], total: number): string | null {
  if (parts.length < 2) {
    return "Aralash to'lov kamida 2 ta usulni o'z ichiga olishi kerak"
  }
  for (const part of parts) {
    if (!part.method) {
      return "Har bir qism uchun to'lov usuli tanlanishi kerak"
    }
    if (!Number.isFinite(part.amount) || part.amount <= 0) {
      return "Har bir qism musbat summa bo'lishi kerak"
    }
  }
  const methods = parts.map((p) => p.method)
  if (new Set(methods).size !== methods.length) {
    return "Aralash to'lov qismlari har xil usullardan iborat bo'lishi kerak"
  }
  const sum = parts.reduce((s, p) => s + p.amount, 0)
  if (Math.abs(sum - total) > 0.01) {
    return "Qismlar yig'indisi to'lov summasiga teng bo'lishi kerak"
  }
  return null
}

/**
 * A single representative PaymentMethod for the existing `paymentMethod`
 * enum column — every existing reader (reports, exports, filters) keeps
 * working unchanged. `OTHER` when the split genuinely mixes methods (the
 * common case); the exact same method when a "split" happens to use only
 * one method twice (an edge case, but still valid input).
 */
export function representativePaymentMethod(parts: PaymentBreakdownPart[]): PaymentBreakdownMethod {
  const methods = new Set(parts.map((p) => p.method))
  return methods.size === 1 ? parts[0].method : 'OTHER'
}

/** Sum of every part's amount — the payment total this breakdown represents. */
export function paymentBreakdownTotal(parts: PaymentBreakdownPart[]): number {
  return parts.reduce((s, p) => s + p.amount, 0)
}
