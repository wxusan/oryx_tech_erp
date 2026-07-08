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

// Content-Security-Policy is intentionally NOT added yet. This app renders
// Next.js's own inline hydration scripts, loads device/passport images from
// Supabase storage via signed URLs, and the dashboard uses inline styles
// from several UI primitives — a CSP tight enough to be meaningful risks
// breaking one of those without a dedicated pass to audit every script/
// style/image source and test each page manually. Next step: enumerate
// every external origin actually used (Supabase storage domain, any font/
// analytics origin) and add a `script-src`/`img-src`/`style-src` policy in
// report-only mode first, verify no violations across a full manual pass,
// then switch to enforcing.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
