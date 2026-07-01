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
import { getToken } from 'next-auth/jwt'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isAdminRoute = pathname.startsWith('/admin')
  const isShopRoute = pathname.startsWith('/shop')

  // If route is not protected, let it through.
  if (!isAdminRoute && !isShopRoute) {
    return NextResponse.next()
  }

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  })

  if (!token) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = token.role

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
