import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Package,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
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
import { requireApiSession } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'

interface UpcomingPayment {
  nasiya: {
    customer: { name: string }
    device: { model: string }
  }
  dueDate: string | Date
  expectedAmount: number
  paidAmount: number
  status: string
}

function fmt(n: number) {
  return `${Number(n).toLocaleString('ru-RU')} so'm`
}

function activityLabel(action: string) {
  if (action === 'CREATE_NASIYA') return 'Nasiya yaratildi'
  if (action === 'CREATE') return "Yangi qo'shildi"
  if (action === 'PAYMENT') return "To'lov qabul qilindi"
  if (action === 'SELL') return 'Sotuv qilindi'
  if (action === 'RETURN') return 'Qaytarildi'
  if (action === 'RESTOCK') return 'Omborga qaytarildi'
  if (action === 'UPDATE_REMINDER') return "Eslatma o'zgartirildi"
  if (action === 'UPDATE') return "Ma'lumot o'zgartirildi"
  if (action === 'DELETE') return "O'chirildi"
  if (action === 'IMPORT') return 'Import qilindi'
  return action
}

function outstanding(payment: UpcomingPayment) {
  return Math.max(0, Number(payment.expectedAmount) - Number(payment.paidAmount ?? 0))
}

function statusLabel(status: string) {
  if (status === 'OVERDUE') return "Muddati o'tgan"
  if (status === 'PARTIAL') return "Qisman to'langan"
  if (status === 'DEFERRED') return "Kechiktirilgan"
  if (status === 'PAID') return "To'langan"
  return 'Kutilmoqda'
}

export default async function DashboardPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const stats = await getShopStats(guarded.session, guarded.shopId)

  const collectionBase = stats.cashCollectedThisMonth + stats.expectedThisMonth
  const collectionRate = collectionBase > 0
    ? Math.round((stats.cashCollectedThisMonth / collectionBase) * 100)
    : 0

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Boshqaruv paneli</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Naqd tushum, kutilayotgan to'lovlar va nasiya holati
          </p>
        </div>
        <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
          {new Date().toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Card className="rounded-lg lg:col-span-5">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Bu oy pul oqimi</CardTitle>
                <CardDescription>Tushgan pul va oy oxirigacha kutilayotgan to'lov</CardDescription>
                <CardAction>
                  <WalletCards className="size-5 text-zinc-400" />
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="text-xs font-medium uppercase text-zinc-500">Tushgan pul</div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
                    {fmt(stats.cashCollectedThisMonth)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Yig'ilgan ulush</span>
                    <span className="font-semibold text-zinc-800">{collectionRate}%</span>
                  </div>
                  <Progress value={collectionRate} />
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Kutilmoqda: {fmt(stats.expectedThisMonth)}</span>
                    <span>Jami oqim: {fmt(collectionBase)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardDescription>Yalpi foyda</CardDescription>
                  <CardAction><TrendingUp className="size-4 text-zinc-400" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-zinc-900">
                    {fmt(stats.accrualGrossProfitThisMonth)}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Bu oy sotilgan qurilmalar bo'yicha</p>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader>
                  <CardDescription>Ombordagi tannarx</CardDescription>
                  <CardAction><Package className="size-4 text-zinc-400" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-zinc-900">
                    {fmt(stats.inventoryPurchaseCost)}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Sotilmagan va band qilingan qurilmalar</p>
                </CardContent>
              </Card>

              <Link href="/shop/nasiyalar?status=OVERDUE" className="block">
                <Card className="rounded-lg border-red-200 bg-red-50/40 transition-colors hover:border-red-300 hover:bg-red-50">
                  <CardHeader>
                    <CardDescription className="text-red-700">Kechikkan to'lovlar</CardDescription>
                    <CardAction><AlertTriangle className="size-4 text-red-500" /></CardAction>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-700">
                      {fmt(stats.overdueMoney)}
                    </div>
                    <p className="mt-2 text-xs text-red-700/70">
                      {stats.overdueCount} ta muddatdan o'tgan yozuv
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Jami qurilmalar</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats.totalDevices}</div>
                </div>
                <Package className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Bu oy sotildi</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats.soldThisMonth}</div>
                </div>
                <ReceiptText className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Faol nasiyalar</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats.activeNasiyalar}</div>
                </div>
                <ClipboardList className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Bu oy kutilmoqda</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{fmt(stats.expectedThisMonth)}</div>
                </div>
                <CalendarClock className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Yaqin to'lov sanalari</CardTitle>
                <CardDescription>Nasiya bo'yicha eng yaqin va kechikkan oyliklar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.upcomingPayments.length > 0 ? (
                  stats.upcomingPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-3 border-b border-zinc-100 last:border-0">
                      <div>
                        <div className="text-sm font-medium text-zinc-900">{p.nasiya.customer.name}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {p.nasiya.device.model} · {new Date(p.dueDate).toLocaleDateString('uz-UZ')}
                        </div>
                        <Badge variant="outline" className="mt-2 rounded-md border-zinc-200 text-zinc-500">
                          {statusLabel(p.status)}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-zinc-900">{fmt(outstanding(p))}</div>
                        <div className="mt-0.5 text-xs text-zinc-400">qolgan</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">To'lovlar yo'q</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Oxirgi operatsiyalar</CardTitle>
                <CardDescription>Do'kon ichidagi oxirgi harakatlar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.recentActivity.length > 0 ? (
                  stats.recentActivity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                      <div className="text-sm text-zinc-700">{activityLabel(a.action)}</div>
                      <div className="text-xs text-zinc-400 ml-4 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleDateString('uz-UZ')}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">Operatsiyalar yo'q</div>
                )}
              </CardContent>
            </Card>
      </div>
    </div>
  )
}
