# Rate limiting

## Two layers

1. **`src/lib/rate-limit.ts`** — the original in-process, fixed-window
   limiter (`checkRateLimit(key, options)`, synchronous). Tracks counts in a
   `Map` kept on `globalThis` for the lifetime of one serverless instance.
   **Limitation**: on a horizontally-scaled deployment (Vercel), a client
   distributed across instances — or one that triggers a cold start — is not
   limited by this alone. Still meaningfully useful (stops a single runaway
   client hammering one warm instance) and costs nothing.

2. **`src/lib/rate-limit-adapter.ts`** — the distributed adapter (item 5 of
   the deferred-items follow-up ticket). Exposes general request counters via
   `checkRateLimitDistributed(key, options)` and credential-failure-only
   counters via `checkLoginFailuresDistributed`,
   `recordLoginFailureDistributed`, and `clearLoginFailuresDistributed`.
   The general limiter keeps the exact same
   `RateLimitOptions`/`RateLimitResult` shape as the original. It picks an
   implementation at first call:
   - **Upstash Redis** (over its REST API — no extra npm dependency
     required) when either the complete `UPSTASH_REDIS_REST_URL` /
     `UPSTASH_REDIS_REST_TOKEN` pair or Vercel Marketplace's complete
     `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair is set. A real distributed limiter: every
     instance shares the same counter in Redis. `INCR`, first-window `PEXPIRE`,
     and TTL retrieval run inside one Redis Lua script, so a worker failure or
     concurrent first request cannot leave a counter without expiry.
   - **The original in-process limiter** otherwise (or if the Upstash
     request itself throws/errors — the adapter **fails open** to
     in-process rather than ever blocking real traffic on a backend outage).

All rate-limited API routes (sale/nasiya payment, olib-sotdim
create/pay, passport/device uploads, nasiya/customer import, device
sell/nasiya-creation) call `checkRateLimitDistributed`, so turning on Upstash
is a pure env-var change — **no code changes needed**.

Credential providers use a separate failure-only policy: five failures per
hashed provider/login identity and twenty failures per hashed source IP in a
15-minute window, followed by a 10-minute lock. Successful password checks do
not consume the counter and clear only the identity counter; the IP counter is
retained to resist password spraying across accounts. Raw login/IP values are
never included in Redis keys.

On Vercel, the source dimension uses the protected
`x-vercel-forwarded-for` header. The ordinary `x-forwarded-for` fallback is
accepted only outside Vercel for a locally trusted reverse proxy. Authentication
success, failure, and rate-limit blocks emit structured events with the
server-controlled request ID and privacy-safe network fingerprint; submitted
logins and raw addresses are not logged.

## Env vars

| Variable | Required for | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Distributed rate limiting | From the Upstash console, e.g. `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting | REST API token from the same Upstash database |
| `KV_REST_API_URL` | Distributed rate limiting | Standard URL injected by Vercel Marketplace Upstash; alternative to `UPSTASH_REDIS_REST_URL` |
| `KV_REST_API_TOKEN` | Distributed rate limiting | Standard token injected by Vercel Marketplace Upstash; alternative to `UPSTASH_REDIS_REST_TOKEN` |

If neither complete pair is configured, the application falls back to a bounded
per-instance limiter and emits no external requests. Production should set
both variables so login and mutation limits are coordinated across Vercel
instances.

## Deployment steps to enable distributed rate limiting

1. Provision Vercel Marketplace's **Upstash for Redis** resource on the linked
   project (preferred), or create a database directly at https://upstash.com.
   Choose a region close to the Vercel deployment region.
2. Marketplace provisioning supplies `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`. For a direct Upstash database, set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from its REST API
   tab. Configure Production and Preview as needed.
3. Never mix a URL from one pair with a token from the other pair.
4. Redeploy. `getRateLimitAdapter()` picks up the env vars on the first
   rate-limit check of each fresh instance and uses Upstash from then on —
   no other change required.

## Adding a new rate-limited route

Same pattern as the existing 10 call sites:

```ts
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'

const rate = await checkRateLimitDistributed(
  rateLimitKey('my-new-route', shopId, session.user.id),
  { windowMs: 60_000, max: 20 },
)
if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)
```

Never call the old synchronous `checkRateLimit` directly in a new route —
it only protects a single instance. Always go through
`checkRateLimitDistributed` so the route automatically benefits once
Upstash is configured.
