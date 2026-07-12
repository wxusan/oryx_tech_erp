'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
        <Select value={unit} onValueChange={(value) => value && onUnitChange(value as StorageInputUnit)}>
          <SelectTrigger aria-label={`${label} birligi`} className="h-10 w-full rounded-lg border-zinc-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GB">GB</SelectItem>
            <SelectItem value="TB">TB</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
