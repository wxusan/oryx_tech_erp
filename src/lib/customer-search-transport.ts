/**
 * Builds the only client transport allowed for protected customer search.
 * Keeping this outside UI components also makes it harder to regress to a
 * URL query string while preserving AbortSignal support.
 */
export function customerSearchRequest(
  body: { search: string; skip?: number; take?: number },
  signal?: AbortSignal,
): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  }
}
