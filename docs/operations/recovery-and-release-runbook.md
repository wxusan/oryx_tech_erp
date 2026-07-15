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

## Guarded artifact-first production release

The manually dispatched `release-production.yml` workflow requires the GitHub
`production` environment to have named reviewers and these secrets:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

`vercel pull --environment=production` copies production variables into the
ephemeral Actions runner so the remote deployment can be linked correctly.
They must never be printed, uploaded as artifacts, cached, or committed; the
workflow does not copy them into explicit GitHub secrets or command output.

The workflow refuses any ref other than the exact current `main` SHA and
requires a successful `push`-event `CI` run on `main` for that exact SHA. It
passes a build-only release marker that `scripts/vercel-build.mjs` requires in
production, while `vercel.json` disables automatic Git deployment for `main`
without disabling branch previews. The marker is a defense in depth against
accidental automatic production builds, but is not an
authorization boundary. Vercel production access/scoped tokens and GitHub's
named environment reviewers remain the authorization controls. The guarded
deployment is created without the production domain, inspected, and probed
through authenticated `vercel curl`; the response must prove database health
and the exact short commit. The workflow rechecks remote `main` immediately
before promoting the artifact.

The workflow starts a remote Vercel production build. Its guarded builder
deliberately:

1. builds the application artifact before schema mutation;
2. runs `scripts/production-release-preflight.mjs --phase=pre` using count-only,
   read-only queries and aborts on a migration-blocking identity conflict;
3. applies only reviewed backward-compatible migrations;
4. runs the explicitly approved payment-profit backfill after migration; the
   script preserves original financial/audit rows and reports ambiguous history
   as reconstruction gaps;
5. runs the post-migration preflight and proves every release migration is
   recorded, subscription-payment currency snapshots are not pending, native
   snapshots exist, and the legacy write-off permission is inactive;
6. publishes the artifact created in step 1.

`vercel.json` must keep `node scripts/vercel-build.mjs` as its `buildCommand`.
Replacing it with bare `next build`, `npm run build`, or an unguarded migration
command bypasses this ordering. No preflight query may print row contents or
perform a repair.

## Pre-release gate

- CI green on the exact commit.
- Preview browser flows approved.
- Migration classified and rehearsed on a restored staging copy.
- Backup/PITR status confirmed immediately before the release.
- Migration is backward-compatible with the currently deployed version.
- Production preflight reports zero blocking issues.
- Forward-fix and stop conditions documented.
- No unapproved historic data repair bundled into the schema release. The
  payment-profit reconstruction is approved only for the release documented in
  `docs/accounting/monthly-profit-recognition.md`; every other repair remains separate.

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
