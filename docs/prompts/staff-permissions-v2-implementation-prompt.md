# Staff Permissions V2 Implementation Prompt

You are working on Oryx Tech ERP. Implement the complete specification in
`docs/staff-permissions-v2-plan.md`. Treat that document as the acceptance
contract, not as optional guidance.

## Required result

Replace broad or owner-only staff permission behavior with independently
assignable, default-deny capabilities. Every enabled capability must have a
complete reachable workflow without requiring another staff capability. Every
disabled capability must remain unavailable through navigation, direct URLs,
API calls, support endpoints, exports, sync events, caches, and forged requests.

Telegram eligibility for a new staff account must default to false. Enabling it
does not bypass Telegram ID validation or `/start` verification. `NASIYA_CANCEL`
and `SALE_RETURN_REFUND` must be separate capabilities and must preserve refund
caps, immutable accounting records, idempotency, and audit reasons.

## Engineering requirements

1. Read the current catalog, Prisma models/migrations, route guards, staff UI,
   cache/sync policy, Telegram recipient policy, exports, tests, and release
   workflow before editing.
2. Keep one typed capability catalog as the application source of truth.
3. Add an additive, idempotent Prisma SQL migration for permission definitions
   and conservative legacy-grant mapping. Do not use `db push`, reset, truncate,
   destructive DDL, or business-data repair.
4. Keep owner access package-bounded. Staff access must be an exact saved grant.
5. Split broad commands and schemas where fields/actions have different
   capabilities. Never authorize a final mutation with a broad `any` check.
6. Build purpose-specific support endpoints/DTOs for standalone workflows.
7. Derive navigation and staff landing behavior from effective access.
8. Protect delegated staff management from self-escalation, owner mutation,
   cross-tenant IDs, sensitive-capability delegation, and legacy-code injection.
9. Increment authorization versions, revoke affected sessions, invalidate
   caches, and write immutable audit logs for access changes.
10. Preserve all existing financial, currency, idempotency, Telegram, CSV,
    upload, privacy, and tenant-integrity guarantees.

## UI requirements

- Present every capability in grouped, scannable sections.
- Use switches/checkboxes for binary permissions.
- Keep Telegram eligibility separate, visible, and off by default.
- Show package-disabled capabilities as unavailable rather than allowing a save
  that the API later rejects.
- Support optional presets only as form-fill helpers. Runtime access may not
  reference a preset.
- Require confirmation for sensitive grants and an audit reason for edits.
- Ensure mobile and desktop layouts have no overlap or horizontal overflow.

## Verification requirements

Add behavioral and integration tests, not only source guards. For every
capability, prove an only-that-capability principal can complete its workflow
and cannot access unrelated functionality. Include critical browser scenarios
listed in the specification, migration replay, legacy mapping, direct-route
denials, session revocation, cache/sync filtering, Telegram default-off and
verification, nasiya cancellation, return/refund caps, and idempotent retries.

Run all repository gates:

```text
npm run prisma:generate
npm run prisma:validate
npm run test
npm run test:integration
npm run typecheck
npm run lint
npm run build
git diff --check
```

Then run authenticated browser checks on desktop and mobile. Do not commit,
push, migrate production, or deploy if any required check fails.

## Production release

Use the repository's guarded artifact-first release process. Confirm the exact
commit has successful CI, inspect migration SQL, run read-only production
preflight, trigger `.github/workflows/release-production.yml` with the required
confirmation, verify the unaliased deployment health and commit, and promote
only after smoke checks pass. Never use Prisma `db push`, `migrate dev`, reset,
or destructive database commands against production.

The final report must list changed files, migration behavior, capability and UI
coverage, security controls, test results, exact commit, CI run, production
release run, production URL/health result, warnings, and manual owner QA.
