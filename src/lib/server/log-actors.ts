import 'server-only'

import { prisma } from '@/lib/prisma'

type ActorType = 'SUPER_ADMIN' | 'SHOP_ADMIN'

type LogActorInput = {
  actorId: string
  actorType: ActorType
}

export async function enrichLogsWithActors<T extends LogActorInput>(logs: T[]) {
  const superAdminIds = [...new Set(logs.filter((log) => log.actorType === 'SUPER_ADMIN').map((log) => log.actorId))]
  const shopAdminIds = [...new Set(logs.filter((log) => log.actorType === 'SHOP_ADMIN').map((log) => log.actorId))]

  const [superAdmins, shopAdmins] = await Promise.all([
    superAdminIds.length
      ? prisma.superAdmin.findMany({
          where: { id: { in: superAdminIds } },
          select: { id: true, name: true, login: true },
        })
      : [],
    shopAdminIds.length
      ? prisma.shopAdmin.findMany({
          where: { id: { in: shopAdminIds } },
          select: { id: true, name: true, login: true },
        })
      : [],
  ])

  const superAdminById = new Map(superAdmins.map((admin) => [admin.id, admin]))
  const shopAdminById = new Map(shopAdmins.map((admin) => [admin.id, admin]))

  return logs.map((log) => {
    const actor = log.actorType === 'SUPER_ADMIN' ? superAdminById.get(log.actorId) : shopAdminById.get(log.actorId)

    return {
      ...log,
      actorName: actor?.name ?? null,
      actorLogin: actor?.login ?? null,
    }
  })
}
