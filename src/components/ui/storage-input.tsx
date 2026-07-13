'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type StorageInputUnit = 'GB' | 'TB'

interface StorageInputProps {
  amount: string
  unit: StorageInputUnit
  onAmountChange: (value: string) => void
  onUnitChange: (value: StorageInputUnit) => void
  label?: string
  required?: boolean
  id?: string
  className?: string
  inputClassName?: string
}

/** One accessible source of truth for every structured GB/TB entry form. */
export function StorageInput({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  label = 'Xotira',
  required = false,
  id,
  className,
  inputClassName,
}: StorageInputProps) {
  const generatedId = useId()
  const amountId = id ?? `storage-amount-${generatedId}`

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={amountId} className="block text-xs font-medium text-zinc-700">
        {label} {required && <span className="text-red-500" aria-hidden="true">*</span>}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <Input
          id={amountId}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="256"
          required={required}
          aria-required={required}
          className={cn('h-10 rounded-lg border-zinc-200 text-sm', inputClassName)}
        />
        <select
          aria-label={`${label} birligi`}
          value={unit}
          onChange={(event) => onUnitChange(event.target.value as StorageInputUnit)}
          className="h-10 w-full rounded-lg border border-zinc-200 bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="GB">GB</option>
          <option value="TB">TB</option>
        </select>
      </div>
    </div>
  )
}
