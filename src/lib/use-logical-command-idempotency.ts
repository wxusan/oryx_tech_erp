'use client'

import { useState } from 'react'

type CommandState = { fingerprint: string; key: string }

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    )
  }
  return value
}

/** Fingerprint the JSON payload exactly as it will cross the network. */
export function logicalCommandFingerprint(payload: unknown) {
  const serialized = JSON.stringify(payload)
  if (serialized === undefined) return 'undefined'
  return JSON.stringify(sortJson(JSON.parse(serialized) as unknown))
}

/**
 * A 4xx normally proves that the command was rejected and can receive a new
 * key after correction. Timeout/Too-Early/rate-limit responses remain
 * ambiguous, so a retry must retain the original key.
 */
export function isDefinitiveCommandRejection(status: number) {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status)
}

export class LogicalCommandIdempotency {
  private current: CommandState | null = null

  constructor(private readonly createKey: () => string = () => crypto.randomUUID()) {}

  keyFor(payload: unknown) {
    const fingerprint = logicalCommandFingerprint(payload)
    if (!this.current || this.current.fingerprint !== fingerprint) {
      this.current = { fingerprint, key: this.createKey() }
    }
    return this.current.key
  }

  committed() {
    this.current = null
  }

  rejected(status: number) {
    if (isDefinitiveCommandRejection(status)) this.current = null
  }
}

/** One idempotency command survives React renders and ambiguous HTTP retries. */
export function useLogicalCommandIdempotency() {
  const [command] = useState(() => new LogicalCommandIdempotency())
  return command
}
