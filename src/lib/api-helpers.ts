/**
 * Shared utilities for Next.js App Router route handlers.
 */

import { NextResponse } from 'next/server'
import type { ApiResponse } from '@/types'
import { requestServerTimingHeader } from '@/lib/server/request-context'

function withRequestTiming<T extends NextResponse>(response: T): T {
  const timing = requestServerTimingHeader()
  if (timing) response.headers.set('Server-Timing', timing)
  return response
}

export function ok<T>(data: T, message?: string): NextResponse<ApiResponse<T>> {
  return withRequestTiming(NextResponse.json({ success: true, data, message }))
}

export function created<T>(data: T, message?: string): NextResponse<ApiResponse<T>> {
  return withRequestTiming(NextResponse.json({ success: true, data, message }, { status: 201 }))
}

export function badRequest(error: string): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 400 }))
}

export function unauthorized(error = "Tizimga kirishingiz kerak"): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 401 }))
}

export function forbidden(error = "Ruxsat yo'q"): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 403 }))
}

export function notFound(error = "Topilmadi"): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 404 }))
}

export function conflict(error: string): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 409 }))
}

export function payloadTooLarge(
  error = "So'rov hajmi ruxsat etilgan chegaradan oshdi",
): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 413 }))
}

export function serverError(error = "Server xatosi yuz berdi"): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json({ success: false, error }, { status: 500 }))
}

export function tooManyRequests(
  retryAfterSeconds: number,
  error = "Juda ko'p so'rov yuborildi. Birozdan keyin qayta urinib ko'ring.",
): NextResponse<ApiResponse> {
  return withRequestTiming(NextResponse.json(
    { success: false, error },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.trunc(retryAfterSeconds))) } },
  ))
}
