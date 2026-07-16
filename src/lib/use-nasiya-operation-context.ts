'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import type { NasiyaOperationContext } from '@/lib/nasiya-operation-context'

const OPERATION_CONTEXT_STALE_MS = 30_000

/** A permission/version-scoped, abortable dialog query. */
export function useNasiyaOperationContext({
  nasiyaId,
  intent,
  enabled,
  initialData,
}: {
  nasiyaId: string
  intent: 'payment' | 'defer'
  enabled: boolean
  initialData?: NasiyaOperationContext
}) {
  const scope = useAuthenticatedQueryScope()
  return useQuery({
    queryKey: queryKeys.nasiyas.operationContext(scope, nasiyaId, intent),
    enabled: enabled && Boolean(nasiyaId),
    staleTime: OPERATION_CONTEXT_STALE_MS,
    initialData: initialData?.id === nasiyaId ? initialData : undefined,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/nasiya/${encodeURIComponent(nasiyaId)}/operation-context?intent=${intent}`,
        { signal, cache: 'no-store' },
      )
      const json = await response.json() as {
        success: boolean
        data?: NasiyaOperationContext
        error?: string
      }
      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error || "Nasiya ma'lumotlari yuklanmadi")
      }
      return json.data
    },
  })
}
