import { uzDateTime } from '@/lib/dates'
import type { ApiResponse } from '@/types'

export async function readSettingsApiError(response: Response) {
  try {
    const json: ApiResponse = await response.json()
    return json.error || 'Xatolik yuz berdi'
  } catch {
    return 'Xatolik yuz berdi'
  }
}

export function formatSettingsDate(value: string | null | undefined) {
  return uzDateTime(value)
}
