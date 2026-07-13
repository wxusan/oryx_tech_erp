/**
 * Resolves a stored device image reference into a URL the browser can load.
 *
 * Private images reach the browser only as an authenticated proxy URL with
 * an opaque encrypted reference. Raw storage keys and legacy `?key=` URLs
 * are rejected so they cannot leak into DOM, history, or logs. Genuinely
 * external legacy images remain visible.
 */
export function getDeviceImageSrc(imageUrl: string): string {
  if (imageUrl.startsWith('shops/')) return ''

  try {
    const url = new URL(imageUrl, 'http://oryx.invalid')
    if (url.pathname === '/api/uploads/device') {
      const reference = url.searchParams.get('reference')
      return reference ? `${url.pathname}?reference=${encodeURIComponent(reference)}` : ''
    }
  } catch {
    // Non-URL values are returned as-is so broken data remains visible in QA.
  }

  return imageUrl
}
