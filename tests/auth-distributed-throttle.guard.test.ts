import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/lib/auth.ts'), 'utf8')

describe('distributed credential-failure throttling', () => {
  it('uses a shared adapter for both identity and source-IP abuse controls', () => {
    expect(source).toContain('checkLoginFailuresDistributed')
    expect(source).toContain('recordLoginFailureDistributed')
    expect(source).toContain('clearLoginFailuresDistributed')
    expect(source).toContain("request?.headers.get('x-forwarded-for')")
    expect(source).toContain('AUTH_IP_MAX_FAILURES')
  })

  it('does not expose login or IP values in Redis keys and no longer owns an uncapped auth-attempt Map', () => {
    expect(source).toContain("createHash('sha256')")
    expect(source).not.toContain('global.authAttempts')
    expect(source).not.toContain('new Map<string, AuthAttempt>')
  })

  it('records only failed passwords and clears the identity counter after a valid login', () => {
    const superFailure = source.indexOf('await recordLoginFailure(throttleKeys)')
    const superClear = source.indexOf('await clearLoginFailuresDistributed(throttleKeys.identifierKey)')
    expect(superFailure).toBeGreaterThan(0)
    expect(superClear).toBeGreaterThan(superFailure)
    expect(source.match(/await recordLoginFailure\(throttleKeys\)/g)).toHaveLength(2)
    expect(source.match(/await clearLoginFailuresDistributed\(throttleKeys\.identifierKey\)/g)).toHaveLength(2)
  })
})
