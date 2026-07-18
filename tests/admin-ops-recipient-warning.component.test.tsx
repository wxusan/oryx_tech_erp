// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/components/query-scope-context', () => ({
  useAuthenticatedQueryScope: () => 'super-admin:test',
}))

import AdminOpsPage from '@/app/(admin)/admin/ops/page'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Tizim Telegram recipient warnings', () => {
  it('renders only the safe shop/type/audience/reason/count/time projection', async () => {
    const privateText = 'Customer Lola +998900000000 telegram 700000001'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        windowDays: 7,
        alertWindow: { startsAt: null, acknowledgedAt: null },
        levelCounts: { INFO: 0, WARN: 1, ERROR: 0 },
        notificationCounts: { PENDING: 0, PROCESSING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 },
        notificationWarnings: ['Telegram qabul qiluvchisi mavjud emas'],
        queueHealth: {
          oldestActionableCreatedAt: null,
          oldestActionableAgeSeconds: 0,
          oldestActionableStatus: null,
        },
        events: [],
        recentFailedNotifications: [],
        recipientWarnings: [{
          id: 'warning-1',
          shopId: 'shop-1',
          shopName: 'Chorsu Mobile',
          notificationType: 'RETURN',
          audience: 'OWNER_AND_ACTIVE_STAFF',
          reason: 'personal_disabled',
          occurrences: 3,
          lastOccurredAt: '2026-07-18T12:00:00.000Z',
        }, {
          id: 'warning-2',
          shopId: 'shop-2',
          shopName: 'Oloy Devices',
          notificationType: 'SALE',
          audience: 'OWNER_ONLY',
          reason: 'unlinked_or_unverified',
          occurrences: 1,
          lastOccurredAt: '2026-07-18T12:01:00.000Z',
        }],
        lastCron: null,
        lastCronFailure: null,
        generatedAt: '2026-07-18T12:00:00.000Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <AdminOpsPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Chorsu Mobile')).toBeTruthy())
    expect(screen.getByText('Qurilma qaytarildi')).toBeTruthy()
    expect(screen.getByText('Do‘kon egasi va faol xodimlar')).toBeTruthy()
    expect(screen.getByText('Faqat do‘kon egasi')).toBeTruthy()
    expect(screen.getByText('Xodim uchun Telegram xabarlari o‘chirilgan')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.queryByText(privateText)).toBeNull()
    expect(document.body.textContent).not.toContain('700000001')
  })
})
