export function isImportPlaceholderImei(imei?: string | null): boolean {
  return typeof imei === 'string' && imei.trim().startsWith('IMPORT-')
}

export function displayImei(imei?: string | null): string {
  const trimmed = imei?.trim()
  if (!trimmed || isImportPlaceholderImei(trimmed)) return 'Kiritilmagan'
  return trimmed
}

export function telegramImei(imei?: string | null): string | null {
  const trimmed = imei?.trim()
  if (!trimmed || isImportPlaceholderImei(trimmed)) return null
  return trimmed
}
