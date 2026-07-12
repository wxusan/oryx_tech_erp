'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { AlertTriangle, Building2, CalendarClock, CreditCard, TrendingUp } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { uzMonthYear } from '@/lib/dates'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'

type ShopStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

interface ShopRow {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  status: ShopStatus
  subscriptionDue: string
}

interface AdminStats {
  thisMonthRevenue: number
  expectedRevenue: number
  activeShops: number
  dueSoon: number
  overdue: number
}

function formatMoney(n: number) {
  return n.toLocaleString('ru-RU') + " so'm"
}

function StatusBadge({ status }: { status: ShopStatus }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-900 text-white">
        Faol
      </span>
    )
  }
  if (status === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500">
        To&apos;xtatilgan
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400">
      O&apos;chirilgan
    </span>
  )
}

export default function DashboardPage() {
  const scope = useAuthenticatedQueryScope()
  const dashboardQuery = useQuery({
    queryKey: queryKeys.list(scope, 'adminReports', { view: 'dashboard' }),
    queryFn: async ({ signal }) => {
      const [statsResponse, shopsResponse] = await Promise.all([
        fetch('/api/stats/admin', { signal, cache: 'no-store' }),
        fetch('/api/shops', { signal, cache: 'no-store' }),
      ])
      const [statsJson, shopsJson] = await Promise.all([statsResponse.json(), shopsResponse.json()]) as [
        { success: boolean; data?: AdminStats; error?: string },
        { success: boolean; data?: ShopRow[]; error?: string },
      ]
      if (!statsResponse.ok || !statsJson.success || !statsJson.data) throw new Error(statsJson.error ?? 'Statistika yuklanmadi')
      if (!shopsResponse.ok || !shopsJson.success || !shopsJson.data) throw new Error(shopsJson.error ?? "Do'konlar yuklanmadi")
      return {
        stats: statsJson.data,
        shops: shopsJson.data.toSorted(
          (a, b) => new Date(a.subscriptionDue).getTime() - new Date(b.subscriptionDue).getTime(),
        ),
      }
    },
  })
  const stats = dashboardQuery.data?.stats ?? null
  const shops = dashboardQuery.data?.shops ?? []
  const loading = dashboardQuery.isPending && !dashboardQuery.data
  const error = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null

  const collectionRate = stats && stats.expectedRevenue > 0
    ? Math.min(100, Math.round((stats.thisMonthRevenue / stats.expectedRevenue) * 100))
    : 0

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Boshqaruv paneli</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Obuna tushumi, to'lov muddati va do'konlar holati
          </p>
        </div>
        <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
          {uzMonthYear(new Date())}
        </Badge>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="rounded-lg lg:col-span-5">
          <CardHeader className="border-b border-zinc-100">
            <CardTitle>Bu oy obuna tushumi</CardTitle>
            <CardDescription>Bosh admin uchun do'kon obunalaridan tushum</CardDescription>
            <CardAction><CreditCard className="size-5 text-zinc-400" /></CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase text-zinc-500">Tushgan summa</div>
              <div className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
                {stats ? formatMoney(stats.thisMonthRevenue) : 'Yuklanmoqda...'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Rejaga nisbatan</span>
                <span className="font-semibold text-zinc-800">{collectionRate}%</span>
              </div>
              <Progress value={collectionRate} />
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Kutilayotgan: {stats ? formatMoney(stats.expectedRevenue) : '...'}</span>
                <span>{stats?.activeShops ?? 0} faol do'kon</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          <Card className="rounded-lg">
            <CardHeader>
              <CardDescription>Faol do'konlar</CardDescription>
              <CardAction><Building2 className="size-4 text-zinc-400" /></CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-900">{stats?.activeShops ?? 0}</div>
              <p className="mt-2 text-xs text-zinc-500">Sotuv va nasiya yuritayotgan do'konlar</p>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardDescription>7 kun ichida to'lov</CardDescription>
              <CardAction><CalendarClock className="size-4 text-zinc-400" /></CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-900">{stats?.dueSoon ?? 0}</div>
              <p className="mt-2 text-xs text-zinc-500">Obuna muddati yaqinlashgan do'konlar</p>
            </CardContent>
          </Card>

          <Link href="/admin/shops?payment=overdue" className="block">
            <Card className="rounded-lg border-red-200 bg-red-50/40 transition-colors hover:border-red-300 hover:bg-red-50">
              <CardHeader>
                <CardDescription className="text-red-700">Muddati o'tgan</CardDescription>
                <CardAction><AlertTriangle className="size-4 text-red-500" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-700">{stats?.overdue ?? 0}</div>
                <p className="mt-2 text-xs text-red-700/70">Darhol tekshirish kerak bo'lgan do'konlar</p>
              </CardContent>
            </Card>
          </Link>

          <Card className="rounded-lg">
            <CardHeader>
              <CardDescription>Rejadagi tushum</CardDescription>
              <CardAction><TrendingUp className="size-4 text-zinc-400" /></CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-900">
                {stats ? formatMoney(stats.expectedRevenue) : 'Yuklanmoqda...'}
              </div>
              <p className="mt-2 text-xs text-zinc-500">Faol do'konlar soni bo'yicha taxmin</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Shops table */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Do&apos;konlar ro&apos;yxati</h2>
          <Link
            href="/admin/shops"
            className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            Barchasini ko&apos;rish →
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5">Do&apos;kon nomi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Egalik qiluvchi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Tel</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Do&apos;kon raqami</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Status</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">To&apos;lov sanasi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium pr-5 text-right">Amallar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : shops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Hech qanday do&apos;kon topilmadi
                </TableCell>
              </TableRow>
            ) : (
              shops.map((shop) => (
                <TableRow key={shop.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5 text-sm font-medium text-zinc-900">{shop.name}</TableCell>
                  <TableCell className="text-sm text-zinc-600">{shop.ownerName}</TableCell>
                  <TableCell className="text-sm text-zinc-500 font-mono">{formatUzPhoneDisplay(shop.ownerPhone)}</TableCell>
                  <TableCell className="text-sm text-zinc-500">{shop.shopNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={shop.status} />
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {shop.subscriptionDue ? new Date(shop.subscriptionDue).toLocaleDateString('ru-RU') : '—'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <IntentPrefetchLink
                      href={`/admin/shops/${shop.id}`}
                      className="text-xs text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 transition-colors"
                    >
                      Ko&apos;rish
                    </IntentPrefetchLink>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
