import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('bounded background and storage work', () => {
  const notifications = read('src/lib/notification-service.ts')
  const storage = read('src/lib/server/private-storage-bucket.ts')

  it('drains notifications with bounded concurrency and keeps atomic claims', () => {
    expect(notifications).toContain('const NOTIFICATION_BATCH_SIZE = 100')
    expect(notifications).toContain('const NOTIFICATION_SEND_CONCURRENCY = 5')
    expect(notifications).toContain('await Promise.all(batch.map(async (notification) => {')
    expect(notifications).toContain('const claim = await prisma.notification.updateMany')
  })

  it('broadcasts persist first and start only one queue drain', () => {
    expect(notifications).toContain('{ processImmediately: false }')
    expect(notifications).toContain('await processPendingNotifications()')
  })

  it('coalesces cold checks and reuses successful bucket validation for ten minutes', () => {
    expect(storage).toContain('const BUCKET_CHECK_TTL_MS = 10 * 60_000')
    expect(storage).toContain('if (bucketCheck) return bucketCheck')
    expect(storage).toContain('bucketReadyUntil = Date.now() + BUCKET_CHECK_TTL_MS')
  })
})
