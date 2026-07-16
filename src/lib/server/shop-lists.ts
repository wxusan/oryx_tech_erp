import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import { resolveShopLogTargetHrefs, shopLogTargetKey } from '@/lib/server/log-links'
import { redactShopStaffLogValue } from '@/lib/log-financial-redaction'
import type { NasiyaDisplayStatus } from '@/lib/nasiya-utils'
import { computeNasiyaPaymentScore, type NasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { computeSaleContractMargin, type PurchaseCostLike } from '@/lib/nasiya-contract'
import { addMoneyDto, createMoneyDto, type CurrencyCode, type MoneyDto } from '@/lib/currency'
import { reconcileNasiyaLedger, type NasiyaLedgerDto } from '@/lib/nasiya-ledger'
import { normalizePhone } from '@/lib/phone'
import type { DeviceListItem, DeviceListSaleInfo } from '@/lib/device-list-contract'
import { deviceConditionLabel, formatDeviceStorage } from '@/lib/device-specs'
import { tashkentDayRange } from '@/lib/timezone'
import type { DeviceStatus, NasiyaStatus } from '@/lib/domain-types'
import { logCategoryWhere, type LogCategory } from '@/lib/log-categories'

/**
 * Real page/skip/take pagination envelope for the devices/nasiyalar list
 * pages — replaces the old "fetch up to a hard cap, show a truncation
 * banner" pattern. A shop with any number of devices/nasiyalar can now be
 * browsed page by page instead of having rows past a fixed cap silently
 * invisible (see docs/audits/full-production-audit.md's pagination
 * follow-up, now resolved).
 */
export interface ShopListPage<T> {
  items: T[]
  total: number
  skip: number
  take: number
}

const LIST_DEFAULT_TAKE = 25
const LIST_MAX_TAKE = 100

function clampTake(take?: number): number {
  if (take == null || !Number.isFinite(take)) return LIST_DEFAULT_TAKE
  return Math.trunc(Math.min(Math.max(take, 1), LIST_MAX_TAKE))
}

function clampSkip(skip?: number): number {
  if (skip == null || !Number.isFinite(skip)) return 0
  return Math.trunc(Math.max(skip, 0))
}

/**
 * Sale/nasiya summary for a sold/returned device — purchase price vs. sold
 * price, kept separate from any nasiya interest (accounting already splits
 * `totalAmount` = original device price from `interestAmount`, so device
 * profit never silently absorbs interest income). `profit` is `null` for a
 * returned device rather than a misleading number.
 *
 * `soldPrice`/`profit`/`interestAmount` stay exactly as before (the legacy
 * UZS snapshot, frozen at creation rate) for backward compatibility.
 * `contractCurrency`/`contractSoldPrice`/`contractProfit` are additive —
 * the deal's own native-currency source of truth, used by the UI to avoid
 * reconverting the legacy snapshot through today's rate (see
 * docs/currency-accounting-model.md).
 */
export type ShopDeviceSaleInfo = DeviceListSaleInfo
export type ShopDeviceListItem = DeviceListItem

/**
 * The device list is also used as the canonical mutation/sync DTO. Make
 * owner-financial visibility explicit at every call site so a worker never
 * receives purchase cost or margin merely because the UI happens to hide it.
 */
export interface ShopDeviceListVisibility {
  includeOwnerFinancials: boolean
}

/**
 * A schedule-derived collection task, scoped to one operational tab. A
 * contract can have a different unpaid schedule in both OVERDUE and
 * DUE_TODAY; that is intentional. Each individual schedule belongs to only
 * one cohort, and each contract appears at most once within a given tab.
 */
export type NasiyaCollectionCohort = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'

export interface NasiyaCollectionWorkItem {
  cohort: NasiyaCollectionCohort
  /** Outstanding balance of schedules in this cohort, in contract currency. */
  outstanding: MoneyDto
  /** Earliest effective due date represented by this collection task. */
  effectiveDue: string
  /** First still-open schedule in this cohort; payment/defer actions target it. */
  preferredScheduleId: string
}

export interface ShopNasiyaListItem {
  id: string
  interestPercent: number
  contractCurrency: 'UZS' | 'USD'
  contractInterest: MoneyDto
  ledger: NasiyaLedgerDto
  /** Stored parent status (kept for reference / debugging). */
  status: Exclude<NasiyaStatus, 'CANCELLED'>
  /** Operational collection state; separate from the immutable financial ledger. */
  resolutionState: 'ACTIVE' | 'ARCHIVED'
  resolutionUpdatedAt: string | null
  /** True for imported (pre-Oryx) nasiyas — shown with an "Eski nasiya" badge. */
  isImported: boolean
  /** Live display status derived from schedules (matches the dashboard). */
  displayStatus: Exclude<NasiyaDisplayStatus, 'CANCELLED'>
  isOverdue: boolean
  overdueAmount: MoneyDto
  overdueCount: number
  nextPaymentDate: string | null
  createdAt: string
  note: string | null
  device: { id: string; model: string; imei: string }
  customer: { id: string; name: string; phone: string }
  schedules: {
    id: string
    dueDate: string
    delayedUntil: string | null
    status: string
  }[]
  /** Present only for a schedule-derived operational queue tab. */
  collectionWorkItem: NasiyaCollectionWorkItem | null
  /** Professional payment-behavior score (docs/nasiya-payment-scoring.md). */
  paymentScore: NasiyaPaymentScore
}

export interface ShopLogListItem {
  id: string
  createdAt: string
  actorId: string
  actorType: 'SUPER_ADMIN' | 'SHOP_ADMIN'
  actorName?: string | null
  actorLogin?: string | null
  action: string
  targetType: string
  targetId: string
  note: string | null
  newValue: Prisma.JsonValue | null
  href: string | null
}

export interface ShopLogsPayload {
  logs: ShopLogListItem[]
  total: number
}

export interface ShopLogsQuery {
  search?: string
  dateFrom?: string
  dateTo?: string
  category?: LogCategory
  actorId?: string
  page?: number
  take?: number
}

export function initialLogsRequestKey(query: ShopLogsQuery = {}) {
  const params = new URLSearchParams()
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.category && query.category !== 'all') params.set('category', query.category)
  if (query.actorId) params.set('actorId', query.actorId)
  if (query.dateFrom) params.set('from', query.dateFrom)
  if (query.dateTo) params.set('to', query.dateTo)
  const take = query.take ?? 10
  params.set('skip', String(((query.page ?? 1) - 1) * take))
  params.set('take', String(take))
  return params.toString()
}

