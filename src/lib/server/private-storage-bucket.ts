import 'server-only'

import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'

export const PRIVATE_UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024
export const PRIVATE_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

const BUCKET_CHECK_TTL_MS = 10 * 60_000
let bucketReadyUntil = 0
let bucketCheck: Promise<ReturnType<typeof getSupabaseAdminClient>> | null = null

/**
 * Validate/provision the private bucket lazily. Warm instances reuse a
 * successful check for ten minutes, while concurrent cold-start uploads
 * share one promise instead of all calling listBuckets independently.
 */
export function ensurePrivateStorageBucket() {
  const supabase = getSupabaseAdminClient()
  if (Date.now() < bucketReadyUntil) return Promise.resolve(supabase)
  if (bucketCheck) return bucketCheck

  bucketCheck = (async () => {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets()
    if (listError) throw listError

    const existingBucket = buckets.find((bucket) => bucket.name === PRIVATE_STORAGE_BUCKET)
    if (existingBucket) {
      if (existingBucket.public) {
        const { error: updateError } = await supabase.storage.updateBucket(PRIVATE_STORAGE_BUCKET, {
          public: false,
          fileSizeLimit: `${PRIVATE_UPLOAD_MAX_FILE_SIZE}`,
          allowedMimeTypes: [...PRIVATE_UPLOAD_MIME_TYPES],
        })
        if (updateError) throw updateError
      }
    } else {
      const { error: createError } = await supabase.storage.createBucket(PRIVATE_STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: `${PRIVATE_UPLOAD_MAX_FILE_SIZE}`,
        allowedMimeTypes: [...PRIVATE_UPLOAD_MIME_TYPES],
      })
      if (createError && !createError.message.toLowerCase().includes('already exists')) throw createError
    }

    bucketReadyUntil = Date.now() + BUCKET_CHECK_TTL_MS
    return supabase
  })().finally(() => {
    bucketCheck = null
  })

  return bucketCheck
}
