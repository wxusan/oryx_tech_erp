// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerCombobox } from '@/components/shop/customer-combobox'
import { QueryScopeContext } from '@/components/query-scope-context'
import { authenticatedQueryScope } from '@/lib/query-scope'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPicker(props: Partial<React.ComponentProps<typeof CustomerCombobox>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelect = vi.fn()
  const onCreateNew = vi.fn()
  render(
    <QueryScopeContext.Provider value={authenticatedQueryScope({
      id: 'member-1',
      role: 'SHOP_ADMIN',
      shopId: 'shop-1',
      sessionVersion: 1,
      memberKind: 'SHOP_OWNER',
      authorizationVersion: 1,
      permissionVersion: 1,
      packageVersionId: 'package-1',
    })}>
      <QueryClientProvider client={queryClient}>
        <CustomerCombobox
          inputId="customer-search"
          selected={null}
          onSelect={onSelect}
          onCreateNew={onCreateNew}
          {...props}
        />
      </QueryClientProvider>
    </QueryScopeContext.Provider>,
  )
  return { onSelect, onCreateNew, queryClient }
}

describe('CustomerCombobox', () => {
  it('sends a debounced tenant search only in a POST body and explicitly selects an existing customer', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        items: [{
          id: 'customer-1',
          name: 'Ali Valiyev',
          phone: '+998901234567',
          trust: { label: 'Ishonchli', color: 'green' },
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { onSelect } = renderPicker()

    const combobox = screen.getByRole('combobox', { name: '' })
    await user.type(combobox, 'Ali')
    const option = await screen.findByRole('option', { name: /Ali Valiyev/ })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/customers/picker')
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(request.body))).toEqual({ search: 'Ali' })

    await user.click(option.querySelector('button') as HTMLButtonElement)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-1' }))
  })

  it('keeps a passport identifier out of the URL, autocomplete, and React Query key', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { queryClient } = renderPicker()

    const combobox = screen.getByRole('combobox') as HTMLInputElement
    expect(combobox.autocomplete).toBe('off')
    expect(combobox.getAttribute('spellcheck')).toBe('false')
    await user.type(combobox, 'AA 1234567')
    await screen.findByText('0 ta mos mijoz topildi')

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/customers/picker')
    expect(url).not.toContain('AA')
    expect(JSON.parse(String(request.body))).toEqual({ search: 'AA 1234567' })
    const cacheKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey)
    expect(JSON.stringify(cacheKeys)).not.toContain('AA 1234567')
    expect(cacheKeys).toEqual(expect.arrayContaining([
      expect.arrayContaining(['customers', 'list', expect.objectContaining({ surface: 'picker' })]),
    ]))
  })

  it('keeps new-customer creation as an immediate action beside the search field', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { onCreateNew } = renderPicker()

    const createNewButton = screen.getByRole('button', { name: 'Yangi mijoz yaratish' })
    await user.type(screen.getByRole('combobox'), 'Yangi mijoz')
    await user.click(createNewButton)
    expect(onCreateNew).toHaveBeenCalledWith('Yangi mijoz')
  })

  it('shows a loading state while customer search is pending', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderPicker()

    await user.type(screen.getByRole('combobox'), 'Ali')
    expect((await screen.findByRole('status')).textContent).toContain('Mijozlar qidirilmoqda...')
  })

  it('renders an unambiguous selected-customer card with a clear action', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    renderPicker({
      selected: { id: 'customer-1', name: 'Ali Valiyev', phone: '+998901234567' },
      onClear,
    })
    expect(screen.getByText('Ali Valiyev')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /tanlovini bekor qilish/ }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('offers an optional in-place edit action for a selected customer', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderPicker({
      selected: { id: 'customer-1', name: 'Ali Valiyev', phone: '+998901234567' },
      onEdit,
    })

    await user.click(screen.getByRole('button', { name: /ma'lumotlarini tahrirlash/ }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-1' }))
  })

  it('highlights only the committed contiguous match and preserves option text', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        items: [{
          id: 'customer-2446',
          name: 'Ali 2446 Valiyev',
          phone: '+998901111111',
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    renderPicker()

    await user.type(screen.getByRole('combobox'), '2446')
    const option = await screen.findByRole('option', { name: /Ali 2446 Valiyev/ })
    expect(option.querySelector('mark')?.textContent).toBe('2446')
    expect(option.textContent).toContain('Ali 2446 Valiyev')
    expect(option.textContent).toContain('+998 90 111 11 11')
  })

  it('suppresses placeholder-result highlights as soon as a newer raw query is typed', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          items: [{
            id: 'customer-old',
            name: 'Old 2446 result',
            phone: '+998901111111',
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementation(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    renderPicker()

    const combobox = screen.getByRole('combobox')
    await user.type(combobox, '2446')
    const oldOption = await screen.findByRole('option', { name: /Old 2446 result/ })
    expect(oldOption.querySelectorAll('mark')).toHaveLength(1)

    await user.clear(combobox)
    await user.type(combobox, 'sanasi')
    expect(screen.queryByRole('option', { name: /Old 2446 result/ })).toBeNull()
    expect(document.querySelectorAll('mark')).toHaveLength(0)
  })

  it('renders exact passport evidence as a neutral marker without echoing private input', async () => {
    const user = userEvent.setup()
    const passport = 'AA 1234567'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        items: [{
          id: 'customer-passport',
          name: 'Passport customer',
          phone: '+998901111111',
          matchEvidence: [{ field: 'PASSPORT' }],
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    renderPicker()

    await user.type(screen.getByRole('combobox'), passport)
    const option = await screen.findByRole('option', { name: /Passport customer/ })
    expect(option.textContent).toContain("Pasport:bo'yicha mos")
    expect(option.textContent).not.toContain(passport)
    expect(option.querySelector('mark')).toBeNull()
  })
})
