import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { AdminLayoutClient } from './admin-layout-client'
import { authenticatedQueryScope } from '@/lib/query-scope'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { AuthenticatedQueryProvider } from '@/components/authenticated-query-provider'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || guarded.session.user.role !== 'SUPER_ADMIN') redirect('/admin/login')
  const syncCursor = await latestChangeCursorForSession(guarded.session)

  return (
    <AuthenticatedQueryProvider
      scope={authenticatedQueryScope(guarded.session.user)}
      initialCursor={syncCursor}
    >
      <AdminLayoutClient adminName={guarded.session.user.name}>
        {children}
      </AdminLayoutClient>
    </AuthenticatedQueryProvider>
  )
}
