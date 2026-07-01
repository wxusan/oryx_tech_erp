/**
 * NextAuth v5 (next-auth@beta) configuration for Oryx Tech ERP.
 *
 * Two credential flows:
 *   1. superadmin  — email + password
 *   2. shopAdmin   — login + password + shopId
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
    }
  }

  interface User {
    id: string
    name: string
    role: UserRole
    shopId: string | null
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string
    role: UserRole
    shopId: string | null
    name: string
  }
}

// ---------------------------------------------------------------------------
// Password verification stub
// ---------------------------------------------------------------------------

async function verifySuperAdminPassword(
  email: string,
  password: string,
): Promise<{ id: string; name: string } | null> {
  const admin = await prisma.superAdmin.findFirst({ where: { email, deletedAt: null } })
  if (!admin) return null
  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) return null
  return { id: admin.id, name: admin.name }
}

async function verifyShopAdminPassword(
  login: string,
  password: string,
  shopId: string,
): Promise<{ id: string; name: string } | null> {
  const admin = await prisma.shopAdmin.findFirst({
    where: {
      shopId,
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
  return { id: admin.id, name: admin.name }
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
      name: 'Super Admin',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Parol', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email
        const password = credentials?.password

        if (typeof email !== 'string' || typeof password !== 'string') {
          return null
        }

        const throttleKey = `super:${email.toLowerCase()}`
        if (isLocked(throttleKey)) return null

        const admin = await verifySuperAdminPassword(email, password)
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
        }
      },
    }),

    // --- Shop Admin flow ---
    Credentials({
      id: 'shopadmin',
      name: 'Shop Admin',
      credentials: {
        login: { label: 'Login', type: 'text' },
        password: { label: 'Parol', type: 'password' },
        shopId: { label: 'Shop ID', type: 'text' },
      },
      async authorize(credentials) {
        const login = credentials?.login
        const password = credentials?.password
        const shopId = credentials?.shopId

        if (
          typeof login !== 'string' ||
          typeof password !== 'string' ||
          typeof shopId !== 'string'
        ) {
          return null
        }

        const throttleKey = `shop:${shopId}:${login.toLowerCase()}`
        if (isLocked(throttleKey)) return null

        const admin = await verifyShopAdminPassword(login, password, shopId)
        if (!admin) {
          recordFailure(throttleKey)
          return null
        }
        clearFailures(throttleKey)

        return {
          id: admin.id,
          name: admin.name,
          role: 'SHOP_ADMIN' as UserRole,
          shopId,
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
  },

  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, `user` is populated — persist custom fields to JWT.
      if (user) {
        token.id = user.id
        token.role = user.role
        token.shopId = user.shopId
        token.name = user.name
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
      }
      return session
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
