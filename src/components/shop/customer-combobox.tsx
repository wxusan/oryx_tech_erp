'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { customerSearchRequest } from '@/lib/customer-search-transport'

export interface CustomerPickerOption {
  id: string
  name: string
  phone: string
  additionalPhones?: string[]
  hasPassportPhoto?: boolean
  trust?: { label: string; color: string }
  _count?: { sales: number; nasiya: number }
}

interface CustomerComboboxProps {
  inputId: string
  selected: CustomerPickerOption | null
  onSelect: (customer: CustomerPickerOption) => void
  onClear?: () => void
  onCreateNew: (searchText: string) => void
  disabled?: boolean
  className?: string
}

interface CustomersResponse {
  success: boolean
  data?: CustomerPickerOption[] | { items: CustomerPickerOption[] }
  error?: string
}

/**
 * Explicit existing-customer selection. It never creates or merges a record;
 * callers must handle the separate `onCreateNew` path.
 */
export function CustomerCombobox({
  inputId,
  selected,
  onSelect,
  onClear,
  onCreateNew,
  disabled = false,
  className,
}: CustomerComboboxProps) {
  const scope = useAuthenticatedQueryScope()
  const generatedId = useId()
  const listboxId = `${inputId || generatedId}-results`
  const statusId = `${inputId || generatedId}-status`
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setSearchRevision((revision) => revision + 1)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  const query = useQuery({
    // The revision is deliberately unrelated to the searched identifier.
    // Keeping picker/profile/list under `customers` makes mutation and sync
    // invalidation exact without retaining passport data in query metadata.
    queryKey: queryKeys.list(scope, 'customers', { surface: 'picker', requestRevision: searchRevision }),
    enabled: !selected && debouncedSearch.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        '/api/customers/picker',
        customerSearchRequest({ search: debouncedSearch }, signal),
      )
      const json = await response.json() as CustomersResponse
      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error || 'Mijozlarni qidirib bo\'lmadi')
      }
      return Array.isArray(json.data) ? json.data : json.data.items
    },
  })

  const options = useMemo(() => query.data ?? [], [query.data])
  const searchText = search.trim()
  const searchReady = searchText.length >= 2
  // Show feedback from the first keystroke that can trigger a search, including
  // the debounce interval, so the picker never appears to have stalled.
  const searchPending = searchReady && (searchText !== debouncedSearch || query.isFetching)
  const visibleOptions = searchPending ? [] : options
  const optionCount = visibleOptions.length
  const activeOptionIndex = activeIndex >= 0 && activeIndex < optionCount ? activeIndex : -1

  function choose(customer: CustomerPickerOption) {
    onSelect(customer)
    setOpen(false)
    setSearch('')
    setActiveIndex(-1)
  }

  function createNew() {
    onCreateNew(search.trim())
    setOpen(false)
    setActiveIndex(-1)
  }

  if (selected) {
    return (
      <div className={cn('flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3', className)}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-900">
            <Check className="size-4" aria-hidden="true" />
            <span className="truncate">{selected.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-emerald-800">{formatUzPhoneDisplay(selected.phone)}</p>
          {selected.trust?.label && <p className="mt-1 text-xs text-emerald-700">{selected.trust.label}</p>}
        </div>
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={onClear}
            aria-label={`${selected.name} tanlovini bekor qilish`}
            className="shrink-0 text-emerald-900"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    )
  }

  const expanded = open && searchReady

  return (
    <div className={cn('relative', className)}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-describedby={statusId}
            aria-activedescendant={expanded && activeOptionIndex >= 0 ? `${listboxId}-${activeOptionIndex}` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={disabled}
            value={search}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value)
              setOpen(true)
              setActiveIndex(-1)
            }}
            onKeyDown={(event) => {
              if (!expanded && event.key === 'ArrowDown') setOpen(true)
              if (event.key === 'ArrowDown' && optionCount > 0) {
                event.preventDefault()
                setActiveIndex((current) => (current + 1) % optionCount)
              } else if (event.key === 'ArrowUp' && optionCount > 0) {
                event.preventDefault()
                setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1))
              } else if (event.key === 'Enter' && expanded && activeOptionIndex >= 0) {
                event.preventDefault()
                choose(visibleOptions[activeOptionIndex])
              } else if (event.key === 'Escape') {
                setOpen(false)
                setActiveIndex(-1)
              }
            }}
            placeholder="Ism, telefon yoki pasport bo'yicha qidiring"
            className="pl-9 pr-9"
          />
          {searchPending && (
            <Loader2
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-zinc-400"
              aria-hidden="true"
            />
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={createNew}
          className="w-full shrink-0 sm:w-auto"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Yangi mijoz yaratish
        </Button>
      </div>

      <p id={statusId} role="status" aria-live="polite" className="mt-1 text-xs text-zinc-500">
        {searchPending
          ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" aria-hidden="true" /> Mijozlar qidirilmoqda...</span>
          : query.isError
            ? (query.error instanceof Error ? query.error.message : 'Qidiruvda xatolik')
            : debouncedSearch.length >= 2
              ? `${options.length} ta mos mijoz topildi`
              : 'Qidirish uchun kamida 2 ta belgi kiriting'}
      </p>

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Mijoz qidiruv natijalari"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg"
        >
          {searchPending ? (
            <li aria-hidden="true" className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" />
              Mijozlar qidirilmoqda...
            </li>
          ) : visibleOptions.length > 0 ? visibleOptions.map((customer, index) => (
            <li
              id={`${listboxId}-${index}`}
              key={customer.id}
              role="option"
              aria-selected={activeOptionIndex === index}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(customer)}
                className={cn(
                  'w-full rounded px-3 py-2 text-left hover:bg-zinc-50',
                  activeOptionIndex === index && 'bg-zinc-100',
                )}
              >
                <span className="block truncate text-sm font-medium text-zinc-900">{customer.name}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {formatUzPhoneDisplay(customer.phone)}
                  {customer.trust?.label ? ` · ${customer.trust.label}` : ''}
                </span>
              </button>
            </li>
          )) : (
            <li role="status" className="px-3 py-3 text-sm text-zinc-500">Mos mijoz topilmadi.</li>
          )}
        </ul>
      )}
    </div>
  )
}
