/**
 * Resolves a stored device image reference into a URL the browser can load.
 *
 * Device images are stored two ways depending on when they were uploaded:
 * a private-storage object key (`shops/<shopId>/devices/...`, proxied through
 * `/api/uploads/device?key=...` so the private bucket never needs public
 * access), or — for older rows — a full URL that may already point at that
 * same proxy endpoint. Anything else (malformed data) is returned as-is so
 * broken data stays visible in QA rather than silently disappearing.
 */
export function getDeviceImageSrc(imageUrl: string): string {
  if (imageUrl.startsWith('shops/')) {
    return `/api/uploads/device?key=${encodeURIComponent(imageUrl)}`
  }

  try {
    const url = new URL(imageUrl)
    if (url.pathname === '/api/uploads/device') {
      return `${url.pathname}${url.search}`
    }
  } catch {
    // Non-URL values are returned as-is so broken data remains visible in QA.
  }

  return imageUrl
}
