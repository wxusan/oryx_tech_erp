import bcrypt from 'bcrypt'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const repairEnabled = process.env.ORYX_MALIKA_OWNER_REPAIR === '1'

if (!repairEnabled) process.exit(0)

if (process.env.VERCEL_ENV !== 'production' || process.env.ORYX_GUARDED_RELEASE !== 'github-actions') {
  throw new Error('Malika owner repair may run only in a guarded Vercel production release')
}

const password = process.env.ORYX_MALIKA_OWNER_REPAIR_PASSWORD
if (!password) throw new Error('ORYX_MALIKA_OWNER_REPAIR_PASSWORD is required when the repair is enabled')
if (Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('ORYX_MALIKA_OWNER_REPAIR_PASSWORD must not exceed bcrypt\'s 72-byte UTF-8 limit')
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('Production database URL is required for the Malika owner repair')

const SHOP_NAME = 'Malika Mobile Pro'
const OWNER_NAME = 'Malika Admin'
const OWNER_PHONE = '+998901112233'
const OWNER_LOGIN = 'malika_owner'

const client = new Client({ connectionString })

try {
  await client.connect()
  await client.query('BEGIN')

  const shopResult = await client.query(
    `SELECT "id", "ownerAdminId", "ownershipStatus"
     FROM "Shop"
     WHERE "name" = $1 AND "deletedAt" IS NULL
     FOR UPDATE`,
    [SHOP_NAME],
  )

  if (shopResult.rowCount !== 1) {
    throw new Error(`Expected exactly one active ${SHOP_NAME} shop, found ${shopResult.rowCount ?? 0}`)
  }

  const shop = shopResult.rows[0]
  const existingLogin = await client.query(
    `SELECT "id", "shopId", "deletedAt"
     FROM "ShopAdmin"
     WHERE "login" = $1
     FOR UPDATE`,
    [OWNER_LOGIN],
  )

  let ownerId
  if (existingLogin.rowCount) {
    const account = existingLogin.rows[0]
    if (account.shopId !== shop.id || account.deletedAt) {
      throw new Error(`${OWNER_LOGIN} is already reserved by a different or deleted account`)
    }
    ownerId = account.id
    const passwordHash = await bcrypt.hash(password, 12)
    await client.query(
      `UPDATE "ShopAdmin"
       SET "name" = $1,
           "phone" = $2,
           "passwordHash" = $3,
           "passwordChangedAt" = now(),
           "sessionVersion" = "sessionVersion" + 1,
           "permissionVersion" = "permissionVersion" + 1,
           "isActive" = TRUE,
           "legacyFullAccess" = FALSE
       WHERE "id" = $4`,
      [OWNER_NAME, OWNER_PHONE, passwordHash, ownerId],
    )
    await client.query(
      `UPDATE "AuthSession"
       SET "revokedAt" = now()
       WHERE "actorType" = 'SHOP_ADMIN' AND "actorId" = $1 AND "revokedAt" IS NULL`,
      [ownerId],
    )
  } else {
    ownerId = `admin_${randomUUID().replaceAll('-', '')}`
    const passwordHash = await bcrypt.hash(password, 12)
    await client.query(
      `INSERT INTO "ShopAdmin" (
         "id", "shopId", "name", "phone", "login", "passwordHash",
         "passwordChangedAt", "sessionVersion", "permissionVersion", "isActive",
         "legacyFullAccess", "telegramNotificationsEnabled", "createdAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), 1, 1, TRUE, FALSE, TRUE, now())`,
      [ownerId, shop.id, OWNER_NAME, OWNER_PHONE, OWNER_LOGIN, passwordHash],
    )
  }

  const actorResult = await client.query(
    `SELECT "id" FROM "SuperAdmin"
     WHERE "deletedAt" IS NULL
     ORDER BY CASE WHEN "login" = 'wxusan' THEN 0 ELSE 1 END, "createdAt"
     LIMIT 1`,
  )
  if (!actorResult.rowCount) throw new Error('An active super-admin is required to audit the Malika owner repair')

  await client.query(
    `UPDATE "Shop"
     SET "ownerAdminId" = $1,
         "ownershipStatus" = 'RESOLVED',
         "ownershipResolvedAt" = now(),
         "ownershipResolvedById" = $2,
         "authorizationVersion" = "authorizationVersion" + 1,
         "updatedAt" = now()
     WHERE "id" = $3`,
    [ownerId, actorResult.rows[0].id, shop.id],
  )

  await client.query(
    `INSERT INTO "Log" (
       "id", "shopId", "actorId", "actorType", "action", "targetType", "targetId", "oldValue", "newValue", "note", "createdAt"
     ) VALUES (
       $1, $2, $3, 'SUPER_ADMIN', 'OWNER_REPAIR', 'ShopAdmin', $4,
       $5::jsonb, $6::jsonb, 'Guarded production repair: created/resolved Malika Mobile Pro owner', now()
     )`,
    [
      `log_${randomUUID().replaceAll('-', '')}`,
      shop.id,
      actorResult.rows[0].id,
      ownerId,
      JSON.stringify({ ownerAdminId: shop.ownerAdminId, ownershipStatus: shop.ownershipStatus }),
      JSON.stringify({ ownerAdminId: ownerId, login: OWNER_LOGIN, name: OWNER_NAME }),
    ],
  )

  await client.query('COMMIT')
  console.log(`Malika owner repair applied safely: ${OWNER_LOGIN}`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
