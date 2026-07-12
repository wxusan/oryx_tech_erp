import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    throw new Error('Production database URL is required before applying migrations')
  }

  run('npm', ['run', 'prisma:migrate:deploy'])
}

run('npm', ['run', 'build'])