export type DeviceStatusFilter = DeviceStatus

export interface ShopDevicesQuery {
  search?: string
  status?: DeviceStatusFilter
  condition?: 'NEW' | 'USED'
  skip?: number
  take?: number
}

export function buildShopDevicesWhere(shopId: string, query: Pick<ShopDevicesQuery, 'search' | 'status' | 'condition'>): Prisma.DeviceWhereInput {
  const search = query.search?.trim() || undefined
  const searchDigits = search ? normalizePhone(search) : null
  const searchImei = search?.replace(/[\s-]/g, '') || null

  return {
    shopId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.condition ? { conditionCode: query.condition } : {}),
    ...(search
      ? {
          OR: [
            { imei: { contains: search, mode: 'insensitive' as const } },
            { imeis: { some: { deletedAt: null, OR: [{ value: { contains: search, mode: 'insensitive' as const } }, ...(searchImei ? [{ normalizedValue: { contains: searchImei } }] : [])] } } },
            { model: { contains: search, mode: 'insensitive' as const } },
            { color: { contains: search, mode: 'insensitive' as const } },
            { storage: { contains: search, mode: 'insensitive' as const } },
            { note: { contains: search, mode: 'insensitive' as const } },
            { supplier: { name: { contains: search, mode: 'insensitive' as const } } },
            { supplierPhone: { contains: search, mode: 'insensitive' as const } },
            { supplier: { phone: { contains: search, mode: 'insensitive' as const } } },
            { sales: { some: { customer: { phone: { contains: search, mode: 'insensitive' as const } } } } },
            { sales: { some: { customer: { name: { contains: search, mode: 'insensitive' as const } } } } },
            { nasiya: { some: { customer: { phone: { contains: search, mode: 'insensitive' as const } } } } },
            { nasiya: { some: { customer: { name: { contains: search, mode: 'insensitive' as const } } } } },
            ...(searchDigits
              ? [
                  { sales: { some: { customer: { additionalPhones: { has: searchDigits } } } } },
                  { nasiya: { some: { customer: { additionalPhones: { has: searchDigits } } } } },
                ]
              : []),
          ],
        }
      : {}),
  }
}

const shopDeviceListSelect = {
  id: true,
  model: true,
  color: true,
  storage: true,
  storageAmount: true,
  storageUnit: true,
  conditionCode: true,
  batteryHealth: true,
  purchasePrice: true,
  purchaseCurrency: true,
  purchaseInputAmount: true,
  purchaseAmountUzsSnapshot: true,
  imei: true,
  imeis: { where: { deletedAt: null }, orderBy: { slot: 'asc' as const }, select: { slot: true, value: true, normalizedValue: true } },
  status: true,
  createdAt: true,
  note: true,
  supplierPhone: true,
  supplier: { select: { name: true } },
  sales: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      salePrice: true,
      createdAt: true,
      customer: { select: { name: true } },
      contractCurrency: true,
      contractSalePrice: true,
      contractRemainingAmount: true,
      contractExchangeRateAtCreation: true,
      dueDate: true,
    },
  },
  nasiya: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      totalAmount: true,
      interestAmount: true,
      createdAt: true,
      customer: { select: { name: true } },
      contractCurrency: true,
      contractTotalAmount: true,
      contractExchangeRateAtCreation: true,
    },
  },
  returns: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { refundAmount: true, createdAt: true },
  },
} satisfies Prisma.DeviceSelect

type ShopDeviceListRow = Prisma.DeviceGetPayload<{ select: typeof shopDeviceListSelect }>

