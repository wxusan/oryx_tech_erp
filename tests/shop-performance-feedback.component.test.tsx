// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncButton } from '@/components/ui/async-button'
import { QueryActivity } from '@/components/query-activity'
import { ExportDownloadButton } from '@/components/shop/export-download-button'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AsyncButton pending contract', () => {
  it('shows accessible, stable pending feedback and disables the action', () => {
    render(
      <AsyncButton pending pendingLabel="Saqlanmoqda...">
        Saqlash
      </AsyncButton>,
    )

    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Saqlanmoqda...')).toBeTruthy()
    expect(screen.getByText('Saqlash').className).toContain('invisible')
  })

  it('guards a synchronous action from a same-tick double click', () => {
    const onClick = vi.fn()
    render(
      <AsyncButton pending={false} pendingLabel="Saqlanmoqda..." onClick={onClick}>
        Saqlash
      </AsyncButton>,
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps an icon and label in one aligned row', () => {
    render(
      <AsyncButton pending={false} pendingLabel="Saqlanmoqda...">
        <svg aria-hidden="true" />
        Telegram ID saqlash
      </AsyncButton>,
    )

    const visibleContent = screen.getByText('Telegram ID saqlash')
    expect(visibleContent.className).toContain('inline-flex')
    expect(visibleContent.className).toContain('items-center')
  })
})

describe('ExportDownloadButton request contract', () => {
  it('shows request progress and prevents a duplicate export', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ExportDownloadButton href="/api/export/devices" fallbackFilename="devices.csv">
        CSV eksport
      </ExportDownloadButton>,
    )

    const button = screen.getByRole('button', { name: /CSV eksport/ })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})

describe('QueryActivity retained-content contract', () => {
  it('keeps old rows mounted while exposing a busy refresh state', () => {
    const view = render(
      <QueryActivity isFetching={false} metricId="customers">
        <div>Oldingi qator</div>
      </QueryActivity>,
    )

    view.rerender(
      <QueryActivity isFetching metricId="customers">
        <div>Oldingi qator</div>
      </QueryActivity>,
    )

    expect(screen.getByText('Oldingi qator')).toBeTruthy()
    expect(screen.getByText('Ma’lumotlar yangilanmoqda')).toBeTruthy()
    expect(document.querySelector('[data-query-activity]')?.getAttribute('aria-busy')).toBe('true')
  })

  it('renders an error and invokes retry once', () => {
    const retry = vi.fn()
    render(
      <QueryActivity isFetching={false} error="Tarmoq xatosi" onRetry={retry}>
        <div>Saqlangan qator</div>
      </QueryActivity>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Qayta urinish/ }))
    expect(screen.getByRole('alert').textContent).toContain('Tarmoq xatosi')
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
