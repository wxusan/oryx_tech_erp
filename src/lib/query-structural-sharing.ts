import { replaceEqualDeep } from '@tanstack/react-query'

type Entity = { id: string }

function hasEntityItems(value: unknown): value is { items: Entity[] } {
  if (!value || typeof value !== 'object' || !('items' in value)) return false
  const items = (value as { items?: unknown }).items
  return Array.isArray(items) && items.every((item) => item && typeof item === 'object' && typeof (item as Entity).id === 'string')
}

/**
 * TanStack's default structural sharing compares arrays positionally. A new
 * first row would therefore clone every shifted row. Lists in this ERP are
 * entity keyed, so reconcile items by id first and then deep-share fields.
 */
export function entityStructuralSharing(oldData: unknown, newData: unknown): unknown {
  if (!hasEntityItems(oldData) || !hasEntityItems(newData)) return replaceEqualDeep(oldData, newData)
  const previousById = new Map(oldData.items.map((item) => [item.id, item]))
  const items = newData.items.map((item) => replaceEqualDeep(previousById.get(item.id), item))
  const sharedEnvelope = replaceEqualDeep(oldData, newData) as Record<string, unknown>
  return { ...sharedEnvelope, items }
}
