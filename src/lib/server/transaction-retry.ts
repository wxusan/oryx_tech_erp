const RETRYABLE_TRANSACTION_CODES = new Set(['P2034', '40001', '40P01'])

/**
 * Prisma can expose PostgreSQL serialization/deadlock failures either as its
 * own P2034 error or as a DriverAdapterError whose nested cause carries the
 * native SQLSTATE. Both mean the entire Serializable transaction is safe to
 * retry from the beginning.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  const seen = new Set<object>()
  const pending: unknown[] = [error]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const record = current as Record<string, unknown>
    for (const key of ['code', 'originalCode', 'sqlState']) {
      const value = record[key]
      if (typeof value === 'string' && RETRYABLE_TRANSACTION_CODES.has(value)) return true
    }
    // Prisma 7's pg adapter may wrap a SELECT ... FOR UPDATE serialization
    // failure as P2010 and expose SQLSTATE only inside the textual driver
    // message. This is still the same safe whole-transaction retry signal.
    for (const key of ['message', 'error']) {
      const value = record[key]
      if (
        typeof value === 'string' &&
        /(\b40001\b|could not serialize access|serialization failure|deadlock detected)/i.test(value)
      ) return true
    }
    for (const key of ['cause', 'meta', 'originalError', 'driverAdapterError']) {
      if (record[key] !== undefined) pending.push(record[key])
    }
  }

  return false
}
