import { requireApiSession } from '@/lib/api-auth'

/**
 * Validates the client JWT against the durable server-side session record.
 *
 * The Auth.js session endpoint only confirms that a JWT can be decoded. Login
 * pages must use this endpoint before redirecting an already-signed-in user:
 * a revoked or idle-expired server session can still have a decodable JWT.
 */
export async function GET() {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response

  return Response.json({ role: guarded.session.user.role })
}
