import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  buildCommand?: string
}
const buildScript = readFileSync('scripts/vercel-build.mjs', 'utf8')
const releaseWorkflow = readFileSync('.github/workflows/release-production.yml', 'utf8')

describe('production release guard', () => {
  it('applies migrations only inside the Vercel production builder', () => {
    expect(vercelConfig.buildCommand).toBe('node scripts/vercel-build.mjs')
    expect(buildScript).toContain("process.env.VERCEL_ENV === 'production'")
    expect(buildScript).toContain("['run', 'prisma:migrate:deploy']")
    expect(buildScript).toContain("['run', 'build']")
  })

  it('uses a remote production build so sensitive Vercel variables stay available', () => {
    expect(releaseWorkflow).toContain('vercel@51.7.0 deploy --yes --prod')
    expect(releaseWorkflow).not.toContain('deploy --prebuilt')
    expect(releaseWorkflow).not.toContain('PRODUCTION_DATABASE_URL')
    expect(releaseWorkflow).not.toContain('PRODUCTION_DIRECT_URL')
  })
})
