import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  buildCommand?: string
  git?: { deploymentEnabled?: Record<string, boolean> }
}
const buildScript = readFileSync('scripts/vercel-build.mjs', 'utf8')
const preflightScript = readFileSync('scripts/production-release-preflight.mjs', 'utf8')
const prismaConfig = readFileSync('prisma.config.ts', 'utf8')
const releaseWorkflow = readFileSync('.github/workflows/release-production.yml', 'utf8')

describe('production release guard', () => {
  it('applies migrations only inside the Vercel production builder', () => {
    expect(vercelConfig.buildCommand).toBe('node scripts/vercel-build.mjs')
    expect(buildScript).toContain("process.env.VERCEL_ENV === 'production'")
    expect(buildScript).toContain("['scripts/validate-production-env.mjs']")
    expect(buildScript).toContain("['scripts/production-release-preflight.mjs', '--phase=pre']")
    expect(buildScript).toContain("['run', 'prisma:migrate:deploy']")
    expect(buildScript).toContain("['scripts/production-release-preflight.mjs', '--phase=post']")
    expect(buildScript).toContain("['run', 'build']")
    expect(buildScript.indexOf("['run', 'build']")).toBeLessThan(
      buildScript.indexOf("['scripts/production-release-preflight.mjs', '--phase=pre']"),
    )
    expect(buildScript.indexOf("['scripts/production-release-preflight.mjs', '--phase=pre']")).toBeLessThan(
      buildScript.indexOf("['run', 'prisma:migrate:deploy']"),
    )
  })

  it('disables automatic main deployments so only the guarded workflow publishes production', () => {
    expect(vercelConfig.git?.deploymentEnabled?.main).toBe(false)
  })

  it('runs count-only read-only checks before release and verifies all migrations afterward', () => {
    expect(preflightScript).toContain(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    )
    expect(preflightScript).toContain('blockingIssueCount')
    expect(preflightScript).toContain('pending_notifications_without_intended_recipient')
    expect(preflightScript).toContain('pending_notification_recipient_identity_mismatch')
    expect(preflightScript).toContain("phase === 'post'")
    expect(preflightScript).toContain('appliedMigrations.length !== RELEASE_MIGRATIONS.length')
    expect(preflightScript).not.toContain('SELECT *')
  })

  it('does not let local dotenv files replace an explicitly selected release database', () => {
    expect(prismaConfig).toContain('explicitDatabaseUrl')
    expect(prismaConfig).toContain('explicitDirectUrl')
    expect(prismaConfig).toContain(
      'if (explicitDatabaseUrl !== undefined) process.env["DATABASE_URL"] = explicitDatabaseUrl',
    )
    expect(prismaConfig).toContain(
      'if (explicitDirectUrl !== undefined) process.env["DIRECT_URL"] = explicitDirectUrl',
    )
  })

  it('uses a remote production build so sensitive Vercel variables stay available', () => {
    expect(releaseWorkflow).toContain('vercel@51.7.0 deploy --yes --prod')
    expect(releaseWorkflow).not.toContain('deploy --prebuilt')
    expect(releaseWorkflow).not.toContain('PRODUCTION_DATABASE_URL')
    expect(releaseWorkflow).not.toContain('PRODUCTION_DIRECT_URL')
  })

  it('releases only the exact green main push and rechecks main before promotion', () => {
    expect(releaseWorkflow).toContain("github.ref == 'refs/heads/main'")
    expect(releaseWorkflow).toContain('gh run list --workflow ci.yml --branch main')
    expect(releaseWorkflow).toContain('--event push --status success')
    expect(releaseWorkflow).toContain('.headBranch == "main"')
    expect(releaseWorkflow).toContain('.headSha == $sha')
    expect(releaseWorkflow).toContain('git ls-remote origin refs/heads/main')
    expect(releaseWorkflow).toContain('test "$remote_main" = "$GITHUB_SHA"')
  })

  it('authenticates to the protected artifact and validates its database and exact commit', () => {
    expect(releaseWorkflow).toContain('vercel@51.7.0 curl /api/health --deployment')
    expect(releaseWorkflow).toContain('.ok == true')
    expect(releaseWorkflow).toContain('.database == "ok"')
    expect(releaseWorkflow).toContain('.commit == $commit')
    expect(releaseWorkflow).not.toContain('curl --fail --silent --show-error --retry 3')
  })

  it('promotes the verified immutable deployment inside the configured Vercel scope', () => {
    expect(releaseWorkflow).toContain('--format=json --scope="$VERCEL_ORG_ID"')
    expect(releaseWorkflow).toContain("deployment_id=\"$(jq -r '.id // empty'")
    expect(releaseWorkflow).toContain('[[ "$deployment_id" == dpl_* ]]')
    expect(releaseWorkflow).toContain(
      'promote "${{ steps.verify.outputs.deployment_id }}" --yes --scope="$VERCEL_ORG_ID"',
    )
    expect(releaseWorkflow).not.toContain('promote "${{ steps.deploy.outputs.url }}"')
  })

  it('pins the declared Node and npm major/tool version in CI and release', () => {
    expect(releaseWorkflow).toContain('node-version: 24.x')
    expect(releaseWorkflow).toContain('npm install --global npm@10.9.4')
  })
})
