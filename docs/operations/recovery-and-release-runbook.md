# Recovery and artifact-first release runbook

This runbook defines the safety contract. It does not authorize a production
deployment, database repair, environment change or restore by itself.

## Required ownership and objectives

Before the next production release, the owner must record outside the repository:

- primary and backup incident commander;
- Supabase project and backup/PITR owner;
- Vercel project/release owner;
- approved RPO (maximum accepted data loss);
- approved RTO (maximum accepted recovery time);
- alert recipients and escalation path.

Suggested initial targets for approval are RPO <= 15 minutes when PITR is
available and RTO <= 2 hours. These are proposals, not verified guarantees.

## Staging restore drill

1. Select a timestamped production backup without exposing its credentials.
2. Restore it to an isolated staging database with outbound Telegram disabled.
3. Record source backup timestamp, restore start/end, database size and operator.
4. Run `scripts/sql/production-diagnostics.sql` in read-only mode.
5. Apply pending migrations with `prisma migrate deploy`.
6. Run PostgreSQL integration tests and authenticated browser smoke tests.
7. Re-run diagnostics and compare counts/invariants.
8. Delete the staging copy under the provider retention policy.

The drill fails if the restore is not usable within the approved RTO, if
diagnostics reveal new inconsistencies, or if any migration cannot be safely
forward-fixed.

## Artifact-first production release

The manually dispatched `release-production.yml` workflow requires the GitHub
`production` environment to have named reviewers and these secrets:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`;
- `PRODUCTION_DATABASE_URL`, `PRODUCTION_DIRECT_URL`.

The workflow deliberately:

1. builds an immutable Vercel production artifact before schema mutation;
2. applies only reviewed backward-compatible migrations;
3. promotes that exact prebuilt artifact.

`vercel.json` must never run a migration as part of `buildCommand`. A build can
fail after an already-successful database mutation, leaving the previous app on
the new schema.

## Pre-release gate

- CI green on the exact commit.
- Preview browser flows approved.
- Migration classified and rehearsed on a restored staging copy.
- Backup/PITR status confirmed immediately before the release.
- Migration is backward-compatible with the currently deployed version.
- Forward-fix and stop conditions documented.
- No unapproved historic data repair bundled into the schema release.

## Post-release smoke gate

Verify without creating real financial activity unless a dedicated test shop is
approved:

- `/api/health` commit and database status;
- admin and shop login/logout;
- tenant-scoped list reads;
- dedicated-test-shop sale/payment/return flows when authorized;
- cron authentication and latest completion event;
- notification queue count/oldest age;
- 5xx/error logs and database connection health.

If the smoke gate fails, stop traffic-changing work. Prefer a forward fix when a
migration has already committed. Re-pointing Vercel to an older artifact is safe
only when the migrated schema remains backward-compatible with it.

## Notification recovery

- Never edit `SENT` rows to replay them.
- Inspect `FAILED`/`CANCELLED`, attempt count, dedupe key and last error.
- Fix the provider/configuration cause first.
- A replay tool must create a new auditable notification referencing the old ID
  and require an explicit operator reason.
- Alert on oldest pending age, not only queue count.

## Historic data repair

Every repair requires:

1. read-only detection query and exported candidate IDs;
2. restored-staging rehearsal;
3. accounting/product approval when money or status is affected;
4. restorable backup;
5. transaction with before/after audit rows;
6. stop conditions and row-count cap;
7. post-repair diagnostics and cache invalidation;
8. archived operator, commit, timestamp and result.

Existing targeted plans remain authoritative for device and nasiya status:

- `docs/device-status-repair-plan.md`
- `docs/nasiya-contract-status-repair-plan.md`
