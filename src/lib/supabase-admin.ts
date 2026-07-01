import { createClient } from '@supabase/supabase-js'

export const PRIVATE_STORAGE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'oryx-private'

export function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin credentials are not configured')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
