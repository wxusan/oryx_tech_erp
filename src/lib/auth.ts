/**
 * NextAuth v5 (next-auth@beta) configuration for Oryx Tech ERP.
 *
 * Two credential flows:
 *   1. superadmin  — login + password
 *   2. shopAdmin   — login + password
 *
 * Session strategy: JWT (required for credentials providers in NextAuth v5).
 * Session shape: { id, role, shopId, name }
 *
 * Module augmentation extends the built-in Session / JWT types with our fields.
 */

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'
import bcrypt from 'bcrypt'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@/types'
import { logger } from '@/lib/logger'
import { initializeRequestAuditContext } from '@/lib/server/request-context'
import {
  checkLoginFailuresDistributed,
  clearLoginFailuresDistributed,
  recordLoginFailureDistributed,
  type LoginFailureOptions,
} from '@/lib/rate-limit-adapter'
import { enabledFeatureSet, getActiveShopPackage } from '@/lib/server/shop-access'
import { shopMemberKind } from '@/lib/access-control'
import { Prisma } from '@/generated/prisma/client'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const AUTH_LOCK_MS = 10 * 60 * 1000
const AUTH_MAX_FAILURES = 5
const AUTH_IP_MAX_FAILURES = 20
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const SESSION_UPDATE_AGE_SECONDS = 15 * 60
const IDLE_SESSION_POLICY = 'IDLE_10_MINUTES' as const
const REMEMBERED_SESSION_POLICY = 'REMEMBERED_30_DAYS' as const
const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000

const IDENTIFIER_THROTTLE: LoginFailureOptions = {
  windowMs: AUTH_WINDOW_MS,
  lockMs: AUTH_LOCK_MS,
  max: AUTH_MAX_FAILURES,
}
const IP_THROTTLE: LoginFailureOptions = {
  windowMs: AUTH_WINDOW_MS,
  lockMs: AUTH_LOCK_MS,
  max: AUTH_IP_MAX_FAILURES,
}

function opaqueThrottleKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function requestIp(request: Request | undefined) {
  const vercelForwarded = request?.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  const forwarded = process.env.VERCEL
    ? null
    : request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const direct = request?.headers.get('x-real-ip')?.trim() || request?.headers.get('cf-connecting-ip')?.trim()
  const value = vercelForwarded || forwarded || direct
  return value && value.length <= 128 ? value : null
}

function loginThrottleKeys(provider: 'superadmin' | 'shopadmin', login: string, request?: Request) {
  const identifierKey = `login:identity:${opaqueThrottleKey(`${provider}:${login.toLowerCase()}`)}`
  const ip = requestIp(request)
  return {
    identifierKey,
    ipKey: ip ? `login:ip:${opaqueThrottleKey(ip)}` : null,
  }
}

async function isLoginLocked(keys: ReturnType<typeof loginThrottleKeys>) {
  const checks = [checkLoginFailuresDistributed(keys.identifierKey, IDENTIFIER_THROTTLE)]
  if (keys.ipKey) checks.push(checkLoginFailuresDistributed(keys.ipKey, IP_THROTTLE))
  return (await Promise.all(checks)).some((result) => !result.allowed)
}

async function recordLoginFailure(keys: ReturnType<typeof loginThrottleKeys>) {
  const writes = [recordLoginFailureDistributed(keys.identifierKey, IDENTIFIER_THROTTLE)]
  if (keys.ipKey) writes.push(recordLoginFailureDistributed(keys.ipKey, IP_THROTTLE))
  await Promise.all(writes)
}

function subscriptionCutoff() {
  return new Date(Date.now() - SUBSCRIPTION_GRACE_MS)
}

