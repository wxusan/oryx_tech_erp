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
   the deferred-items follow-up ticket). Exposes one async function,
   `checkRateLimitDistributed(key, options)`, with the exact same
   `RateLimitOptions`/`RateLimitResult` shape as the original. It picks an
   implementation at first call:
   - **Upstash Redis** (over its REST API — no extra npm dependency
     required) when both `UPSTASH_REDIS_REST_URL` and
     `UPSTASH_REDIS_REST_TOKEN` are set. A real distributed limiter: every
     instance shares the same counter in Redis, via `INCR` + `TTL`/`EXPIRE`
     over one pipelined HTTP request per check.
   - **The original in-process limiter** otherwise (or if the Upstash
     request itself throws/errors — the adapter **fails open** to
     in-process rather than ever blocking real traffic on a backend outage).

All 10 rate-limited API routes (sale/nasiya payment, olib-sotdim
create/pay, passport/device uploads, nasiya/customer import, device
sell/nasiya-creation) call `checkRateLimitDistributed`, so turning on Upstash
is a pure env-var change — **no code changes needed**.

## Env vars

| Variable | Required for | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Distributed rate limiting | From the Upstash console, e.g. `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting | REST API token from the same Upstash database |

Neither is set in this project today — confirmed via `.env.local` (no
`UPSTASH_*` keys present) — so every deployment currently runs on the
in-process fallback. This is a known, documented gap, not a bug.

## Deployment steps to enable distributed rate limiting

1. Create a free Upstash Redis database at https://upstash.com (any region
   close to the Vercel deployment region minimizes latency).
2. From the database's "REST API" tab, copy the REST URL and REST token.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as
   environment variables on the Vercel project (Production + Preview, as
   needed).
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
