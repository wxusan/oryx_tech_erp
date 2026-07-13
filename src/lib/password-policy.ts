/** bcrypt ignores bytes after the first 72; accepting more creates collisions. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).byteLength
}

export function isBcryptPasswordWithinLimit(password: string): boolean {
  return passwordByteLength(password) <= BCRYPT_MAX_PASSWORD_BYTES
}

export const BCRYPT_PASSWORD_TOO_LONG_MESSAGE =
  "Parol UTF-8 bo'yicha 72 baytdan oshmasligi kerak"
