import bcrypt from 'bcrypt'
import { Client } from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const password = process.env.SEED_SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required')
}

if (!password) {
  throw new Error('SEED_SUPER_ADMIN_PASSWORD is required and must be provided explicitly')
}
if (Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('SEED_SUPER_ADMIN_PASSWORD must not exceed bcrypt\'s 72-byte UTF-8 limit')
}

function normalizeLogin(value) {
  return value.trim().toLowerCase()
}

const admins = [
  {
    login: normalizeLogin(process.env.SEED_SUPER_ADMIN_LOGIN || process.env.SUPER_ADMIN_LOGIN || 'oryx_abdulloh'),
    name: process.env.SEED_SUPER_ADMIN_NAME || process.env.SUPER_ADMIN_NAME || 'Abdulloh',
  },
  {
    login: normalizeLogin(process.env.SEED_SUPER_ADMIN_2_LOGIN || 'wxusan'),
    name: process.env.SEED_SUPER_ADMIN_2_NAME || 'Xusan',
  },
]

const uniqueAdmins = admins.filter((admin, index) => {
  if (!admin.login) {
    throw new Error('Super admin login is required')
  }

  return admins.findIndex((candidate) => candidate.login === admin.login) === index
})

const client = new Client({ connectionString })

await client.connect()

async function upsertSuperAdmin(admin) {
  const existing = await client.query(
    `select id
     from "SuperAdmin"
     where "deletedAt" is null and login = $1
     limit 1`,
    [admin.login],
  )
  const passwordHash = await bcrypt.hash(password, 12)

  if (existing.rowCount) {
    await client.query(
      `update "SuperAdmin"
       set login = $1,
           name = $2,
           "passwordHash" = $3,
           "sessionVersion" = "sessionVersion" + 1,
           "updatedAt" = now()
       where id = $4`,
      [admin.login, admin.name, passwordHash, existing.rows[0].id],
    )

    console.log(`Updated super admin: ${admin.login}`)
    return
  }

  await client.query(
    `insert into "SuperAdmin" (id, name, login, "passwordHash", role, "createdAt", "updatedAt")
     values (concat('sa_', replace(gen_random_uuid()::text, '-', '')), $1, $2, $3, 'SUPER_ADMIN', now(), now())`,
    [admin.name, admin.login, passwordHash],
  )

  console.log(`Created super admin: ${admin.login}`)
}

try {
  for (const admin of uniqueAdmins) {
    await upsertSuperAdmin(admin)
  }
} finally {
  await client.end()
}
