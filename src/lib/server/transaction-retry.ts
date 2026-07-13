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
    for (const key of ['cause', 'meta', 'originalError']) {
      if (record[key] !== undefined) pending.push(record[key])
    }
  }

  return false
}
