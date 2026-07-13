import 'server-only'

import sharp from 'sharp'
import { hasValidImageSignature } from '@/lib/server/image-signature'
import {
  PRIVATE_UPLOAD_MAX_DIMENSION,
  PRIVATE_UPLOAD_MAX_PIXELS,
  PRIVATE_UPLOAD_MIME_TYPES,
} from '@/lib/server/private-storage-bucket'

type AllowedImageMimeType = (typeof PRIVATE_UPLOAD_MIME_TYPES)[number]

const FORMAT_BY_MIME: Record<AllowedImageMimeType, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type ImageValidationResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'signature' | 'decode' | 'format' | 'dimensions' | 'animated' }

function isAllowedMimeType(mimeType: string): mimeType is AllowedImageMimeType {
  return PRIVATE_UPLOAD_MIME_TYPES.some((allowed) => allowed === mimeType)
}

/**
 * Validate the claimed type, parser-visible format, decoded dimensions and
 * full image stream. `limitInputPixels` rejects decompression bombs inside
 * libvips before the complete bitmap is allocated.
 */
export async function validatePrivateUploadImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ImageValidationResult> {
  if (!isAllowedMimeType(mimeType) || !hasValidImageSignature(bytes, mimeType)) {
    return { ok: false, reason: 'signature' }
  }

  try {
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: PRIVATE_UPLOAD_MAX_PIXELS,
      sequentialRead: true,
    })
    const metadata = await image.metadata()
    if (metadata.format !== FORMAT_BY_MIME[mimeType]) {
      return { ok: false, reason: 'format' }
    }

    const { width, height } = metadata
    if (
      !width ||
      !height ||
      width > PRIVATE_UPLOAD_MAX_DIMENSION ||
      height > PRIVATE_UPLOAD_MAX_DIMENSION ||
      width * height > PRIVATE_UPLOAD_MAX_PIXELS
    ) {
      return { ok: false, reason: 'dimensions' }
    }
    if ((metadata.pages ?? 1) !== 1) {
      return { ok: false, reason: 'animated' }
    }

    // metadata() reads headers; stats() forces a complete, bounded decode so a
    // valid prefix followed by corrupt/truncated bytes cannot reach storage.
    await image.stats()
    return { ok: true, width, height }
  } catch {
    return { ok: false, reason: 'decode' }
  }
}
