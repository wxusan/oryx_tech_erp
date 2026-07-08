# Security audit — Oryx Tech ERP

Date: 2026-07-08. See `full-production-audit.md` for the overall scorecard.

## Method

Every file under `src/app/api/**/route.ts` (~35 route files, ~58 individual
handlers) was read and checked for: (1) an auth guard as the first
statement, (2) `shopId` present in every `where` clause that reads/writes a
record identified by a client-supplied `id`, (3) whether a SHOP_ADMIN's
client-supplied `shopId` in a request body could ever override their
session shop. `src/lib/api-auth.ts`, file upload routes, the Telegram
webhook, and environment-variable usage were read in full.

## 1. Authentication

Every protected route calls `requireApiSession()` (shop admin/super admin
session) or `requireSuperAdmin()` (super-admin-only routes) as its first
statement; the two public exceptions are `GET /api/health` and the
NextAuth handler itself, both intentional. Login has an in-memory
failure-count throttle (`src/lib/auth.ts`): 5 failures within 15 minutes
locks the login/shop key for 10 minutes, applied identically to both the
super-admin and shop-admin credential flows.

**Verdict: no gaps found.**

## 2. Authorization / roles

`resolveActiveShopId()` (`src/lib/api-auth.ts`) is the single chokepoint:
for a SHOP_ADMIN session it always returns `session.user.shopId`,
**ignoring** any client-supplied `shopId` in the request body; for a
SUPER_ADMIN it validates the supplied `shopId` against the database before
returning it. Every route that accepts an optional body `shopId` (for
SUPER_ADMIN cross-shop operations) routes through this function — a
SHOP_ADMIN cannot forge access to another shop by tampering with the
request body.

**Verdict: no gaps found.**

## 3. Tenant isolation

The highest-priority check. All ~58 route handlers were enumerated; every
one that reads or writes a specific record via a path-param `id` includes
`shopId` in the Prisma `where` clause (either directly, e.g.
`{ id: saleId, shopId, deletedAt: null }`, or via a `resolveActiveShopId()`
result threaded into the query). Representative examples:

- `src/app/api/sales/[id]/payment/route.ts:97` — `{ id: saleId, shopId, deletedAt: null }`
- `src/app/api/nasiya/[id]/payment/route.ts` — same pattern
- `src/app/api/olib-sotdim/[id]/pay/route.ts` — same pattern (and now also
  used as the atomicity guard, see the business-logic audit)
- `src/app/api/devices/[id]/route.ts`, `.../sell`, `.../nasiya`,
  `.../return`, `.../restock` — all scoped

List/filter routes (`GET /api/devices`, `/api/nasiya`, `/api/customers`,
`/api/olib-sotdim`, `/api/logs`, `/api/export/[entity]`) all scope their
`where` clause to the resolved `shopId`.

One route, `POST /api/shops/[id]/admins`, fetches the target `Shop` by
`{ id, deletedAt: null }` with no additional tenant filter — this was
investigated and found to be correct as written: a `Shop` record's own
`id` **is** the tenant boundary (there is no parent `shopId` field for a
Shop to be scoped by), and the route is gated by `requireSuperAdmin()`, so
only a super-admin (who is allowed to act across all shops) can reach it.

**Verdict: excellent, no real gaps found.**

## 4. Sensitive data protection

- `passportPhotoUrl`, `telegramId`, `passwordHash`, `sessionVersion` were
  grepped across `src/app` and `src/lib`: passport URLs are never included
  in any Telegram message template (`src/lib/telegram-templates.ts`);
  `passwordHash` is only ever read for bcrypt comparison, never logged or
  returned in an API response; `telegramId` is used only as the Telegram
  send target, never echoed back to the browser beyond what a shop admin
  needs to see their own linked account.
- No `console.log`/`logger.*` call was found that includes any of the above
  fields.

**Verdict: no leaks found.**

## 5. File/image upload security

`src/app/api/uploads/device/route.ts` and `.../uploads/passport/route.ts`:

- Uploads are namespaced under `shops/{shopId}/devices/...` /
  `shops/{shopId}/passports/...`; the shopId used is the session's own
  (SHOP_ADMIN) or a validated one (SUPER_ADMIN).
