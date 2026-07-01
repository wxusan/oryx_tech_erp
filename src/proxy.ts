/**
 * Next.js Proxy (formerly Middleware) for Oryx Tech ERP route protection.
 *
 * /admin/* → requires SUPER_ADMIN session role
 * /shop/*  → requires SHOP_ADMIN session role
 * All other paths → pass through
 *
 * Unauthenticated requests are redirected to /login.
 * Wrong-role requests are also redirected to /login (with an `error` query param).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ProxyConfig } from 'next/server'
import { auth } from '@/lib/auth'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isAdminRoute = pathname.startsWith('/admin')
  const isShopRoute = pathname.startsWith('/shop')

  // If route is not protected, let it through.
  if (!isAdminRoute && !isShopRoute) {
    return NextResponse.next()
  }

  // auth() in proxy returns the session from the JWT cookie.
  const session = await auth()

  if (!session?.user) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = session.user.role

  if (isAdminRoute && role !== 'SUPER_ADMIN') {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(loginUrl)
  }

  if (isShopRoute && role !== 'SHOP_ADMIN') {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config: ProxyConfig = {
  matcher: [
    '/admin/:path*',
    '/shop/:path*',
  ],
}
