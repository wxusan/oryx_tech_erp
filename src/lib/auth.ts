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
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@/types'

const AUTH_WINDOW_MS = 15 * 60 * 1000
const AUTH_LOCK_MS = 10 * 60 * 1000
const AUTH_MAX_FAILURES = 5
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60
const SESSION_UPDATE_AGE_SECONDS = 15 * 60
const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000

type AuthAttempt = { count: number; firstFailedAt: number; lockedUntil?: number }

declare global {
  var authAttempts: Map<string, AuthAttempt> | undefined
}

const authAttempts = global.authAttempts ?? new Map<string, AuthAttempt>()
global.authAttempts = authAttempts

function isLocked(key: string) {
  const attempt = authAttempts.get(key)
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > Date.now())
}

function recordFailure(key: string) {
  const now = Date.now()
  const current = authAttempts.get(key)
  const attempt =
    current && now - current.firstFailedAt < AUTH_WINDOW_MS
      ? { ...current, count: current.count + 1 }
      : { count: 1, firstFailedAt: now }

  if (attempt.count >= AUTH_MAX_FAILURES) {
    attempt.lockedUntil = now + AUTH_LOCK_MS
  }
  authAttempts.set(key, attempt)
}

function clearFailures(key: string) {
  authAttempts.delete(key)
}

function subscriptionCutoff() {
  return new Date(Date.now() - SUBSCRIPTION_GRACE_MS)
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
    }
  }

  interface User {
    id: string
    name: string
    role: UserRole
    shopId: string | null
    sessionVersion: number
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    role: UserRole
    shopId: string | null
    name: string
    sessionVersion: number
  }
}

// ---------------------------------------------------------------------------
// Password verification stub
// ---------------------------------------------------------------------------

async function verifySuperAdminPassword(
  identifier: string,
  password: string,
): Promise<{ id: string; name: string; sessionVersion: number } | null> {
  const admin =
    (await prisma.superAdmin.findFirst({
      where: {
        login: identifier,
        deletedAt: null,
      },
    })) ??
    (await prisma.superAdmin.findFirst({
      where: {
        email: identifier,
        deletedAt: null,
      },
    }))
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
  })
  if (!admin) return null
  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) return null
  return { id: admin.id, name: admin.name, shopId: admin.shopId, sessionVersion: admin.sessionVersion }
}

// ---------------------------------------------------------------------------
// NextAuth config
// ---------------------------------------------------------------------------

export const authConfig: NextAuthConfig = {
  // The AUTH_SECRET env variable is read automatically by NextAuth v5.
  providers: [
    // --- Super Admin flow ---
    Credentials({
      id: 'superadmin',
      name: 'Bosh admin',
      credentials: {
        login: { label: 'Login yoki email', type: 'text' },
        password: { label: 'Parol', type: 'password' },
      },
      async authorize(credentials) {
        const identifier = credentials?.login
        const password = credentials?.password

        if (typeof identifier !== 'string' || typeof password !== 'string') {
          return null
        }

        const login = identifier.trim().toLowerCase()
        if (!login) return null

        const throttleKey = `super:${login}`
        if (isLocked(throttleKey)) return null

        const admin = await verifySuperAdminPassword(login, password)
        if (!admin) {
          recordFailure(throttleKey)
          return null
        }
        clearFailures(throttleKey)

        return {
          id: admin.id,
          name: admin.name,
          role: 'SUPER_ADMIN' as UserRole,
          shopId: null,
          sessionVersion: admin.sessionVersion,
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
      },
      async authorize(credentials) {
        const login = credentials?.login
        const password = credentials?.password

        if (typeof login !== 'string' || typeof password !== 'string') {
          return null
        }

        const normalizedLogin = login.trim()
        if (!normalizedLogin) return null

        const throttleKey = `shop:${normalizedLogin.toLowerCase()}`
        if (isLocked(throttleKey)) return null

        const admin = await verifyShopAdminPassword(normalizedLogin, password)
        if (!admin) {
          recordFailure(throttleKey)
          return null
        }
        clearFailures(throttleKey)

        return {
          id: admin.id,
          name: admin.name,
          role: 'SHOP_ADMIN' as UserRole,
          shopId: admin.shopId,
          sessionVersion: admin.sessionVersion,
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
      }
      return token
    },

    async session({ session, token }) {
      // Expose custom fields on the client-visible session object.
      session.user = {
        id: token.id,
        name: token.name,
        email: token.email ?? '',
        emailVerified: null,
        role: token.role,
        shopId: token.shopId,
        sessionVersion: token.sessionVersion,
      }
      return session
    },
  },

  pages: {
    signIn: '/shop/login',
    error: '/shop/login',
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
