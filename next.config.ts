import type { NextConfig } from "next";

// Conservative, safe-by-default security headers applied to every response.
// See docs/audits/production-readiness-audit.md for the full rationale and
// what remains deferred (Content-Security-Policy — see the note below).
const securityHeaders = [
  // Stop the browser from guessing a response's MIME type from its content
  // (e.g. treating an uploaded image as executable script).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // This app never needs to be embedded in another site's iframe — blocks
  // clickjacking. SAMEORIGIN (not DENY) so the app's own pages can still
  // embed each other if ever needed (e.g. a future print/preview view).
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Send the full referrer only to same-origin requests; cross-origin
  // requests get just the origin, never the full path (which could contain
  // a device/customer id).
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Conservative defaults — this app doesn't use the camera, microphone, or
  // geolocation APIs anywhere.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Vercel already terminates TLS and this app has no non-HTTPS production
  // path, so opting every response into HSTS is safe.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

// Item 6 (docs/product-feature-fixes.md follow-up) — Content-Security-Policy,
// shipped in REPORT-ONLY mode rather than enforcing. Enumerated the app's own
// external origins: Next.js's inline hydration/RSC payload scripts and the
// Tailwind/Radix-style UI primitives' inline styles both need
// 'unsafe-inline' (this app doesn't yet wire a nonce through middleware —
// that's the concrete blocking issue standing between this and a strictly
// enforcing policy); device/passport photos are fetched by the browser
// directly from Supabase Storage via short-lived signed URLs, so img-src
// must allow that origin; next/font/google self-hosts fonts at build time
// (no external font-src needed); there is no analytics/telemetry origin.
// Report-Only means the browser sends violation reports to the console
// without blocking anything, so this cannot break the app — it's here to
// start surfacing what a future *enforcing* policy would need to allow.
function buildCsp(): string {
  let supabaseOrigin = ''
  try {
    supabaseOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : ''
  } catch {
    supabaseOrigin = ''
  }
  const directives = [
    `default-src 'self'`,
    // Blocking issue: Next.js injects inline hydration/RSC scripts with no
    // nonce wired up yet — 'unsafe-inline' is required until that's added.
    `script-src 'self' 'unsafe-inline'`,
    // Blocking issue: several UI primitives (Radix/Base UI, Tailwind
    // utilities) set inline styles — same nonce gap as script-src.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
  ]
  return directives.join('; ')
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Client Router Cache only. Operational writes still validate PostgreSQL
    // transactionally and explicitly invalidate affected routes on success.
    // Fully prefetched high-probability sidebar routes use `static`; keeping
    // both buckets at 30s prevents a targeted prefetch from silently becoming
    // a five-minute user-specific cache entry.
    staleTimes: { dynamic: 30, static: 30 },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, { key: 'Content-Security-Policy-Report-Only', value: buildCsp() }],
      },
    ]
  },
};

export default nextConfig;
