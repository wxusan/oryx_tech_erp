import { describe, it } from 'vitest'

/**
 * DB-backed integration tests that CANNOT be honestly covered by unit tests.
 * They require a disposable Postgres test database (with the migrations applied,
 * incl. the raw-SQL partial unique indexes) and the API route handlers running
 * against it. Left as `it.todo` so they show up as pending rather than faking
 * confidence.
 *
 * Suggested setup when adding these: spin up a throwaway Postgres (docker or a
 * dedicated Supabase branch), run `prisma migrate deploy`, then exercise the
 * route handlers directly with a real PrismaClient.
 */
describe('integration (needs a Postgres test DB) — TODO', () => {
  it.todo('req 3: a nasiya payment is applied to the SELECTED month first, then oldest-due')
  it.todo('req 4: reusing the same Idempotency-Key does not create a second payment (unique constraint)')
  it.todo('req 4: two concurrent payments cannot corrupt the nasiya balance (Serializable + optimistic guard)')
  it.todo('req 5: a RETURNED device is rejected by POST /devices/[id]/sell and /nasiya (409)')
  it.todo('req 6: a restocked (IN_STOCK) device can be sold again')
  it.todo('req 7: a cancelled/returned nasiya is excluded from /stats/shop overdue + expected totals')
  it.todo('req 9: inserting a duplicate ACTIVE (shopId,imei) is rejected, but a soft-deleted IMEI can be reused')
  it.todo('req 10: inserting a duplicate ACTIVE (shopId,normalizedPhone) is rejected per shop')
  it.todo('req 11: a shop admin session cannot read/modify another shop’s device/nasiya/customer (403/empty)')
  it.todo('req 12: an OVERDUE schedule still emits a reminder on the next cron day, deduped once per day')

  // Telegram integration (needs a DB + a stubbed Telegram API):
  it.todo('telegram: /start on a manually-entered SuperAdmin id stamps telegramVerifiedAt and welcomes')
  it.todo('telegram: /start on a manually-entered ShopAdmin id welcomes with the shop name')
  it.todo('telegram: /start on an unknown id replies with the not-linked message and writes nothing')
  it.todo('telegram: device return queues exactly one RETURN notification per verified admin of THAT shop only')
  it.todo('telegram: device restock queues exactly one RESTOCK notification per verified admin of THAT shop only')
  it.todo('telegram: a double-click return (2nd request 409s on the atomic guard) does not queue a duplicate')
  it.todo('telegram: a deleted/inactive/unverified admin of the shop receives no return/restock notification')
})
