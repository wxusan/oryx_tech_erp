import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { AdminLayoutClient } from './admin-layout-client'
import { navigationScopeForSession } from '@/lib/navigation-cache-policy'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || guarded.session.user.role !== 'SUPER_ADMIN') redirect('/admin/login')

  return (
    <AdminLayoutClient
      adminName={guarded.session.user.name}
      navigationScope={navigationScopeForSession(guarded.session.user)}
    >
      {children}
    </AdminLayoutClient>
  )
}