/** Pick whichever of the device's latest sale/nasiya is more recent and build its profit summary. */
function buildDeviceSaleInfo(device: {
  status: string
  purchasePrice: unknown
  purchaseCurrency: CurrencyCode
  purchaseInputAmount: unknown
  purchaseAmountUzsSnapshot: unknown
  sales: {
    salePrice: unknown
    createdAt: Date
    customer: { name: string }
    contractCurrency: CurrencyCode
    contractSalePrice: unknown
    contractRemainingAmount: unknown
    contractExchangeRateAtCreation: unknown
    dueDate: Date | null
  }[]
  nasiya: {
    totalAmount: unknown
    interestAmount: unknown
    createdAt: Date
    customer: { name: string }
    contractCurrency: CurrencyCode
    contractTotalAmount: unknown
    contractExchangeRateAtCreation: unknown
  }[]
  returns: { refundAmount: unknown; createdAt: Date }[]
}): ShopDeviceSaleInfo | null {
  const latestSale = device.sales[0]
  const latestNasiya = device.nasiya[0]
  if (!latestSale && !latestNasiya) return null

  const useNasiya = !!latestNasiya && (!latestSale || latestNasiya.createdAt > latestSale.createdAt)
  const purchasePrice = Number(device.purchasePrice)
  const latestReturn = device.returns[0]
  const latestContractAt = useNasiya ? latestNasiya!.createdAt : latestSale!.createdAt
  const returned = device.status === 'RETURNED' || Boolean(latestReturn && latestReturn.createdAt >= latestContractAt)
  const refundAmount = latestReturn ? Number(latestReturn.refundAmount) : null
  // Device's own purchase-currency context — lets a same-currency sale/purchase
  // pair (e.g. bought $400, sold $500) skip FX conversion entirely instead of
  // round-tripping through UZS at a possibly different rate. See
  // docs/currency-accounting-model.md.
  const purchase: PurchaseCostLike = {
    purchaseCurrency: device.purchaseCurrency,
    purchaseInputAmount: Number(device.purchaseInputAmount),
    purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
  }

  if (useNasiya && latestNasiya) {
    // totalAmount = original device price BEFORE interest (see Nasiya model comment) —
    // never fold interest into device profit.
    const soldPrice = Number(latestNasiya.totalAmount)
    const contractCurrency = latestNasiya.contractCurrency
    const contractSoldPrice = Number(latestNasiya.contractTotalAmount)
    const contractExchangeRateAtCreation =
      latestNasiya.contractExchangeRateAtCreation != null ? Number(latestNasiya.contractExchangeRateAtCreation) : null
    return {
      saleType: 'NASIYA',
      soldPrice,
      interestAmount: Number(latestNasiya.interestAmount),
      profit: returned ? null : soldPrice - purchasePrice,
      contractCurrency,
      contractSoldPrice,
      contractRemainingAmount: null,
      contractProfit: returned ? null : computeSaleContractMargin(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase),
      customerName: latestNasiya.customer.name,
      soldAt: latestNasiya.createdAt.toISOString(),
      dueDate: null,
      returned,
      refundAmount,
    }
  }
  const soldPrice = Number(latestSale!.salePrice)
  const contractCurrency = latestSale!.contractCurrency
  const contractSoldPrice = Number(latestSale!.contractSalePrice)
  const contractRemainingAmount = Number(latestSale!.contractRemainingAmount)
  const contractExchangeRateAtCreation =
    latestSale!.contractExchangeRateAtCreation != null ? Number(latestSale!.contractExchangeRateAtCreation) : null
  return {
    saleType: 'CASH',
    soldPrice,
    interestAmount: 0,
    profit: returned ? null : soldPrice - purchasePrice,
    contractCurrency,
    contractSoldPrice,
    contractRemainingAmount,
    contractProfit: returned ? null : computeSaleContractMargin(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase),
    customerName: latestSale!.customer.name,
    soldAt: latestSale!.createdAt.toISOString(),
    dueDate: latestSale!.dueDate?.toISOString() ?? null,
    returned,
    refundAmount,
  }
}

function mapShopDeviceListRow(device: ShopDeviceListRow): ShopDeviceListItem {
  const primaryImei = device.imeis.find((entry) => entry.slot === 'PRIMARY')?.value ?? device.imei
  const secondaryImei = device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null
  return {
    id: device.id,
    model: device.model,
    color: device.color,
    storage: device.storage,
    storageAmount: device.storageAmount == null ? null : Number(device.storageAmount),
    storageUnit: device.storageUnit,
    storageDisplay: formatDeviceStorage(device),
    conditionCode: device.conditionCode,
    conditionLabel: deviceConditionLabel(device.conditionCode) as 'Yangi' | 'B/U' | 'Belgilanmagan',
    batteryHealth: device.batteryHealth,
    purchasePrice: Number(device.purchasePrice),
    imei: primaryImei,
    primaryImei,
    secondaryImei,
    status: device.status,
    createdAt: device.createdAt.toISOString(),
    note: device.note,
    supplierName: device.supplier?.name ?? null,
    supplierPhone: device.supplierPhone,
    saleInfo: buildDeviceSaleInfo(device),
  }
}

/**
 * Remove information that exposes a shop's cost basis or margin. Omission is
 * intentional: null/zero values are too easy to reinterpret as real data and
 * would remain in client caches across subsequent navigation.
 */
export function redactShopDeviceOwnerFinancials(item: ShopDeviceListItem): ShopDeviceListItem {
  const safeItem = { ...item }
  delete safeItem.purchasePrice
  if (!safeItem.saleInfo) return { ...safeItem, saleInfo: null }

  const safeSaleInfo = { ...safeItem.saleInfo }
  delete safeSaleInfo.profit
  delete safeSaleInfo.contractProfit
  return { ...safeItem, saleInfo: safeSaleInfo }
}

/**
 * Real page/skip/take pagination for the devices list — search/status are
 * applied server-side (via a Prisma `where`, run through `count()` with the
 * exact same clause as `findMany` so `total` always matches what could be
 * paged through). `search` mirrors the OR clause already used by
 * GET /api/devices (IMEI / model / color / storage / note / supplier phone /
 * customer name+phone).
 */
export async function getShopDevicesList(
  shopId: string,
  query: ShopDevicesQuery,
  visibility: ShopDeviceListVisibility,
): Promise<ShopListPage<ShopDeviceListItem>> {
  const take = clampTake(query.take)
  const skip = clampSkip(query.skip)
  const where = buildShopDevicesWhere(shopId, query)
  const debtPage = query.status === 'SOLD_DEBT'
    ? await findShopDebtDeviceIdsByPriority({
        shopId,
        search: query.search,
        condition: query.condition,
        skip,
        take,
      })
    : null

  const [rows, total] = await Promise.all([
    prisma.device.findMany({
      // The debt work queue is selected and ordered in PostgreSQL from its
      // authoritative Sale due-date predicates. Fetch the complete DTO by
      // the bounded IDs afterwards so the generic device projection stays
      // the one source of display truth.
      where: debtPage ? { shopId, deletedAt: null, id: { in: debtPage.ids } } : where,
      orderBy: { createdAt: 'desc' },
      ...(debtPage ? {} : { skip, take }),
      select: shopDeviceListSelect,
    }),
    debtPage ? Promise.resolve(debtPage.total) : prisma.device.count({ where }),
  ])

  const orderedRows = debtPage
    ? debtPage.ids.flatMap((id) => {
        const row = rows.find((candidate) => candidate.id === id)
        return row ? [row] : []
      })
    : rows

  return {
    items: orderedRows.map((row) => {
      const item = mapShopDeviceListRow(row)
      return visibility.includeOwnerFinancials ? item : redactShopDeviceOwnerFinancials(item)
    }),
    total,
    skip,
    take,
  }
}

