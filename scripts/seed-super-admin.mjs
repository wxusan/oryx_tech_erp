import bcrypt from 'bcrypt'
import { Client } from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const email = process.env.SUPER_ADMIN_EMAIL || 'admin@oryx.local'
const name = process.env.SUPER_ADMIN_NAME || 'Super Admin'
const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin12345!'

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required')
}

const client = new Client({ connectionString })

await client.connect()

try {
  const existing = await client.query(
    'select id from "SuperAdmin" where email = $1 and "deletedAt" is null limit 1',
    [email],
  )

  if (existing.rowCount) {
    console.log(`Super admin already exists: ${email}`)
    process.exit(0)
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await client.query(
    `insert into "SuperAdmin" (id, name, email, "passwordHash", role, "createdAt", "updatedAt")
     values (concat('sa_', replace(gen_random_uuid()::text, '-', '')), $1, $2, $3, 'SUPER_ADMIN', now(), now())`,
    [name, email, passwordHash],
  )

  console.log(`Created super admin: ${email}`)
  console.log(`Password: ${password}`)
} finally {
  await client.end()
}
