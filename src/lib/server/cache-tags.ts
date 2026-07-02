import 'server-only'

import { revalidatePath, revalidateTag } from 'next/cache'

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
}

function revalidateShopPaths(paths: string[]) {
  for (const path of paths) {
    revalidatePath(path)
  }
}

export function invalidateShopCache(
  shopId: string,
  tags: Array<(id: string) => string>,
  paths: string[] = [],
) {
  for (const tag of tags) {
    // Route handlers mutate operational data. Expire immediately so the next
    // navigation after a payment/sale/return does not show stale money/status.
    revalidateTag(tag(shopId), { expire: 0 })
  }
  revalidateShopPaths(paths)
}

export function invalidateShopStats(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.stats, shopCacheTag.reports], ['/shop/dashboard', '/shop/hisobot'])
}

export function invalidateShopDeviceMutation(shopId: string) {
  invalidateShopCache(
    shopId,
    [
      shopCacheTag.devices,
      shopCacheTag.stats,
      shopCacheTag.reports,
      shopCacheTag.logs,
    ],
    ['/shop/qurilmalar', '/shop/sotuv/new', '/shop/nasiyalar/new', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
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
    ],
    ['/shop/qurilmalar', '/shop/sotuv/new', '/shop/mijozlar', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
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
    ['/shop/qurilmalar', '/shop/nasiyalar', '/shop/nasiyalar/new', '/shop/mijozlar', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
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
    ],
    ['/shop/nasiyalar', '/shop/qurilmalar', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
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
    ['/shop/qurilmalar', '/shop/nasiyalar', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
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
    ['/shop/mijozlar', '/shop/nasiyalar', '/shop/dashboard', '/shop/hisobot', '/shop/logs'],
  )
}

export function invalidateShopReminderMutation(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.nasiyalar, shopCacheTag.logs], ['/shop/nasiyalar', '/shop/logs'])
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
    ['/shop/nasiyalar', '/shop/dashboard', '/shop/hisobot'],
  )
}

export function invalidateShopLogMutation(shopId: string) {
  invalidateShopCache(shopId, [shopCacheTag.logs], ['/shop/logs'])
}