- Signed-URL reads go through `isAuthorizedForKey(role, sessionShopId, key)`,
  which requires the key to start with the caller's own `shops/{shopId}/`
  prefix (or `SUPER_ADMIN`).
- MIME-type whitelist, image-signature validation, and a 5MB size cap are
  enforced before any file is accepted.
- The storage bucket is private (no public URL access); every read goes
  through the signed-URL endpoint.

**Verdict: no gaps found.**

## 6. Telegram security

`src/app/api/telegram/webhook/route.ts` validates the
`X-Telegram-Bot-Api-Secret-Token` header against `process.env.TELEGRAM_WEBHOOK_SECRET`
before processing any update, returning 401 on mismatch and 503 if the
secret isn't configured (fail-closed). The cron and internal-send routes
(`/api/cron/reminders`, `/api/telegram/send`) require
`hasValidInternalSecret()` (checks `INTERNAL_API_SECRET`, falling back to
`CRON_SECRET`).

**Verdict: no gaps found.**

## 7. Rate limiting / abuse protection — real, deferred gap

Login has the throttle described in §1. **No rate limiting exists on
payment-creation, import, or other mutation routes.** This is a genuine
gap, not fixed in this pass, for a specific reason: this app is deployed on
Vercel (serverless, multi-instance) with no Redis/Upstash or similar shared
store currently provisioned. An in-memory `Map`-based limiter (the same
technique used for login) would only rate-limit requests landing on the
*same* serverless instance — under real traffic distribution across
instances, it would give a false sense of protection while doing little.
Implementing this properly requires provisioning an external distributed
store, which is outside what this pass can safely add without a product/
infra decision. **Mitigating factors already in place:** every payment
route requires an `Idempotency-Key`, so even unlimited request volume
cannot double-apply a payment; every mutation is logged to the `Log` table
with the actor identity.

**Recommendation for a follow-up pass:** add Vercel's built-in Attack
Challenge Mode or Upstash `@upstash/ratelimit` once a Redis instance is
provisioned; apply to `/api/*/payment`, `/api/nasiya/import`,
`/api/import/customers`.

## 8. Input validation

Money fields across `addSalePaymentSchema`, `addNasiyaPaymentSchema`,
`importNasiyaSchema`, `createShopSchema`, `addDeviceSchema` were checked:
all reject negative/zero amounts appropriately (zero is only valid for a
nasiya schedule *deferral*, which involves no money). This was previously
untested — see `test-coverage-audit.md` for the tests added this pass.
IMEI/phone validation, string length caps, and image-URL scoping
(`addDeviceSchema` rejects arbitrary external image URLs) were already
covered by existing tests.

**Verdict: validation is solid; the one real gap was a missing test, now added.**

## 9. Dangerous operations — atomicity audit

Every status-changing operation that could race under concurrent requests
was checked for the atomic `updateMany({ where: { ..., status: X } })` +
`count !== 1 → 409` pattern:

| Operation | File | Race-safe? |
|---|---|---|
| Sell device | `devices/[id]/sell/route.ts` | Yes (pre-existing) |
| Create nasiya for device | `devices/[id]/nasiya/route.ts` | Yes (pre-existing) |
| Return device | `devices/[id]/return/route.ts` | Yes (pre-existing) |
| Restock device | `devices/[id]/restock/route.ts` | Yes (pre-existing) |
| Mark supplier payable paid | `olib-sotdim/[id]/pay/route.ts` | **Fixed this pass** — was a plain `update()` with only a pre-transaction check |

## Summary table

| Severity | Area | Issue | Fixed? |
|---|---|---|---|
| P2 | Rate limiting | No distributed rate limiting on payment/import routes | No — needs external infra (documented above) |
| P2 | Observability | ~20 routes use `console.error` instead of the structured logger | No — broad, mechanical change deferred to its own pass |
| P1 | Supplier payable atomicity | Mark-as-paid race condition | **Yes** (see business-logic-audit.md) |

No P0 security findings. Tenant isolation, authentication, and file/Telegram
security are all solid.
