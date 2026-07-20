import 'server-only'

import { revalidateTag } from 'next/cache'

export const shopCacheTag = {
  stats: (shopId: string) => `shop:${shopId}:stats`,
  reports: (shopId: string) => `shop:${shopId}:reports`,
  devices: (shopId: string) => `shop:${shopId}:devices`,
  nasiyalar: (shopId: string) => `shop:${shopId}:nasiyalar`,
  logs: (shopId: string) => `shop:${shopId}:logs`,
  customers: (shopId: string) => `shop:${shopId}:customers`,
  sales: (shopId: string) => `shop:${shopId}:sales`,
  nasiyaSchedules: (shopId: string) => `shop:${shopId}:nasiya-schedules`,
  returns: (shopId: string) => `shop:${shopId}:returns`,
  debts: (shopId: string) => `shop:${shopId}:debts`,
}

export function invalidateShopCache(
  shopId: string,
  tags: Array<(id: string) => string>,
) {
  for (const tag of tags) {
    // Route handlers mutate operational data. Expire immediately so the next
    // navigation after a payment/sale/return does not show stale money/status.
    revalidateTag(tag(shopId), { expire: 0 })
  }
}

export function invalidateShopStats(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.stats, shopCacheTag.reports])
}

export function invalidateShopDeviceMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.devices,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
      shopCacheTag.debts,
    ],
  )
}

export function invalidateShopSaleMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.devices,
      shopCacheTag.sales,
      shopCacheTag.customers,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
      shopCacheTag.debts,
    ],
  )
}

export function invalidateShopNasiyaMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.devices,
      shopCacheTag.nasiyalar,
      shopCacheTag.nasiyaSchedules,
      shopCacheTag.customers,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
    ],
  )
}

export function invalidateShopPaymentMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.sales,
      shopCacheTag.nasiyalar,
      shopCacheTag.nasiyaSchedules,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
      shopCacheTag.debts,
    ],
  )
}

export function invalidateShopSupplierPayableMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.debts,
      shopCacheTag.devices,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
    ],
  )
}

export function invalidateShopReturnMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.devices,
      shopCacheTag.sales,
      shopCacheTag.nasiyalar,
      shopCacheTag.nasiyaSchedules,
      shopCacheTag.returns,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
    ],
  )
}

export function invalidateShopCustomerMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.customers,
      shopCacheTag.nasiyalar,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
    ],
  )
}

export function invalidateShopReminderMutation(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.nasiyalar, shopCacheTag.logs])
}

/**
 * Invalidate the caches affected when the cron marks nasiya schedules / parent
 * status OVERDUE, so the nasiyalar list, dashboard and reports do not keep
 * serving stale "Faol"/pre-overdue money after a cron run.
 */
export function invalidateShopOverdueCron(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.nasiyalar,
      shopCacheTag.nasiyaSchedules,
      shopCacheTag.stats,
      shopCacheTag.reports,
    ],
  )
}

export function invalidateShopLogMutation(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.logs])
}

export function invalidateShopProfileMutation(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.logs])
}