interface DebtDeviceIdRow {
  id: string
  total: bigint
}

/**
 * Qarz is an operational queue, not a newest-device list. This bounded
 * set-based query gives every debt device one priority:
 * overdue → due today → upcoming → legacy/no due date. It deliberately uses
 * the same Asia/Tashkent bounds as the payment banners and never hydrates a
 * shop's full inventory just to sort it in JavaScript.
 */
async function findShopDebtDeviceIdsByPriority(input: {
  shopId: string
  search?: string
  condition?: 'NEW' | 'USED'
  skip: number
  take: number
  now?: Date
}) {
  const search = input.search?.trim() || null
  const searchDigits = search ? normalizePhone(search) : null
  const searchImei = search?.replace(/[\s-]/g, '') || null
  const { start, end } = tashkentDayRange(input.now ?? new Date())
  const conditionPredicate = input.condition
    ? Prisma.sql`AND d."conditionCode" = ${input.condition}`
    : Prisma.empty
  const searchPredicate = search
    ? Prisma.sql`AND (
        d."imei" ILIKE '%' || ${search} || '%'
        OR d."model" ILIKE '%' || ${search} || '%'
        OR d."color" ILIKE '%' || ${search} || '%'
        OR d."storage" ILIKE '%' || ${search} || '%'
        OR d."note" ILIKE '%' || ${search} || '%'
        OR d."supplierPhone" ILIKE '%' || ${search} || '%'
        OR c."name" ILIKE '%' || ${search} || '%'
        OR c."phone" ILIKE '%' || ${search} || '%'
        OR EXISTS (
          SELECT 1 FROM "DeviceImei" di
          WHERE di."deviceId" = d."id" AND di."shopId" = d."shopId" AND di."deletedAt" IS NULL
            AND (di."value" ILIKE '%' || ${search} || '%'
              OR (${searchImei}::text IS NOT NULL AND di."normalizedValue" ILIKE '%' || ${searchImei} || '%'))
        )
        OR EXISTS (
          SELECT 1 FROM "Supplier" supplier
          WHERE supplier."id" = d."supplierId" AND supplier."shopId" = d."shopId"
            AND (supplier."name" ILIKE '%' || ${search} || '%'
              OR supplier."phone" ILIKE '%' || ${search} || '%')
        )
        OR (${searchDigits}::text IS NOT NULL AND c."additionalPhones" @> ARRAY[${searchDigits}]::text[])
      )`
    : Prisma.empty

  const rows = await prisma.$queryRaw<DebtDeviceIdRow[]>(Prisma.sql`
    WITH debt_devices AS (
      SELECT
        d."id",
        sale."dueDate" AS due_date,
        sale."createdAt" AS sale_created_at,
        CASE
          WHEN sale."dueDate" < ${start} THEN 0
          WHEN sale."dueDate" < ${end} THEN 1
          WHEN sale."dueDate" IS NOT NULL THEN 2
          ELSE 3
        END AS payment_priority
      FROM "Device" d
      JOIN LATERAL (
        SELECT s."dueDate", s."createdAt", s."customerId"
        FROM "Sale" s
        WHERE s."deviceId" = d."id" AND s."shopId" = d."shopId"
          AND s."deletedAt" IS NULL
          AND s."returnedAt" IS NULL
          AND s."paidFully" = false
          AND s."contractRemainingAmount" > 0
        ORDER BY s."createdAt" DESC, s."id" DESC
        LIMIT 1
      ) sale ON true
      JOIN "Customer" c ON c."id" = sale."customerId" AND c."shopId" = d."shopId"
      WHERE d."shopId" = ${input.shopId}
        AND d."deletedAt" IS NULL
        AND d."status" = 'SOLD_DEBT'
        ${conditionPredicate}
        ${searchPredicate}
    )
    SELECT "id", count(*) OVER()::bigint AS total
    FROM debt_devices
    ORDER BY payment_priority ASC, due_date ASC NULLS LAST, sale_created_at DESC, "id" ASC
    OFFSET ${input.skip} LIMIT ${input.take}
  `)

  return {
    ids: rows.map((row) => row.id),
    total: rows[0] ? Number(rows[0].total) : 0,
  }
}

