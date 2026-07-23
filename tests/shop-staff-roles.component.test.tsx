// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StaffRoleManagement } from '@/components/shop/staff-role-management'
import { QueryScopeContext } from '@/components/query-scope-context'
import { ShopAccessProvider } from '@/components/shop/shop-access-context'
import { SHOP_FEATURE_CODES } from '@/lib/access-control'
import type { ShopStaffRoleDto } from '@/lib/shop-staff-role-contract'
import type { ShopStaffDto } from '@/lib/shop-staff-contract'

vi.mock('@/lib/client-events', () => ({
  commitNavigationMutation: vi.fn(async () => undefined),
}))

const role: ShopStaffRoleDto = {
  id: 'role-shogirt',
  name: 'Shogirt',
  normalizedName: 'shogirt',
  description: 'Usta yordamchisi',
  kind: 'CUSTOM',
  presetKey: null,
  isArchived: false,
  version: 1,
  permissionCodes: ['INVENTORY_VIEW'],
  logsViewEnabled: false,
  assignable: true,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const staff: ShopStaffDto = {
  id: 'staff-1',
  name: 'Ali',
  phone: '+998901234567',
  login: 'ali',
  isActive: true,
  telegramId: null,
  telegramVerifiedAt: null,
  telegramNotificationsEnabled: false,
  logsViewEnabled: false,
  permissionVersion: 1,
  permissionCodes: ['INVENTORY_VIEW'],
  staffRole: { id: role.id, name: role.name, kind: role.kind, isArchived: false, version: 1 },
  roleVersionApplied: 1,
  createdAt: '2026-07-22T00:00:00.000Z',
}

function renderRoles(isOwner = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <QueryScopeContext.Provider value={{
        role: 'SHOP_ADMIN',
        tenantId: 'shop-1',
        sessionVersion: 1,
        memberKind: isOwner ? 'SHOP_OWNER' : 'SHOP_STAFF',
        authorizationVersion: 1,
        permissionVersion: 1,
        packageVersionId: 'package-1',
        key: 'scope',
      }}>
        <ShopAccessProvider
          memberKind={isOwner ? 'SHOP_OWNER' : 'SHOP_STAFF'}
          enabledFeatures={[...SHOP_FEATURE_CODES]}
          grantedPermissions={isOwner ? [] : ['STAFF_VIEW']}
          legacyFullAccess={false}
        >
          <StaffRoleManagement
            roles={[role]}
            staff={[staff]}
            isOwner={isOwner}
            isFetching={false}
            error={null}
            onRetry={() => undefined}
          />
        </ShopAccessProvider>
      </QueryScopeContext.Provider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('staff role management UX', () => {
  it('shows role type, computed bounded-roster membership, and owner controls', () => {
    renderRoles()
    expect(screen.getByRole('heading', { name: 'Shogirt' })).toBeTruthy()
    expect(screen.getByText('Maxsus')).toBeTruthy()
    expect(screen.getByText(/1 ta ruxsat · 1 ta xodim/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Lavozim yaratish/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tahrirlash/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Nusxa olish/ })).toBeTruthy()
  })

  it('keeps mutation controls hidden for non-owner viewers', () => {
    renderRoles(false)
    expect(screen.queryByRole('button', { name: /Lavozim yaratish/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tahrirlash/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Shogirt' })).toBeTruthy()
  })

  it('opens an accessible Shogirt-ready custom role form with double-submit protection', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    renderRoles()
    fireEvent.click(screen.getByRole('button', { name: /Lavozim yaratish/ }))
    const name = screen.getByPlaceholderText('Masalan: Shogirt')
    fireEvent.change(name, { target: { value: 'Shogirt yordamchi' } })
    const save = screen.getByRole('button', { name: /Saqlash/ })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Saqlanmoqda/ }).getAttribute('aria-busy')).toBe('true')
  })
})
