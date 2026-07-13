'use client'

import { createContext, useContext, useMemo } from 'react'
import {
  principalCan,
  type ShopFeatureCode,
  type ShopMemberKind,
  type ShopPermissionCode,
} from '@/lib/access-control'

interface ShopAccessContextValue {
  memberKind: ShopMemberKind
  can(permission: ShopPermissionCode): boolean
}

const ShopAccessContext = createContext<ShopAccessContextValue | null>(null)

export function ShopAccessProvider({
  children,
  memberKind,
  enabledFeatures,
  grantedPermissions,
  legacyFullAccess,
}: {
  children: React.ReactNode
  memberKind: ShopMemberKind
  enabledFeatures: ShopFeatureCode[]
  grantedPermissions: ShopPermissionCode[]
  legacyFullAccess: boolean
}) {
  const value = useMemo<ShopAccessContextValue>(() => {
    const principal = {
      memberKind,
      legacyFullAccess,
      enabledFeatures: new Set(enabledFeatures),
      grantedPermissions: new Set(grantedPermissions),
    }
    return {
      memberKind,
      can: (permission) => principalCan(principal, permission),
    }
  }, [enabledFeatures, grantedPermissions, legacyFullAccess, memberKind])

  return <ShopAccessContext.Provider value={value}>{children}</ShopAccessContext.Provider>
}

export function useShopAccess() {
  const value = useContext(ShopAccessContext)
  if (!value) throw new Error('ShopAccessProvider is missing')
  return value
}

export function ShopAccessDenied() {
  return (
    <div className="p-6">
      <div className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <h1 className="text-sm font-semibold text-amber-900">Bu amal uchun ruxsat berilmagan</h1>
        <p className="mt-1 text-sm text-amber-800">
          Do&apos;kon egasi sizga bu bo&apos;lim uchun ruxsat bermagan.
        </p>
      </div>
    </div>
  )
}
