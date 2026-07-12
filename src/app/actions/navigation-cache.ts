'use server'

import { refresh, revalidatePath } from 'next/cache'
import { requireApiSession } from '@/lib/api-auth'
import {
  isAdminNavigationMutation,
  navigationImpactForMutation,
  navigationScopeForSession,
  type NavigationMutation,
} from '@/lib/navigation-cache-policy'

function authenticatedScope(guarded: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!guarded.ok) throw new Error('AUTHENTICATION_REQUIRED')
  return {
    guarded,
    scopeKey: navigationScopeForSession(guarded.session.user),
  }
}

export async function invalidateNavigationAfterMutation(mutation: NavigationMutation) {
  const { guarded, scopeKey } = authenticatedScope(await requireApiSession())
  const requiresSuperAdmin = isAdminNavigationMutation(mutation.kind) || mutation.kind === 'currency.updated'
  if (requiresSuperAdmin && guarded.session.user.role !== 'SUPER_ADMIN') {
    throw new Error('ADMIN_PERMISSION_REQUIRED')
  }
  if (!requiresSuperAdmin && guarded.session.user.role !== 'SHOP_ADMIN') {
    throw new Error('SHOP_PERMISSION_REQUIRED')
  }

  const impact = navigationImpactForMutation(mutation)
  for (const path of impact.paths) {
    if (path === '/shop') revalidatePath(path, 'layout')
    else revalidatePath(path)
  }

  // Server Actions can invalidate the browser Router Cache immediately.
  // refresh() also updates persistent shell widgets on the currently visible
  // route; the revalidated paths guarantee the next navigation is fresh.
  refresh()
  return { scopeKey, impact }
}

export async function refreshAuthenticatedNavigation() {
  const { scopeKey } = authenticatedScope(await requireApiSession())
  refresh()
  return { scopeKey }
}
