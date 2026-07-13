# Operational data retention

The daily operations cron performs bounded deletion of non-ledger operational
records. Each table deletes at most 10,000 rows per run so cleanup cannot turn
into an unbounded production transaction.

| Data | Retention | Eligible rows |
| --- | ---: | --- |
| Telegram notifications | 90 days | Only terminal `SENT` or `CANCELLED` rows |
| Operational events | 90 days | All expired operational telemetry |
| Authentication sessions | 30 days after closure | Expired or revoked sessions only |
| Business audit logs | 7 years | Audit rows older than the policy |
| Incremental change events | 7 days | Managed by the existing sync cleanup |

Financial contracts, receipts, payment rows, return events, refund allocations,
devices, customers, and supplier obligations are not part of operational
retention and are never deleted by this job.

## Request and network audit context

Every proxied request receives a server-controlled `x-request-id`. On Vercel it
reuses the platform `x-vercel-id`; locally it uses a generated UUID. Client
`x-request-id` values are overwritten. The ID is propagated to structured
runtime logs, `OpsEvent.requestId`, and every Prisma-created business
`Log.requestId`, including writes inside database transactions.

Raw client IP addresses are not persisted. For HTTP business logs the protected
Vercel network header is validated as an IP and converted to a one-way HMAC
fingerprint (`h1:…`) scoped by the deployment secret. This pseudonymous value is
stored in the legacy `Log.ipAddress` column so disputed actions from the same
network can be correlated without retaining the address itself. It follows the
same seven-year business-log retention policy. Rotating the secret deliberately
prevents correlation across the rotation boundary.

Authentication failure logs contain request ID, actor class, result, and the
pseudonymous network ID. They never contain the submitted login or password.
Operational events and runtime logs follow the 90-day operational retention
target unless a configured Vercel log drain has a separately approved policy.

The cleanup function is `cleanupRetainedOperationalData()` in
`src/lib/server/data-retention.ts`. Its row counts are recorded in the reminders
cron operations event so production cleanup remains observable.
