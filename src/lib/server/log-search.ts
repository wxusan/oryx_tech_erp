import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import {
  LOG_CONTEXT_ACTION_LABELS,
  LOG_DIRECT_ACTION_LABELS,
  LOG_TARGET_LABELS,
} from '@/lib/presentation-labels'
import { matchesSearchValue, prepareSearchNeedle } from '@/lib/search-needle'

export interface LogLabelSearchCodes {
  actions: string[]
  targetTypes: string[]
  actionTargetPairs: Array<{ action: string; targetType: string }>
}

function normalizeUzbekApostrophes(value: string) {
  return value.replace(/[ʻʼ‘’'`]/g, "'")
}

function labelContains(label: string, query: string) {
  return matchesSearchValue(
    normalizeUzbekApostrophes(label),
    normalizeUzbekApostrophes(query),
    'text',
  )
}

/**
 * Resolve only the finite labels the log UI can render. Contextual labels
 * retain their action+target pairing, so a search for "Qurilma qo‘shildi"
 * does not accidentally return every CREATE event or every Device event.
 */
export function resolveLogLabelSearchCodes(
  searchValue: string | null | undefined,
): LogLabelSearchCodes {
  const query = prepareSearchNeedle(searchValue).query
  if (!query) return { actions: [], targetTypes: [], actionTargetPairs: [] }

  const actions = new Set<string>()
  const targetTypes = new Set<string>()
  const pairs = new Map<string, { action: string; targetType: string }>()

  for (const [action, label] of Object.entries(LOG_DIRECT_ACTION_LABELS)) {
    if (labelContains(label, query)) actions.add(action)
  }
  for (const [targetType, label] of Object.entries(LOG_TARGET_LABELS)) {
    if (labelContains(label, query)) targetTypes.add(targetType)
  }
  for (const [action, labelsByTarget] of Object.entries(LOG_CONTEXT_ACTION_LABELS)) {
    for (const [targetType, label] of Object.entries(labelsByTarget)) {
      if (!labelContains(label, query)) continue
      if (targetType === '*') {
        actions.add(action)
        continue
      }
      pairs.set(`${action}\u0000${targetType}`, { action, targetType })
    }
  }

  return {
    actions: [...actions].sort(),
    targetTypes: [...targetTypes].sort(),
    actionTargetPairs: [...pairs.values()].sort((left, right) => (
      left.action.localeCompare(right.action) || left.targetType.localeCompare(right.targetType)
    )),
  }
}

/** One raw-field + localized-label predicate shared by both log list paths. */
export function buildLogSearchWhere(
  searchValue: string | null | undefined,
): Prisma.LogWhereInput {
  const prepared = prepareSearchNeedle(searchValue)
  if (!prepared.query) return {}
  const labelCodes = resolveLogLabelSearchCodes(prepared.query)

  return {
    OR: [
      { action: { contains: prepared.escapedText, mode: 'insensitive' } },
      { targetType: { contains: prepared.escapedText, mode: 'insensitive' } },
      { targetId: { contains: prepared.escapedText, mode: 'insensitive' } },
      { note: { contains: prepared.escapedText, mode: 'insensitive' } },
      { shop: { name: { contains: prepared.escapedText, mode: 'insensitive' } } },
      ...(labelCodes.actions.length > 0 ? [{ action: { in: labelCodes.actions } }] : []),
      ...(labelCodes.targetTypes.length > 0
        ? [{ targetType: { in: labelCodes.targetTypes } }]
        : []),
      ...labelCodes.actionTargetPairs.map(({ action, targetType }) => ({ action, targetType })),
    ],
  }
}
