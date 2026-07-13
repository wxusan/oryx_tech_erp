import { RoleLoginForm } from '@/components/auth/role-login-form'
import { connection } from 'next/server'

export default async function AdminLoginPage() {
  // Nonce-based CSP requires request-time rendering so Next can attach the
  // proxy-generated nonce to every framework and hydration script.
  await connection()
  return <RoleLoginForm mode="admin" />
}