/** Canonical list DTO resolver used by mutation responses and incremental sync. */
export async function getShopDeviceListItemsByIds(
  shopId: string,
  ids: readonly string[],
  visibility: ShopDeviceListVisibility,
): Promise<ShopDeviceListItem[]> {
  if (ids.length === 0) return []
  const rows = await prisma.device.findMany({
    where: { shopId, id: { in: [...new Set(ids)] }, deletedAt: null },
    select: shopDeviceListSelect,
  })
  const byId = new Map(rows.map((row) => {
    const item = mapShopDeviceListRow(row)
    return [row.id, visibility.includeOwnerFinancials ? item : redactShopDeviceOwnerFinancials(item)]
  }))
  return ids.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

export type NasiyaStatusFilter = Exclude<NasiyaStatus, 'CANCELLED'>
export type NasiyaCohortFilter = 'ACTIVE' | NasiyaCollectionCohort

export interface ShopNasiyalarQuery {
  search?: string
  /**
   * Filters on the contract-derived display status. A status predicate cannot
   * be pushed to the raw parent column: an FX-drifted parent may be stored
   * COMPLETED while its native schedule still owes money.
   */
  status?: NasiyaStatusFilter
  /**
   * Operational due-date queue. Unlike the historical parent status, this is
   * calculated from the open schedule dates with Asia/Tashkent boundaries.
   */
  cohort?: NasiyaCohortFilter
  /** Defaults to ACTIVE so normal collection lists are operational work queues. */
  resolutionState?: 'ACTIVE' | 'ARCHIVED'
  skip?: number
  take?: number
  /** Internal clock injection keeps derived page selection and DTO labels aligned in tests. */
  now?: Date
}

export function buildShopNasiyalarWhere(
  shopId: string,
  query: Pick<ShopNasiyalarQuery, 'search' | 'resolutionState'>,
): Prisma.NasiyaWhereInput {
  const search = query.search?.trim() || undefined
  const searchDigits = search ? normalizePhone(search) : null
  const searchImei = search?.replace(/[\s-]/g, '') || null

  return {
    shopId,
    deletedAt: null,
    // Cancelled contracts are legacy records. Nasiya cancellation is no
    // longer supported, so they are intentionally outside every live list.
    status: { not: 'CANCELLED' },
    resolutionState: query.resolutionState ?? 'ACTIVE',
    ...(search
      ? {
          OR: [
            { customer: { name: { contains: search, mode: 'insensitive' as const } } },
            { customer: { phone: { contains: search, mode: 'insensitive' as const } } },
            { device: { model: { contains: search, mode: 'insensitive' as const } } },
            { device: { imei: { contains: search, mode: 'insensitive' as const } } },
            {
              device: {
                imeis: {
                  some: {
                    deletedAt: null,
                    OR: [
                      { value: { contains: search, mode: 'insensitive' as const } },
                      ...(searchImei ? [{ normalizedValue: { contains: searchImei } }] : []),
                    ],
                  },
                },
              },
            },
            { note: { contains: search, mode: 'insensitive' as const } },
            ...(searchDigits ? [{ customer: { additionalPhones: { has: searchDigits } } }] : []),
          ],
        }
      : {}),
  }
}

interface DerivedStatusIdRow {
  id: string
  total: bigint
}

const OPEN_NASIYA_SCHEDULE_STATUSES = new Set(['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'])

type CollectionSchedule = {
  id: string
  dueDate: Date
  delayedUntil: Date | null
  status: string
}

/**
 * Builds the visible work-item context from the exact selected page of
 * schedules. The PostgreSQL cohort query chooses/paginates contracts; this
 * function supplies the per-cohort amount and first actionable schedule for
 * that already-bounded page. It deliberately does not use the parent
 * contract balance: an old installment must not make a separate installment
 * due today look overdue or inflate its amount.
 */
function deriveNasiyaCollectionWorkItem(input: {
  cohort: NasiyaCohortFilter | undefined
  contractCurrency: CurrencyCode
  ledger: NasiyaLedgerDto
  schedules: readonly CollectionSchedule[]
  now: Date
}): NasiyaCollectionWorkItem | null {
  if (!input.cohort || input.cohort === 'ACTIVE') return null

  const { start, end } = tashkentDayRange(input.now)
  const scheduleLedger = new Map(input.ledger.schedules.map((schedule) => [schedule.id, schedule]))
  const matches = input.schedules.flatMap((schedule) => {
    if (!OPEN_NASIYA_SCHEDULE_STATUSES.has(schedule.status)) return []
    const outstanding = scheduleLedger.get(schedule.id)?.remaining
    if (!outstanding || outstanding.minorUnits <= 0) return []

    const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
    const dueAt = effectiveDue.getTime()
    const belongsToCohort = input.cohort === 'OVERDUE'
      ? dueAt < start.getTime()
      : input.cohort === 'DUE_TODAY'
        ? dueAt >= start.getTime() && dueAt < end.getTime()
        : dueAt >= end.getTime()
    return belongsToCohort ? [{ id: schedule.id, effectiveDue, outstanding }] : []
  }).sort((left, right) => {
    const byDue = left.effectiveDue.getTime() - right.effectiveDue.getTime()
    return byDue || left.id.localeCompare(right.id)
  })

  if (matches.length === 0) return null
  return {
    cohort: input.cohort,
    outstanding: matches.reduce(
      (total, schedule) => addMoneyDto(total, schedule.outstanding),
      createMoneyDto(input.contractCurrency, 0),
    ),
    effectiveDue: matches[0].effectiveDue.toISOString(),
    preferredScheduleId: matches[0].id,
  }
}

/**
 * Page a derived nasiya status in PostgreSQL instead of loading every contract
 * and filtering in Node. The SQL mirrors deriveContractNasiyaStatus for the
 * current non-null native contract fields and uses the same Tashkent day
 * boundary. It returns only IDs; the canonical Prisma projection below still
 * owns all DTO mapping and payment-score behavior.
 */
export async function findShopNasiyaIdsByDerivedStatus(input: {
  shopId: string
  status: NasiyaStatusFilter
  search?: string
  skip: number
  take: number
  now?: Date
}) {
  const search = input.search?.trim() || null
  const searchDigits = search ? normalizePhone(search) : null
  const searchImei = search?.replace(/[\s-]/g, '') || null
  const { start } = tashkentDayRange(input.now ?? new Date())
  const searchPredicate = search
    ? Prisma.sql`AND (
        c."name" ILIKE '%' || ${search} || '%'
        OR c."phone" ILIKE '%' || ${search} || '%'
        OR d."model" ILIKE '%' || ${search} || '%'
        OR d."imei" ILIKE '%' || ${search} || '%'
        OR n."note" ILIKE '%' || ${search} || '%'
        OR EXISTS (
          SELECT 1 FROM "DeviceImei" di
          WHERE di."deviceId" = d."id" AND di."shopId" = n."shopId" AND di."deletedAt" IS NULL
            AND (di."value" ILIKE '%' || ${search} || '%'
              OR (${searchImei}::text IS NOT NULL AND di."normalizedValue" ILIKE '%' || ${searchImei} || '%'))
        )
        OR (${searchDigits}::text IS NOT NULL AND c."additionalPhones" @> ARRAY[${searchDigits}]::text[])
      )`
    : Prisma.empty
  const rows = await prisma.$queryRaw<DerivedStatusIdRow[]>(Prisma.sql`
    WITH contract_rows AS (
      SELECT
        n."id",
        n."createdAt",
        n."status",
        n."contractCurrency",
        count(s."id") AS schedule_count,
        coalesce(bool_and(s."contractRemainingAmount" = 0)
          FILTER (WHERE s."id" IS NOT NULL), false) AS all_schedules_paid,
        coalesce(bool_or(
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") < ${start}
        ), false) AS has_overdue,
        min(coalesce(s."delayedUntil", s."dueDate")) FILTER (WHERE
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
        ) AS next_due
      FROM "Nasiya" n
      JOIN "Customer" c ON c."id" = n."customerId" AND c."shopId" = n."shopId"
      JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
      LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n."id" AND s."shopId" = n."shopId"
      WHERE n."shopId" = ${input.shopId} AND n."deletedAt" IS NULL
        AND n."resolutionState" = 'ACTIVE'
      ${searchPredicate}
      GROUP BY n."id"
    ), derived AS (
      SELECT *, CASE
        WHEN "status" = 'CANCELLED' THEN 'CANCELLED'
        WHEN schedule_count > 0 AND all_schedules_paid THEN 'COMPLETED'
        WHEN has_overdue THEN 'OVERDUE'
        ELSE 'ACTIVE'
      END AS display_status
      FROM contract_rows
    )
    SELECT "id", count(*) OVER()::bigint AS total
    FROM derived
    WHERE display_status = ${input.status}
    ORDER BY next_due ASC NULLS LAST, "createdAt" DESC, "id" ASC
    OFFSET ${input.skip} LIMIT ${input.take}
  `)

  return {
    ids: rows.map((row) => row.id),
    // An offset beyond the final row yields no window-count row. The UI always
    // clamps pages after receiving total; returning 0 here safely self-heals a
    // stale URL without an unbounded fallback query.
    total: rows[0] ? Number(rows[0].total) : 0,
  }
}

/**
 * Page the operational Nasiya collection queues in PostgreSQL. Cohorts are
 * defined per unpaid schedule at Tashkent midnight, never by a parent
 * contract's most severe schedule. A contract with distinct overdue and
 * due-today schedules therefore appears once in each relevant queue; no
 * individual schedule can appear in more than one queue.
 */
export async function findShopNasiyaIdsByCohort(input: {
  shopId: string
  cohort: NasiyaCohortFilter
  search?: string
  skip: number
  take: number
  now?: Date
}) {
  const search = input.search?.trim() || null
  const searchDigits = search ? normalizePhone(search) : null
  const searchImei = search?.replace(/[\s-]/g, '') || null
  const { start, end } = tashkentDayRange(input.now ?? new Date())
  const searchPredicate = search
    ? Prisma.sql`AND (
        c."name" ILIKE '%' || ${search} || '%'
        OR c."phone" ILIKE '%' || ${search} || '%'
        OR d."model" ILIKE '%' || ${search} || '%'
        OR d."imei" ILIKE '%' || ${search} || '%'
        OR n."note" ILIKE '%' || ${search} || '%'
        OR EXISTS (
          SELECT 1 FROM "DeviceImei" di
          WHERE di."deviceId" = d."id" AND di."shopId" = n."shopId" AND di."deletedAt" IS NULL
            AND (di."value" ILIKE '%' || ${search} || '%'
              OR (${searchImei}::text IS NOT NULL AND di."normalizedValue" ILIKE '%' || ${searchImei} || '%'))
        )
        OR (${searchDigits}::text IS NOT NULL AND c."additionalPhones" @> ARRAY[${searchDigits}]::text[])
      )`
    : Prisma.empty
  // Keep the selected work queue explicit in the generated SQL rather than
  // binding a text parameter into boolean expressions. Besides avoiding a
  // PostgreSQL type-inference edge case, this makes the schedule-level
  // cohort rules easy to audit. UPCOMING deliberately remains a next-action
  // queue: it excludes contracts that need an overdue or today's action.
  const cohortPredicate = input.cohort === 'ACTIVE'
    // This is the shop's live-contract tab: late Nasiya is still active, so
    // it belongs here as well as in its more specific OVERDUE work queue.
    ? Prisma.sql`display_status IN ('ACTIVE', 'OVERDUE')`
    : input.cohort === 'OVERDUE'
      ? Prisma.sql`display_status IN ('ACTIVE', 'OVERDUE') AND has_overdue`
      : input.cohort === 'DUE_TODAY'
        ? Prisma.sql`display_status IN ('ACTIVE', 'OVERDUE') AND has_due_today`
        : Prisma.sql`display_status = 'ACTIVE' AND NOT has_overdue AND NOT has_due_today AND has_upcoming`
  const cohortDueOrder = input.cohort === 'OVERDUE'
    ? Prisma.sql`overdue_due`
    : input.cohort === 'DUE_TODAY'
      ? Prisma.sql`due_today_due`
      : input.cohort === 'UPCOMING'
        ? Prisma.sql`upcoming_due`
        : Prisma.sql`next_due`

  const rows = await prisma.$queryRaw<DerivedStatusIdRow[]>(Prisma.sql`
    WITH contract_rows AS (
      SELECT
        n."id",
        n."createdAt",
        n."status",
        n."contractCurrency",
        count(s."id") AS schedule_count,
        coalesce(bool_and(s."contractRemainingAmount" = 0)
          FILTER (WHERE s."id" IS NOT NULL), false) AS all_schedules_paid,
        coalesce(bool_or(
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") < ${start}
        ), false) AS has_overdue,
        coalesce(bool_or(
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") >= ${start}
          AND coalesce(s."delayedUntil", s."dueDate") < ${end}
        ), false) AS has_due_today,
        coalesce(bool_or(
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") >= ${end}
        ), false) AS has_upcoming,
        min(coalesce(s."delayedUntil", s."dueDate")) FILTER (WHERE
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
        ) AS next_due,
        min(coalesce(s."delayedUntil", s."dueDate")) FILTER (WHERE
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") < ${start}
        ) AS overdue_due,
        min(coalesce(s."delayedUntil", s."dueDate")) FILTER (WHERE
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") >= ${start}
          AND coalesce(s."delayedUntil", s."dueDate") < ${end}
        ) AS due_today_due,
        min(coalesce(s."delayedUntil", s."dueDate")) FILTER (WHERE
          s."status" <> 'CANCELLED'
          AND s."contractRemainingAmount" > 0
          AND coalesce(s."delayedUntil", s."dueDate") >= ${end}
        ) AS upcoming_due
      FROM "Nasiya" n
      JOIN "Customer" c ON c."id" = n."customerId" AND c."shopId" = n."shopId"
      JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
      LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n."id" AND s."shopId" = n."shopId"
      WHERE n."shopId" = ${input.shopId} AND n."deletedAt" IS NULL AND n."returnedAt" IS NULL
        AND n."resolutionState" = 'ACTIVE'
      ${searchPredicate}
      GROUP BY n."id"
    ), derived AS (
      SELECT *, CASE
        WHEN "status" = 'CANCELLED' THEN 'CANCELLED'
        WHEN schedule_count > 0 AND all_schedules_paid THEN 'COMPLETED'
        WHEN has_overdue THEN 'OVERDUE'
        ELSE 'ACTIVE'
      END AS display_status
      FROM contract_rows
    )
    SELECT "id", count(*) OVER()::bigint AS total
    FROM derived
    WHERE ${cohortPredicate}
    ORDER BY ${cohortDueOrder} ASC NULLS LAST, "createdAt" DESC, "id" ASC
    OFFSET ${input.skip} LIMIT ${input.take}
  `)

  return {
    ids: rows.map((row) => row.id),
    total: rows[0] ? Number(rows[0].total) : 0,
  }
}

/**
 * Real page/skip/take pagination for the nasiyalar list. `search` mirrors
 * the OR clause already used by GET /api/nasiya (customer name/phone,
 * device model/IMEI, note). Rows are ordered `createdAt desc` at the
 * database level (required for `total`/`skip`/`take` to mean anything
 * across pages). Cohort pages retain their database order, including their
 * cohort-specific effective due date; the unfiltered page keeps its local
 * overdue-first / earliest-next-payment ordering.
 */
export async function getShopNasiyalarList(shopId: string, query: ShopNasiyalarQuery = {}): Promise<ShopListPage<ShopNasiyaListItem>> {
  // Payment-score reason text must reflect the shop's selected display
  // currency (never hardcode UZS) — see docs/nasiya-payment-scoring.md.
  const currency = await getShopCurrencyContext(shopId)

  const take = clampTake(query.take)
  const skip = clampSkip(query.skip)
  // Resolve one clock for both the set-based queue and DTO-derived labels.
  // This avoids a midnight race where a row is selected by one day boundary
  // and rendered by another.
  const now = query.now ?? new Date()
  const where = buildShopNasiyalarWhere(shopId, query)
  const derivedPage = query.cohort
    ? await findShopNasiyaIdsByCohort({ shopId, cohort: query.cohort, search: query.search, skip, take, now })
    : query.status
    ? await findShopNasiyaIdsByDerivedStatus({ shopId, status: query.status, search: query.search, skip, take, now })
    : null

  const [rows, rawTotal] = await Promise.all([
    prisma.nasiya.findMany({
    where: derivedPage ? { ...where, id: { in: derivedPage.ids } } : where,
    orderBy: { createdAt: 'desc' },
    // A requested status is itself derived from contract schedules. Fetch
    // matching search candidates first, then filter/paginate the derived
    // status below; raw status filtering here would hide P0-01 debt.
    ...(derivedPage ? {} : { skip, take }),
    select: {
      id: true,
      totalAmount: true,
      remainingAmount: true,
      baseRemainingAmount: true,
      interestPercent: true,
      interestAmount: true,
      finalNasiyaAmount: true,
      // Native contract-currency ledger — see docs/currency-accounting-model.md.
      contractCurrency: true,
      contractInterestAmount: true,
      contractFinalAmount: true,
      contractPaidAmount: true,
      contractRemainingAmount: true,
      status: true,
      resolutionState: true,
      resolutionUpdatedAt: true,
      isImported: true,
      createdAt: true,
      note: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      device: {
        select: {
          id: true,
          model: true,
          imei: true,
        },
      },
      schedules: {
        orderBy: { monthNumber: 'asc' },
        select: {
          id: true,
          dueDate: true,
          delayedUntil: true,
          status: true,
          expectedAmount: true,
          paidAmount: true,
          paidAt: true,
          contractExpectedAmount: true,
          contractPaidAmount: true,
          contractRemainingAmount: true,
        },
      },
    },
    }),
    derivedPage ? Promise.resolve(derivedPage.total) : prisma.nasiya.count({ where }),
  ])

  // Prisma's `id IN (...)` does not retain the ordered raw-CTE ID list.
  // Restore that stable database order before mapping the canonical DTO.
  const orderedRows = derivedPage
    ? derivedPage.ids.flatMap((id) => {
        const row = rows.find((candidate) => candidate.id === id)
        return row ? [row] : []
      })
    : rows

  // Single `now` for the whole batch so all rows are judged against the same instant.
  const derivedItems = orderedRows
    .map((nasiya) => {
      const ledger = reconcileNasiyaLedger({
        status: nasiya.status,
        contractCurrency: nasiya.contractCurrency,
        contractFinalAmount: nasiya.contractFinalAmount.toString(),
        contractPaidAmount: nasiya.contractPaidAmount.toString(),
        contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
        schedules: nasiya.schedules.map((schedule) => ({
          id: schedule.id,
          status: schedule.status,
          dueDate: schedule.dueDate,
          delayedUntil: schedule.delayedUntil,
          expectedAmount: schedule.expectedAmount.toString(),
          paidAmount: schedule.paidAmount.toString(),
          contractCurrency: nasiya.contractCurrency,
          contractExpectedAmount: schedule.contractExpectedAmount.toString(),
          contractPaidAmount: schedule.contractPaidAmount.toString(),
          contractRemainingAmount: schedule.contractRemainingAmount.toString(),
        })),
      }, now)
      // Payment score must read the deal's own contract-currency amounts —
      // see docs/currency-accounting-model.md — never the legacy UZS
      // snapshot, which would misjudge overdue tolerance for a USD contract.
      const paymentScore = computeNasiyaPaymentScore(
        {
          schedules: nasiya.schedules.map((s) => ({
            status: s.status,
            dueDate: s.dueDate,
            delayedUntil: s.delayedUntil,
            expectedAmount: Number(s.contractExpectedAmount),
            paidAmount: Number(s.contractPaidAmount),
            paidAt: s.paidAt,
          })),
        },
        now,
        currency,
        nasiya.contractCurrency,
      )
      const collectionWorkItem = deriveNasiyaCollectionWorkItem({
        cohort: query.cohort,
        contractCurrency: nasiya.contractCurrency,
        ledger,
        schedules: nasiya.schedules,
        now,
      })

      return {
        id: nasiya.id,
        interestPercent: Number(nasiya.interestPercent),
        contractCurrency: nasiya.contractCurrency,
        contractInterest: createMoneyDto(nasiya.contractCurrency, nasiya.contractInterestAmount.toString()),
        ledger,
        status: nasiya.status as Exclude<NasiyaStatus, 'CANCELLED'>,
        resolutionState: nasiya.resolutionState as 'ACTIVE' | 'ARCHIVED',
        resolutionUpdatedAt: nasiya.resolutionUpdatedAt?.toISOString() ?? null,
        isImported: nasiya.isImported,
        displayStatus: ledger.status as Exclude<NasiyaDisplayStatus, 'CANCELLED'>,
        isOverdue: ledger.isOverdue,
        overdueAmount: ledger.overdue,
        overdueCount: ledger.overdueCount,
        nextPaymentDate: ledger.nextPaymentDate,
        createdAt: nasiya.createdAt.toISOString(),
        note: nasiya.note,
        customer: nasiya.customer,
        device: nasiya.device,
        schedules: nasiya.schedules.map((schedule) => ({
          id: schedule.id,
          dueDate: schedule.dueDate.toISOString(),
          delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
          status: schedule.status,
        })),
        collectionWorkItem,
        paymentScore,
      }
    })
  const items = derivedPage
    ? derivedItems
    : derivedItems.sort((left, right) => {
      // Overdue contracts first, then by earliest upcoming payment, then newest.
      if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1

      const nextLeft = left.nextPaymentDate ? new Date(left.nextPaymentDate).getTime() : null
      const nextRight = right.nextPaymentDate ? new Date(right.nextPaymentDate).getTime() : null
      if (nextLeft == null && nextRight == null) {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      }
      if (nextLeft == null) return 1
      if (nextRight == null) return -1
      return nextLeft - nextRight
    })

  const total = rawTotal

  return { items, total, skip, take }
}

export async function getShopLogsInitial(
  shopId: string,
  visibility: { includeOwnerFinancials: boolean },
  query: ShopLogsQuery = {},
): Promise<ShopLogsPayload> {
  const take = Math.max(1, Math.min(100, query.take ?? 10))
  const skip = Math.max(0, ((query.page ?? 1) - 1) * take)
  const fromDate = query.dateFrom ? new Date(query.dateFrom) : null
  const toDate = query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : null
  const categoryWhere = logCategoryWhere(query.category ?? 'all')
  const search = query.search?.trim()
  const searchWhere: Prisma.LogWhereInput = search
    ? {
        OR: [
          { action: { contains: search, mode: 'insensitive' } },
          { targetType: { contains: search, mode: 'insensitive' } },
          { targetId: { contains: search, mode: 'insensitive' } },
          { note: { contains: search, mode: 'insensitive' } },
          { shop: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : {}
  const where: Prisma.LogWhereInput = {
    shopId,
    actorType: 'SHOP_ADMIN' as const,
    // Historic RESTOCK rows are retained for platform audit but intentionally
    // absent from the shop-facing log bootstrap and its visible total.
    NOT: { action: 'RESTOCK', targetType: 'Device' },
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
            ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
          },
        }
      : {}),
    ...(Object.keys(categoryWhere).length > 0 || Object.keys(searchWhere).length > 0
      ? { AND: [categoryWhere, searchWhere].filter((item) => Object.keys(item).length > 0) }
      : {}),
  }

  const [logs, total] = await Promise.all([
    prisma.log.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        actorId: true,
        actorType: true,
        action: true,
        targetType: true,
        targetId: true,
        note: true,
        newValue: true,
      },
    }),
    prisma.log.count({ where }),
  ])

  const [logsWithActors, hrefs] = await Promise.all([
    enrichLogsWithActors(logs),
    resolveShopLogTargetHrefs(shopId, logs),
  ])

  return {
    total,
    logs: logsWithActors.map((log) => ({
      ...log,
      ...(!visibility.includeOwnerFinancials ? { newValue: redactShopStaffLogValue(log.newValue) } : {}),
      createdAt: log.createdAt.toISOString(),
      href: hrefs.get(shopLogTargetKey(log)) ?? null,
    })),
  }
}
