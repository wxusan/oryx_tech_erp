# Full business remediation report — 2026-07-12

## 1. Executive summary

This stacked branch implements multi-image Telegram delivery, structured storage, exact `Yangi`/`B/U` condition, two-slot IMEI identity, Tashkent calendar overdue rules, shared date and phone entry, Olib-sotdim currency presentation, and role-specific inactivity policy without replacing the incremental navigation cache.

## 2. Branch and release scope

Base: `codex/incremental-data-sync` at `998b882`. Implementation branch: `codex/full-business-remediation`. This scope requires three additive migrations and must not be merged to production before the protected release database/Vercel secrets are available.

## 3. Telegram images

The old resolver selected only `imageUrls[0]`. The new sender snapshots every ordered, deduplicated device key, signs every pending key independently, sends one image with `sendPhoto`, 2–10 with `sendMediaGroup`, and 11+ in chunks of ten with a final singleton photo. Only the first delivered media item receives a fitting caption; long text is sent once before captionless media.

## 4. Telegram retry and durability

`Notification.mediaKeys`, `mediaSentPositions`, `mediaSnapshotAt`, and `textSentAt` persist send progress. A failed later chunk retries only unsent positions. Device-create notification rows are now committed in the same database transaction as Device and Log; only queue draining remains in `after()`.

## 5. Telegram privacy and security

Every supported related type is resolved with both `id` and `shopId`. Only exact `shops/<same-shop>/devices/<object>` keys are signed. Passport/customer document keys are never selected. Telemetry records counts and errors, never signed URLs or message/private phone content.

## 6. Storage model

New authoritative fields are `storageAmount Decimal(10,2)` and `storageUnit GB|TB`. New writes dual-write the legacy `storage` display string for compatibility. Backfill parses only explicit values such as `256GB` or `1 TB`; bare values remain unclassified for manual review.

## 7. Device condition

`DeviceConditionCode.NEW|USED` maps exactly to visible labels `Yangi` and `B/U`. New standard and Olib-sotdim devices require a condition. Imported old nasiya requires the operator to classify the device; legacy values are mapped only on exact matches and are never guessed.

## 8. Two-slot IMEI identity

`DeviceImei` stores PRIMARY/SECONDARY slots with a shop/device composite FK. Active partial unique indexes prevent primary-primary, primary-secondary, secondary-primary, and secondary-secondary collisions within one shop while allowing other shops and reuse after device soft-delete. The legacy scalar `Device.imei` remains a primary compatibility mirror.

## 9. Device UI and cache integration

Create, edit, Olib-sotdim, old-nasiya import, list, mobile card, detail, condition filter, search, export, canonical list DTO and Telegram templates expose structured storage/condition/two IMEIs. Device edit returns the canonical list DTO and patches React Query immediately; cross-tab `/api/sync` remains authoritative.

## 10. Nasiya overdue rule

All shared schedule, contract, allocation, dashboard, report and banner calculations compare Tashkent calendar days. A payment due today stays due today through 23:59:59 Asia/Tashkent and becomes overdue at 00:00 tomorrow. The cron already used this rule and remains unchanged in principle.

## 11. Date input

All 14 native date controls now use the shared `DateInput`: visible `DD.MM.YYYY`, canonical external `YYYY-MM-DD`, numeric entry, strict Gregorian/leap-date validation, ISO/display paste support, and required progressive year prefix `2___ → 20__ → 202_ → 2026`. Client submissions no longer convert date-only input through local `Date`/UTC shifts.

## 12. Phone input and persistence

The UI caps input at `+998` + two operator digits + seven subscriber digits. Strict validation still rejects incomplete/overlong direct API input. `normalizePhone` now canonicalizes supported 9-digit local, leading-8 legacy, and 12-digit 998 forms into the same 12-digit uniqueness domain. Migration collisions are preserved and flagged for review instead of guessed.

## 13. Olib-sotdim currency

The screenshot defect was native USD passed to a formatter that assumed UZS, creating values such as `$0.42`. Review/list/payment UI now formats from the amount's actual currency into the selected display currency. `$500` purchase, `$800` sale, and `$300` margin remain those exact native USD values.

## 14. Session policy

Shop sessions no longer auto-logout for inactivity; explicit logout, server JWT expiry, session-version revocation, password/subscription invalidation remain active. Super-admin uses a ten-minute real-user inactivity deadline shared across tabs. Visibility/background synchronization checks expiry but does not count as activity.

## 15. Incremental cache and performance

No Redis was added. Mutations keep canonical DTO/query patching/change-event sync; no new broad `revalidatePath`, route refresh, or document reload was introduced. Telegram networking remains off the mutation response path. Structured indexed IMEI search and bounded notification concurrency are retained. Production authenticated latency was not measured in this local run.

## 16. Security review

Confirmed improvements: Telegram tenant ownership, cross-slot identity constraints, canonical phone uniqueness, strict input enums/lengths, and durable audit/notification transactions. Existing server authorization remains session/shop scoped. Admin ten-minute inactivity is client-coordinated UX; hard server-side idle enforcement would require a server activity record and is not claimed here.

## 17. Database verification

Migrations:

- `202607120002_notification_media_progress`: Telegram media snapshot/progress.
- `202607120003_device_specs_identity`: storage/condition enums, DeviceImei, partial indexes, tenant FK, soft-delete trigger and conservative legacy backfill.
- `202607120004_phone_canonicalization`: canonical phone backfill, collision review flag and rebuilt active unique index.

All 28 migrations applied successfully from empty PostgreSQL in a disposable local database.

## 18. Tests and quality gates

- Unit/guard suite: 1,279 passed, 17 todo, 1 intentionally skipped.
- PostgreSQL integration: 13 passed.
- TypeScript: passed.
- ESLint: passed.
- Prisma validate/generate: passed.
- Next.js production build: passed (51 static pages plus all dynamic/API routes).
- Browser: shop/admin login rendered at 320px with no horizontal overflow or console warnings.

## 19. Remaining risks and manual work

Run `scripts/sql/device-specs-phone-repair-diagnostics.sql` read-only and approve repairs separately for ambiguous storage, unknown condition, placeholder/invalid/colliding legacy IMEIs, and phone collisions. Authenticated live production flows, Telegram delivery against the real bot, and production query latency are not yet proven. Local production browser auth was blocked by localhost `AUTH_TRUST_HOST`, so no authenticated local mutation was claimed.

## 20. Production/deployment status

Code is not yet online merely because local gates pass. The protected production release workflow still requires `VERCEL_TOKEN`, `PRODUCTION_DATABASE_URL`, and `PRODUCTION_DIRECT_URL`. Do not run migrations from `vercel.json` build and do not merge this schema-dependent branch until artifact-first migration/release can run. Production data repair requires explicit approval after diagnostics.
