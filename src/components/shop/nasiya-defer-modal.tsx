'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { commitNavigationMutation } from '@/lib/client-events'
import { uzDate } from '@/lib/dates'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

interface Schedule {
  id: string
  monthNumber: number
  dueDate: string
  delayedUntil: string | null
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED'
}

interface NasiyaDeferModalProps {
  nasiyaId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  customerName?: string
  deviceName?: string
}

function effectiveDue(schedule: Schedule) {
  return schedule.delayedUntil ?? schedule.dueDate
}

export function NasiyaDeferModal({
  nasiyaId,
  open,
  onOpenChange,
  onSuccess,
  customerName,
  deviceName,
}: NasiyaDeferModalProps) {
  const command = useLogicalCommandIdempotency()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [identity, setIdentity] = useState({ customerName: '', deviceName: '' })

  useEffect(() => {
    if (!open || !nasiyaId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      setNewDueDate('')
      setReason('')
      try {
        const response = await fetch(`/api/nasiya/${nasiyaId}`)
        const json = await response.json()
        if (cancelled) return
        if (!json.success) {
          setError(json.error || 'Nasiya topilmadi')
          return
        }
        const pending = (json.data.schedules ?? []).filter((schedule: Schedule) =>
          ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(schedule.status),
        )
        setSchedules(pending)
        setSelectedScheduleId(pending[0]?.id ?? '')
        setIdentity({
          customerName: json.data.customer?.name ?? '',
          deviceName: json.data.device?.model ?? '',
        })
      } catch {
        if (!cancelled) setError('Nasiya ma’lumotlarini olishda xatolik')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [nasiyaId, open])

  const selected = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  )
  const canSubmit = Boolean(selected && newDueDate && reason.trim().length >= 5)

  async function submit() {
    if (!canSubmit || submitting) return
    const payload = {
      nasiyaScheduleId: selectedScheduleId,
      newDueDate,
      reason: reason.trim(),
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/nasiya/${nasiyaId}/defer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await response.json()
      if (!response.ok || !json.success) {
        command.rejected(response.status)
        setError(json.error || 'Muddatni uzaytirishda xatolik')
        return
      }
      command.committed()
      await commitNavigationMutation({ kind: 'nasiya.deferred', nasiyaId }).catch(() => undefined)
      onOpenChange(false)
      onSuccess()
    } catch {
      setError('Muddatni uzaytirishda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  const subtitle = [identity.customerName || customerName, identity.deviceName || deviceName]
    .filter(Boolean)
    .join(' · ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl sm:w-full">
        <DialogHeader>
          <DialogTitle>To&apos;lov muddatini uzaytirish</DialogTitle>
          <DialogDescription>
            {subtitle || 'Bu amal to’lov yozmaydi va to’langan summani o’zgartirmaydi.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {loading ? (
            <div className="py-6 text-center text-sm text-zinc-400">Yuklanmoqda...</div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="nasiya-defer-schedule" className="block text-xs font-medium text-zinc-700">
                  To&apos;lov oyi <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <Select value={selectedScheduleId} onValueChange={(value) => value && setSelectedScheduleId(value)}>
                  <SelectTrigger id="nasiya-defer-schedule" aria-required="true" className="h-10 w-full rounded-lg border-zinc-200">
                    <SelectValue placeholder="To'lov oyini tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    {schedules.map((schedule) => (
                      <SelectItem key={schedule.id} value={schedule.id}>
                        {schedule.monthNumber}-oy · {uzDate(effectiveDue(schedule))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selected && (
                <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-500">Hozirgi muddat</span>
                  <Badge variant="outline" className="bg-white">{uzDate(effectiveDue(selected))}</Badge>
                </div>
              )}
              <Field label="Yangi to'lov sanasi" required>
                <DateInput value={newDueDate} onValueChange={setNewDueDate} className="h-10 rounded-lg border-zinc-200" />
              </Field>
              <Field label="Kechiktirish sababi" required>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Masalan: mijoz 10 kunga kechiktirishni so'radi"
                  className="min-h-24 rounded-lg border-zinc-200"
                />
              </Field>
              <p className="text-xs text-zinc-500">
                Bu alohida kechiktirish hodisasi sifatida saqlanadi. To&apos;lov usuli yoki summa so&apos;ralmaydi.
              </p>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Bekor qilish</Button>
          <Button disabled={!canSubmit || submitting || loading} onClick={submit}>
            {submitting ? 'Saqlanmoqda...' : 'Muddatni uzaytirish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
