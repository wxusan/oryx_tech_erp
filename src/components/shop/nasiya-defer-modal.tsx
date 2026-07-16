'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { useNasiyaOperationContext } from '@/lib/use-nasiya-operation-context'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import type { NasiyaDeferMutationResult, NasiyaOperationContext, NasiyaOperationSchedule } from '@/lib/nasiya-operation-context'

type Schedule = NasiyaOperationSchedule

interface NasiyaDeferModalProps {
  nasiyaId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: NasiyaDeferMutationResult) => void
  customerName?: string
  deviceName?: string
  /** Queue actions preselect this still-open schedule when it remains valid. */
  preferredScheduleId?: string
  initialContext?: NasiyaOperationContext
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
  preferredScheduleId,
  initialContext,
}: NasiyaDeferModalProps) {
  const command = useLogicalCommandIdempotency()
  const queryClient = useQueryClient()
  const scope = useAuthenticatedQueryScope()
  const contextQuery = useNasiyaOperationContext({
    nasiyaId,
    intent: 'defer',
    enabled: open,
    initialData: initialContext,
  })
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !nasiyaId) return
    const frame = window.requestAnimationFrame(() => {
      setError('')
      setNewDueDate('')
      setReason('')
      setSelectedScheduleId('')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [nasiyaId, open])

  const schedules = useMemo(
    () => (contextQuery.data?.schedules ?? []).filter((schedule) =>
      ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(schedule.status),
    ),
    [contextQuery.data?.schedules],
  )
  const loading = open && contextQuery.isPending && !contextQuery.data
  const contextError = contextQuery.error instanceof Error ? contextQuery.error.message : ''

  useEffect(() => {
    if (!open || schedules.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      setSelectedScheduleId((current) => {
        if (current && schedules.some((schedule) => schedule.id === current)) return current
        return preferredScheduleId && schedules.some((schedule) => schedule.id === preferredScheduleId)
          ? preferredScheduleId
          : schedules[0]?.id ?? ''
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, preferredScheduleId, schedules])

  const selected = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  )
  // A deferral must identify the schedule and a later date. Its ordinary
  // comment is optional; the server records an immutable event either way.
  const canSubmit = Boolean(selected && newDueDate)

  async function submit() {
    if (!canSubmit || submitting) return
    const payload = {
      nasiyaScheduleId: selectedScheduleId,
      newDueDate,
      reason: reason.trim() || undefined,
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
      const result = json.data as NasiyaDeferMutationResult
      if (result.nasiyaScheduleId && result.newDueDate) {
        for (const intent of ['payment', 'defer'] as const) {
          queryClient.setQueryData<NasiyaOperationContext>(
            queryKeys.nasiyas.operationContext(scope, nasiyaId, intent),
            (current) => current ? {
              ...current,
              ledger: {
                ...current.ledger,
                ...(result.ledger?.remaining ? { remaining: result.ledger.remaining } : {}),
                ...(result.ledger?.status ? { status: result.ledger.status } : {}),
              },
              schedules: current.schedules.map((schedule) => schedule.id === result.nasiyaScheduleId
                ? { ...schedule, status: 'DEFERRED', delayedUntil: result.newDueDate! }
                : schedule),
            } : current,
          )
        }
      }
      void commitNavigationMutation({ kind: 'nasiya.deferred', nasiyaId }).catch(() => undefined)
      onOpenChange(false)
      onSuccess(result)
    } catch {
      setError('Muddatni uzaytirishda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  const subtitle = [contextQuery.data?.customer.name || customerName, contextQuery.data?.device.model || deviceName]
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
          {(error || contextError) && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error || contextError}</div>}
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
              <Field label="Izoh">
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
