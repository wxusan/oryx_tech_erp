// @vitest-environment jsdom

import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { signOutMock, clearNavigationClientStateMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  clearNavigationClientStateMock: vi.fn(),
}))

vi.mock('next-auth/react', () => ({ signOut: signOutMock }))
vi.mock('@/lib/client-events', () => ({ clearNavigationClientState: clearNavigationClientStateMock }))

import { SessionControls } from '@/components/auth/session-controls'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-12T08:00:00.000Z'))
  window.localStorage.clear()
  signOutMock.mockReset()
  clearNavigationClientStateMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SessionControls behavior', () => {
  it('logs super-admin out after exactly ten minutes of inactivity', () => {
    render(<SessionControls callbackUrl="/admin/login" idleTimeoutMs={10 * 60 * 1000} />)
    vi.advanceTimersByTime(10 * 60 * 1000 - 1)
    expect(signOutMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clearNavigationClientStateMock).toHaveBeenCalledOnce()
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/admin/login' })
  })

  it('real pointer activity resets the deadline while background time alone does not', () => {
    render(<SessionControls callbackUrl="/admin/login" idleTimeoutMs={10 * 60 * 1000} />)
    vi.advanceTimersByTime(9 * 60 * 1000)
    fireEvent.pointerDown(window)
    vi.advanceTimersByTime(9 * 60 * 1000)
    expect(signOutMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60 * 1000)
    expect(signOutMock).toHaveBeenCalledOnce()
  })

  it('accepts a newer cross-tab activity timestamp', () => {
    render(<SessionControls callbackUrl="/admin/login" idleTimeoutMs={10 * 60 * 1000} />)
    vi.advanceTimersByTime(9 * 60 * 1000)
    const crossTabActivity = Date.now()
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'oryx:admin-last-activity',
      newValue: String(crossTabActivity),
    }))
    vi.advanceTimersByTime(9 * 60 * 1000)
    expect(signOutMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60 * 1000)
    expect(signOutMock).toHaveBeenCalledOnce()
  })

  it('does not immediately expire a fresh login because of a stale prior-session timestamp', () => {
    window.localStorage.setItem('oryx:admin-last-activity', String(Date.now() - 60 * 60 * 1000))
    render(<SessionControls callbackUrl="/admin/login" idleTimeoutMs={10 * 60 * 1000} />)
    expect(signOutMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(signOutMock).toHaveBeenCalledOnce()
  })

  it('never auto-expires the shop session but keeps explicit logout', () => {
    render(<SessionControls callbackUrl="/shop/login" idleTimeoutMs={null} />)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(signOutMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Chiqish' }))
    expect(clearNavigationClientStateMock).toHaveBeenCalledOnce()
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/shop/login' })
  })
})
