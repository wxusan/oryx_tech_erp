import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { AdminLayoutClient } from './admin-layout-client'
import { authenticatedQueryScope } from '@/lib/query-scope'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { AuthenticatedQueryProvider } from '@/components/authenticated-query-provider'
import { getSuperAdminCurrencyContext } from '@/lib/server/currency'
import { AdminCurrencyProvider } from '@/lib/use-admin-currency'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || guarded.session.user.role !== 'SUPER_ADMIN') redirect('/admin/login')
  const [syncCursor, currency] = await Promise.all([
    latestChangeCursorForSession(guarded.session),
    getSuperAdminCurrencyContext(guarded.session.user.id),
  ])

  return (
    <AuthenticatedQueryProvider
      scope={authenticatedQueryScope(guarded.session.user)}
      initialCursor={syncCursor}
    >
      <AdminCurrencyProvider initialCurrency={currency}>
        <AdminLayoutClient adminName={guarded.session.user.name}>
          {children}
        </AdminLayoutClient>
      </AdminCurrencyProvider>
    </AuthenticatedQueryProvider>
  )
}
