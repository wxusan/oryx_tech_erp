export const SHOP_LOGIN_TAKEN_MESSAGE = 'Bu login allaqachon mavjud. Iltimos, boshqa login tanlang.'

/**
 * Prisma exposes the failed unique target as either field names or an index
 * name, depending on the connector and whether the index was created through
 * Prisma or raw SQL. Keep this structural so expected conflicts never depend
 * on parsing a database error message.
 */
export function isPrismaUniqueConstraintOnField(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') return false

  const meta = 'meta' in error && error.meta && typeof error.meta === 'object'
    ? error.meta
    : null
  if (!meta) return false

  const legacyTarget = 'target' in meta ? meta.target : undefined
  const driverAdapterError = 'driverAdapterError' in meta && meta.driverAdapterError &&
    typeof meta.driverAdapterError === 'object'
    ? meta.driverAdapterError
    : null
  const cause = driverAdapterError && 'cause' in driverAdapterError &&
    driverAdapterError.cause && typeof driverAdapterError.cause === 'object'
    ? driverAdapterError.cause
    : null
  const constraint = cause && 'constraint' in cause && cause.constraint &&
    typeof cause.constraint === 'object'
    ? cause.constraint
    : null
  const adapterFields = constraint && 'fields' in constraint && Array.isArray(constraint.fields)
    ? constraint.fields
    : []
  const targets = [
    ...(Array.isArray(legacyTarget) ? legacyTarget : [legacyTarget]),
    ...adapterFields,
  ]
  return targets.some((target) => {
    if (typeof target !== 'string') return false
    return target === field || target.includes(`_${field}_`) || target.includes(`"${field}"`)
  })
}
