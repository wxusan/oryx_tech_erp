'use client'

import { FormEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ReportRangePreset } from '@/lib/report-range'

interface HisobotFiltersProps {
  monthOptions: { value: string; label: string }[]
  preset: ReportRangePreset
  selectedMonth: string | null
  startMonth: string
  endMonth: string
  admins: { id: string; name: string }[]
  selectedAdmin: string | null
}

export default function HisobotFilters({
  monthOptions,
  preset,
  selectedMonth,
  startMonth,
  endMonth,
  admins,
  selectedAdmin,
}: HisobotFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    update(params)
    router.push(`${pathname}?${params.toString()}`)
  }

  function changePreset(nextPreset: ReportRangePreset) {
    navigate((params) => {
      params.set('preset', nextPreset)
      params.delete('month')
      params.delete('startMonth')
      params.delete('endMonth')
      if (nextPreset === 'single' && selectedMonth) params.set('month', selectedMonth)
      if (nextPreset !== 'single' && nextPreset !== 'custom') params.set('endMonth', endMonth)
      if (nextPreset === 'custom') {
        params.set('startMonth', startMonth)
        params.set('endMonth', endMonth)
      }
    })
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    navigate((params) => {
      params.set('preset', 'custom')
      params.set('startMonth', String(form.get('startMonth') ?? ''))
      params.set('endMonth', String(form.get('endMonth') ?? ''))
      params.delete('month')
    })
  }

  return (
    <div className="flex flex-col gap-2 lg:items-end">
      <div className="flex flex-wrap gap-2">
        <Select value={preset} onValueChange={(value) => changePreset(value as ReportRangePreset)}>
          <SelectTrigger aria-label="Hisobot oralig'i" className="h-9 w-[170px] rounded border-zinc-200 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Bitta oy</SelectItem>
            {monthOptions.length >= 3 && <SelectItem value="trailing3">Oxirgi 3 oy</SelectItem>}
            {monthOptions.length >= 6 && <SelectItem value="trailing6">Oxirgi 6 oy</SelectItem>}
            {monthOptions.length >= 12 && <SelectItem value="trailing12">Oxirgi 12 oy</SelectItem>}
            <SelectItem value="custom">Maxsus oraliq</SelectItem>
          </SelectContent>
        </Select>

        {preset === 'single' && monthOptions.length > 0 && (
          <Select
            value={selectedMonth ?? monthOptions[0]?.value}
            onValueChange={(month) => month && navigate((params) => {
              params.set('preset', 'single')
              params.set('month', month)
              params.delete('startMonth')
              params.delete('endMonth')
            })}
          >
            <SelectTrigger aria-label="Hisobot oyi" className="h-9 w-[150px] rounded border-zinc-200 bg-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(preset === 'trailing3' || preset === 'trailing6' || preset === 'trailing12') && (
          <Select
            value={endMonth}
            onValueChange={(month) => month && navigate((params) => {
              params.set('preset', preset)
              params.set('endMonth', month)
              params.delete('month')
              params.delete('startMonth')
            })}
          >
            <SelectTrigger aria-label="Oraliq yakun oyi" className="h-9 w-[160px] rounded border-zinc-200 bg-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label} gacha</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {admins.length > 0 && (
          <Select
            value={selectedAdmin ?? 'ALL'}
            onValueChange={(admin) => admin && navigate((params) => {
              if (admin === 'ALL') params.delete('admin')
              else params.set('admin', admin)
            })}
          >
            <SelectTrigger aria-label="Admin filtri" className="h-9 w-[170px] rounded border-zinc-200 bg-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Barcha adminlar</SelectItem>
              {admins.map((admin) => (
                <SelectItem key={admin.id} value={admin.id}>{admin.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {preset === 'custom' && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitCustom}>
          <div className="space-y-1">
            <Label htmlFor="report-start-month" className="text-xs">Boshlanish oyi</Label>
            <Input id="report-start-month" name="startMonth" type="month" required min={monthOptions.at(-1)?.value} max={monthOptions[0]?.value} defaultValue={startMonth} className="h-9 w-[160px] bg-white" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-end-month" className="text-xs">Yakun oyi</Label>
            <Input id="report-end-month" name="endMonth" type="month" required min={monthOptions.at(-1)?.value} max={monthOptions[0]?.value} defaultValue={endMonth} className="h-9 w-[160px] bg-white" />
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-9">Ko'rsatish</Button>
        </form>
      )}
    </div>
  )
}
