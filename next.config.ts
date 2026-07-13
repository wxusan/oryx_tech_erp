import type { NextConfig } from "next";

// Conservative, safe-by-default security headers applied to every response.
// See docs/audits/production-readiness-audit.md for the full rationale.
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

// Baseline Content-Security-Policy for public/unmatched responses. Protected
// admin/shop pages receive a per-request script nonce from src/proxy.ts. The
// baseline keeps inline hydration compatible for responses that never pass
// through that authenticated page matcher; device/passport photos are fetched
// directly from Supabase Storage via short-lived signed URLs, so img-src
// must allow that origin; next/font/google self-hosts fonts at build time
// (no external font-src needed); there is no analytics/telemetry origin.
// Protected pages block executable inline script while retaining inline style
// attributes required by the current Base UI overlay primitives.
function buildCsp(): string {
  let supabaseOrigin = ''
  try {
    supabaseOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : ''
  } catch {
    supabaseOrigin = ''
  }
  const directives = [
    `default-src 'self'`,
    // Protected admin/shop pages override this baseline with a per-request
    // nonce in src/proxy.ts.
    `script-src 'self' 'unsafe-inline'`,
    // Several Base UI primitives position overlays with inline style attrs.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    `object-src 'none'`,
    `frame-src 'none'`,
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
    // both buckets at two minutes makes warm return navigation instant while
    // the authenticated delta coordinator supplies precise freshness.
    staleTimes: { dynamic: 120, static: 120 },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, { key: 'Content-Security-Policy', value: buildCsp() }],
      },
    ]
  },
};

export default nextConfig;
