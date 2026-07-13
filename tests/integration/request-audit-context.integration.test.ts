import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { withRequestAuditContext } from '@/lib/server/request-context'

const createdLogIds: string[] = []
const createdOpsIds: string[] = []

afterAll(async () => {
  await prisma.log.deleteMany({ where: { id: { in: createdLogIds } } })
  await prisma.opsEvent.deleteMany({ where: { id: { in: createdOpsIds } } })
  await prisma.$disconnect()
})

describe('request correlation persistence', () => {
  it('automatically attaches one request to transaction business logs and ops events', async () => {
    const context = {
      requestId: `integration-request-${Date.now()}`,
      networkId: 'h1:0123456789abcdef0123456789abcdef',
    }

    const result = await withRequestAuditContext(context, () => prisma.$transaction(async (tx) => {
      const business = await tx.log.create({
        data: {
          actorId: 'request-audit-test-actor',
          actorType: 'SUPER_ADMIN',
          action: 'REQUEST_CONTEXT_TEST',
          targetType: 'Test',
          targetId: context.requestId,
        },
      })
      const ops = await tx.opsEvent.create({
        data: {
          event: 'request.context.test',
          message: 'request context integration test',
        },
      })
      return { business, ops }
    }))

    createdLogIds.push(result.business.id)
    createdOpsIds.push(result.ops.id)
    expect(result.business.requestId).toBe(context.requestId)
    expect(result.business.ipAddress).toBe(context.networkId)
    expect(result.ops.requestId).toBe(context.requestId)
  })
})