async function createServerSession(input: {
  actorId: string
  actorType: UserRole
  shopId: string | null
  sessionVersion: number
}) {
  const id = randomUUID()
  await prisma.authSession.create({
    data: {
      id,
      actorId: input.actorId,
      actorType: input.actorType,
      shopId: input.shopId,
      packageVersionId: null,
      sessionVersion: input.sessionVersion,
      policy: IDLE_SESSION_POLICY,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  })
  return { sessionId: id, sessionPolicy: IDLE_SESSION_POLICY, packageVersionId: null }
}

async function createGuardedShopSession(input: {
  actorId: string
  shopId: string
  sessionVersion: number
  rememberMe: boolean
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${input.shopId} FOR UPDATE`)
        const live = await tx.shopAdmin.findFirst({
          where: {
            id: input.actorId,
            shopId: input.shopId,
            isActive: true,
            deletedAt: null,
            sessionVersion: input.sessionVersion,
            shop: {
              status: 'ACTIVE',
              deletedAt: null,
              subscriptionDue: { gte: subscriptionCutoff() },
            },
          },
          select: { id: true, sessionVersion: true, shop: { select: { ownerAdminId: true } } },
        })
        if (!live) return null
        const packageVersion = await getActiveShopPackage(input.shopId, new Date(), tx)
        if (!packageVersion) return null
        const memberKind = shopMemberKind({ memberId: live.id, ownerAdminId: live.shop.ownerAdminId })
        if (memberKind === 'SHOP_STAFF' && !enabledFeatureSet(packageVersion).has('STAFF_ACCESS')) return null

        const id = randomUUID()
        const sessionPolicy = input.rememberMe ? REMEMBERED_SESSION_POLICY : IDLE_SESSION_POLICY
        await tx.authSession.create({
          data: {
            id,
            actorId: live.id,
            actorType: 'SHOP_ADMIN',
            shopId: input.shopId,
            packageVersionId: packageVersion.id,
            sessionVersion: live.sessionVersion,
            policy: sessionPolicy,
            expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
          },
        })
        return { sessionId: id, sessionPolicy, packageVersionId: packageVersion.id }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Module augmentation — extend NextAuth default types
// ---------------------------------------------------------------------------

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      role: UserRole
      shopId: string | null
      sessionVersion: number
      sessionId: string
      sessionPolicy: 'IDLE_10_MINUTES' | 'REMEMBERED_30_DAYS'
      packageVersionId: string | null
    }
  }

  interface User {
    id: string
    name: string
    role: UserRole
    shopId: string | null
    sessionVersion: number
    sessionId: string
    sessionPolicy: 'IDLE_10_MINUTES' | 'REMEMBERED_30_DAYS'
    packageVersionId: string | null
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    role: UserRole
    shopId: string | null
    name: string
    sessionVersion: number
    sessionId: string
    sessionPolicy: 'IDLE_10_MINUTES' | 'REMEMBERED_30_DAYS'
    packageVersionId: string | null
  }
}

// ---------------------------------------------------------------------------
// Password verification stub
// ---------------------------------------------------------------------------

async function verifySuperAdminPassword(
  login: string,
  password: string,
): Promise<{ id: string; name: string; sessionVersion: number } | null> {
  const admin = await prisma.superAdmin.findFirst({
    where: {
      login,
      deletedAt: null,
    },
  })
  if (!admin) return null
  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) return null
  return { id: admin.id, name: admin.name, sessionVersion: admin.sessionVersion }
}

async function verifyShopAdminPassword(
  login: string,
  password: string,
): Promise<{ id: string; name: string; shopId: string; sessionVersion: number } | null> {
  const admin = await prisma.shopAdmin.findFirst({
    where: {
      login,
      isActive: true,
      deletedAt: null,
      shop: {
        status: 'ACTIVE',
        deletedAt: null,
        subscriptionDue: { gte: subscriptionCutoff() },
      },
    },
    select: {
      id: true,
      name: true,
      shopId: true,
      passwordHash: true,
      sessionVersion: true,
      shop: { select: { ownerAdminId: true } },
    },
  })
  if (!admin) return null
  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) return null
  const packageVersion = await getActiveShopPackage(admin.shopId)
  if (!packageVersion) return null
  const memberKind = shopMemberKind({ memberId: admin.id, ownerAdminId: admin.shop.ownerAdminId })
  if (memberKind === 'SHOP_STAFF' && !enabledFeatureSet(packageVersion).has('STAFF_ACCESS')) return null
  return { id: admin.id, name: admin.name, shopId: admin.shopId, sessionVersion: admin.sessionVersion }
}

// ---------------------------------------------------------------------------
// NextAuth config
// ---------------------------------------------------------------------------

export const authConfig: NextAuthConfig = {
  // An empty AUTH_SECRET value from a deployment must not mask a valid
  // legacy NEXTAUTH_SECRET during local development or migration.
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  providers: [
    // --- Super Admin flow ---
    Credentials({
      id: 'superadmin',
      name: 'Bosh admin',
      credentials: {
        login: { label: 'Login', type: 'text' },
        password: { label: 'Parol', type: 'password' },
      },
      async authorize(credentials, request) {
        await initializeRequestAuditContext(request.headers)
        const identifier = credentials?.login
        const password = credentials?.password

        if (typeof identifier !== 'string' || typeof password !== 'string') {
          return null
        }

        const login = identifier.trim().toLowerCase()
        if (!login) return null

        const throttleKeys = loginThrottleKeys('superadmin', login, request)
        if (await isLoginLocked(throttleKeys)) {
          logger.warn('Authentication attempt blocked by rate limit', {
            event: 'auth.login_blocked',
            actorType: 'SUPER_ADMIN',
            status: 'rate_limited',
          })
          return null
        }

        const admin = await verifySuperAdminPassword(login, password)
        if (!admin) {
          await recordLoginFailure(throttleKeys)
          logger.warn('Authentication failed', {
            event: 'auth.login_failed',
            actorType: 'SUPER_ADMIN',
            status: 'invalid_credentials',
          })
          return null
        }
        await clearLoginFailuresDistributed(throttleKeys.identifierKey)
        const serverSession = await createServerSession({
          actorId: admin.id,
          actorType: 'SUPER_ADMIN',
          shopId: null,
          sessionVersion: admin.sessionVersion,
        })
        logger.info('Authentication succeeded', {
          event: 'auth.login_succeeded',
          actorId: admin.id,
          actorType: 'SUPER_ADMIN',
          status: 'ok',
        })

        return {
          id: admin.id,
          name: admin.name,
          role: 'SUPER_ADMIN' as UserRole,
          shopId: null,
          sessionVersion: admin.sessionVersion,
          ...serverSession,
        }
      },
    }),

    // --- Shop Admin flow ---
    Credentials({
      id: 'shopadmin',
      name: "Do'kon admini",
      credentials: {
        login: { label: 'Login', type: 'text' },
        password: { label: 'Parol', type: 'password' },
        rememberMe: { label: 'Meni eslab qol', type: 'checkbox' },
      },
      async authorize(credentials, request) {
        await initializeRequestAuditContext(request.headers)
        const login = credentials?.login
        const password = credentials?.password
        const rememberMe = credentials?.rememberMe === true || credentials?.rememberMe === 'true' || credentials?.rememberMe === 'on'

        if (typeof login !== 'string' || typeof password !== 'string') {
          return null
        }

        const normalizedLogin = login.trim()
        if (!normalizedLogin) return null

        const throttleKeys = loginThrottleKeys('shopadmin', normalizedLogin, request)
        if (await isLoginLocked(throttleKeys)) {
          logger.warn('Authentication attempt blocked by rate limit', {
            event: 'auth.login_blocked',
            actorType: 'SHOP_ADMIN',
            status: 'rate_limited',
          })
          return null
        }

        const admin = await verifyShopAdminPassword(normalizedLogin, password)
        if (!admin) {
          await recordLoginFailure(throttleKeys)
          logger.warn('Authentication failed', {
            event: 'auth.login_failed',
            actorType: 'SHOP_ADMIN',
            status: 'invalid_credentials',
          })
          return null
        }
        await clearLoginFailuresDistributed(throttleKeys.identifierKey)
        const serverSession = await createGuardedShopSession({
          actorId: admin.id,
          shopId: admin.shopId,
          sessionVersion: admin.sessionVersion,
          rememberMe,
        })
        if (!serverSession) {
          logger.warn('Authentication invalidated during session creation', {
            event: 'auth.login_invalidated',
            shopId: admin.shopId,
            actorId: admin.id,
            actorType: 'SHOP_ADMIN',
          })
          return null
        }
        logger.info('Authentication succeeded', {
          event: 'auth.login_succeeded',
          shopId: admin.shopId,
          actorId: admin.id,
          actorType: 'SHOP_ADMIN',
          status: 'ok',
        })

        return {
          id: admin.id,
          name: admin.name,
          role: 'SHOP_ADMIN' as UserRole,
          shopId: admin.shopId,
          sessionVersion: admin.sessionVersion,
          ...serverSession,
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },

  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, `user` is populated — persist custom fields to JWT.
      if (user) {
        token.id = user.id
        token.role = user.role
        token.shopId = user.shopId
        token.name = user.name
        token.sessionVersion = user.sessionVersion
        token.sessionId = user.sessionId
        token.sessionPolicy = user.sessionPolicy
        token.packageVersionId = user.packageVersionId
      }
      return token
    },

    async session({ session, token }) {
      // Expose custom fields on the client-visible session object.
      session.user = {
        id: token.id,
        name: token.name,
        email: '',
        emailVerified: null,
        role: token.role,
        shopId: token.shopId,
        sessionVersion: token.sessionVersion,
        sessionId: token.sessionId,
        sessionPolicy: token.sessionPolicy,
        packageVersionId: token.packageVersionId,
      }
      return session
    },
  },

  pages: {
    signIn: '/shop/login',
    error: '/shop/login',
  },

  events: {
    async signOut(message) {
      if ('token' in message && message.token?.sessionId) {
        await prisma.authSession.updateMany({
          where: { id: message.token.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
