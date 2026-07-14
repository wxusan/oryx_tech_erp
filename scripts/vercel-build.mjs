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
  if (process.env.ORYX_GUARDED_RELEASE !== 'github-actions') {
    throw new Error(
      'Production deploys must run through the guarded GitHub release workflow; automatic Git deploy blocked',
    )
  }
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    throw new Error('Production database URL is required before applying migrations')
  }

  run('node', ['scripts/validate-production-env.mjs'])
  // Produce the application artifact before any schema mutation. The release
  // migrations are additive/backward-compatible, but a compile failure must
  // still leave production data untouched.
  run('npm', ['run', 'build'])
  run('node', ['scripts/production-release-preflight.mjs', '--phase=pre'])
  run('npm', ['run', 'prisma:migrate:deploy'])
  run('node', ['scripts/repair-malika-owner.mjs'])
  run('node', ['scripts/production-release-preflight.mjs', '--phase=post'])
} else {
  run('npm', ['run', 'build'])
}
