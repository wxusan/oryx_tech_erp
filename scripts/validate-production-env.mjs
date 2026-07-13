import process from 'node:process'

const errors = []

function required(name, aliases = []) {
  const keys = [name, ...aliases]
  const key = keys.find((candidate) => Boolean(process.env[candidate]?.trim()))
  if (!key) {
    errors.push(`Missing ${keys.join(' or ')}`)
    return ''
  }
  return process.env[key].trim()
}

function validUrl(name, value, protocols) {
  if (!value) return
  try {
    const parsed = new URL(value)
    if (!protocols.includes(parsed.protocol)) {
      errors.push(`${name} must use ${protocols.join(' or ')}`)
    }
  } catch {
    errors.push(`${name} must be a valid URL`)
  }
}

function minimumLength(name, value, minimum) {
  if (value && Buffer.byteLength(value, 'utf8') < minimum) {
    errors.push(`${name} must be at least ${minimum} UTF-8 bytes`)
  }
}

const databaseUrl = required('DATABASE_URL')
const directUrl = required('DIRECT_URL')
const authSecret = required('AUTH_SECRET', ['NEXTAUTH_SECRET'])
const authUrl = required('NEXTAUTH_URL')
const cronSecret = required('CRON_SECRET')
const telegramToken = required('TELEGRAM_BOT_TOKEN')
const telegramWebhookSecret = required('TELEGRAM_WEBHOOK_SECRET')
const supabaseUrl = required('SUPABASE_URL')
const supabaseServiceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const customerPiiEncryptionKey = required('CUSTOMER_PII_ENCRYPTION_KEY')
const customerPiiSearchKey = required('CUSTOMER_PII_SEARCH_KEY')
required('SUPABASE_PRIVATE_BUCKET')

validUrl('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:'])
validUrl('DIRECT_URL', directUrl, ['postgres:', 'postgresql:'])
validUrl('NEXTAUTH_URL', authUrl, ['https:'])
validUrl('SUPABASE_URL', supabaseUrl, ['https:'])
minimumLength('AUTH_SECRET/NEXTAUTH_SECRET', authSecret, 32)
minimumLength('CRON_SECRET', cronSecret, 16)
minimumLength('TELEGRAM_WEBHOOK_SECRET', telegramWebhookSecret, 16)
minimumLength('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey, 20)
minimumLength('CUSTOMER_PII_ENCRYPTION_KEY', customerPiiEncryptionKey, 32)
minimumLength('CUSTOMER_PII_SEARCH_KEY', customerPiiSearchKey, 32)

if (telegramToken && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(telegramToken)) {
  errors.push('TELEGRAM_BOT_TOKEN has an invalid shape')
}

const explicitRedis = [
  process.env.UPSTASH_REDIS_REST_URL?.trim() ?? '',
  process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? '',
]
const marketplaceRedis = [
  process.env.KV_REST_API_URL?.trim() ?? '',
  process.env.KV_REST_API_TOKEN?.trim() ?? '',
]
if (explicitRedis.filter(Boolean).length === 1) {
  errors.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together')
}
if (marketplaceRedis.filter(Boolean).length === 1) {
  errors.push('KV_REST_API_URL and KV_REST_API_TOKEN must be configured together')
}
if (explicitRedis.every(Boolean)) validUrl('UPSTASH_REDIS_REST_URL', explicitRedis[0], ['https:'])
if (marketplaceRedis.every(Boolean)) validUrl('KV_REST_API_URL', marketplaceRedis[0], ['https:'])

const databasePoolMax = process.env.DATABASE_POOL_MAX?.trim()
if (databasePoolMax) {
  const parsed = Number(databasePoolMax)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    errors.push('DATABASE_POOL_MAX must be an integer from 1 to 20')
  }
}

if (errors.length > 0) {
  console.error(`[production-env] invalid configuration:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

const distributedRateLimitConfigured = explicitRedis.every(Boolean) || marketplaceRedis.every(Boolean)
console.log(
  `[production-env] valid; distributedRateLimit=${distributedRateLimitConfigured ? 'configured' : 'local-fallback'}`,
)
