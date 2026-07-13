/**
 * Next.js Proxy (formerly Middleware) for Oryx Tech ERP route protection.
 *
 * /admin/* → requires SUPER_ADMIN session role
 * /shop/*  → requires SHOP_ADMIN session role
 * All other paths → pass through
 *
 * Unauthenticated requests are redirected to the role-specific login URL.
 * Wrong-role requests are also redirected to that login URL (with an `error` query param).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ProxyConfig } from 'next/server'
import { getToken } from 'next-auth/jwt'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PLATFORM_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/

export function requestCorrelationId(req: Pick<NextRequest, 'headers'>): string {
  const platformId = req.headers.get('x-vercel-id')?.trim() ?? ''
  return PLATFORM_REQUEST_ID_PATTERN.test(platformId) ? platformId : crypto.randomUUID()
}

function supabaseOrigin(): string {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : ''
  } catch {
    return ''
  }
}

export function buildProtectedPageCsp(nonce: string): string {
  const storageOrigin = supabaseOrigin()
  const isDevelopment = process.env.NODE_ENV === 'development'
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Base UI positions overlays with style attributes. Keeping style inline
    // is required until those primitives are replaced; executable inline
    // scripts are still blocked by the nonce policy above.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${storageOrigin ? ` ${storageOrigin}` : ''}`,
    `font-src 'self' data:`,
    `connect-src 'self'${storageOrigin ? ` ${storageOrigin}` : ''}`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
  ].join('; ')
}

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('x-request-id', requestId)
  return response
}

function forwardedResponse(req: NextRequest, requestId: string) {
  const requestHeaders = new Headers(req.headers)
  // Always overwrite an inbound client value. Only the platform ID or a
  // server-generated UUID may become the audit correlation identifier.
  requestHeaders.set('x-request-id', requestId)
  return withRequestId(
    NextResponse.next({ request: { headers: requestHeaders } }),
    requestId,
  )
}

function protectedPageResponse(req: NextRequest, requestId: string) {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const csp = buildProtectedPageCsp(nonce)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return withRequestId(response, requestId)
}

/**
 * Reject browser-originated cross-site mutations before they reach a route.
 * Server-to-server calls (Telegram, Vercel Cron, internal drains) normally do
 * not send Origin/Sec-Fetch-Site and still rely on their route-level secret.
 */
export function hasTrustedMutationOrigin(req: NextRequest): boolean {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return true

  const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite === 'cross-site') return false

  const origin = req.headers.get('origin')
  if (!origin) return true

  try {
    return new URL(origin).origin === req.nextUrl.origin
  } catch {
    return false
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const requestId = requestCorrelationId(req)

  if (pathname.startsWith('/api/') && !hasTrustedMutationOrigin(req)) {
    return withRequestId(
      NextResponse.json(
        { success: false, error: "So'rov manbasi tasdiqlanmadi" },
        { status: 403 },
      ),
      requestId,
    )
  }

  const isAdminRoute = pathname.startsWith('/admin')
  const isShopRoute = pathname.startsWith('/shop')
  const isLoginRoute = pathname === '/admin/login' || pathname === '/shop/login'

  // If route is not protected, let it through.
  if ((!isAdminRoute && !isShopRoute) || isLoginRoute) {
    return isLoginRoute
      ? protectedPageResponse(req, requestId)
      : forwardedResponse(req, requestId)
  }

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie: req.nextUrl.protocol === 'https:',
  })

  if (!token) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = isAdminRoute ? '/admin/login' : '/shop/login'
    loginUrl.searchParams.set('callbackUrl', pathname)
    return withRequestId(NextResponse.redirect(loginUrl), requestId)
  }

  const role = token.role

  if (isAdminRoute && role !== 'SUPER_ADMIN') {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/admin/login'
    loginUrl.searchParams.set('error', 'unauthorized')
    return withRequestId(NextResponse.redirect(loginUrl), requestId)
  }

  if (isShopRoute && role !== 'SHOP_ADMIN') {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/shop/login'
    loginUrl.searchParams.set('error', 'unauthorized')
    return withRequestId(NextResponse.redirect(loginUrl), requestId)
  }

  return protectedPageResponse(req, requestId)
}

export const config: ProxyConfig = {
  matcher: [
    '/admin/:path*',
    '/shop/:path*',
    '/api/:path*',
  ],
}
