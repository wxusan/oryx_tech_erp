# Staff Permissions V2

Status: implementation specification

## 1. Outcome

The shop owner can create or edit a staff account and independently enable only
the work that person may perform. An enabled capability must have a reachable,
complete workflow. A disabled capability must not leak navigation, controls,
API access, cached data, exports, notifications, or indirect access through a
different workflow.

Presets may select an initial group of capabilities, but runtime authorization
must use only the saved capability grants. No role preset or other staff
capability may implicitly grant access.

## 2. Non-negotiable invariants

1. Default deny: a new staff account starts with no capabilities.
2. Telegram notifications start disabled for every new staff account.
3. Effective access is the intersection of an active shop package feature and
   the exact staff capability. Package availability is not another staff
   permission.
4. A staff capability never requires another staff capability.
5. A mutation capability owns the narrow support reads required to finish its
   workflow. Those reads do not expose the corresponding full list or detail
   module.
6. UI visibility is not authorization. Every server route enforces live access.
7. Permission changes increment permission/session versions, revoke active
   sessions when required, invalidate authorization caches, and are audited.
8. Tenant scope is resolved from the authenticated staff principal. Staff input
   never selects another shop.
9. Sensitive fields use explicit response projections. Data is never fetched
   broadly and hidden only in the browser.
10. Business-state rules remain authoritative. For example, permission to
    cancel a nasiya does not make a completed or otherwise ineligible contract
    cancellable.

## 3. Capability catalog

Every row below is independently owner-assignable. The code is stable and is
used by the database grant, server guard, UI, audit log, sync policy, and tests.

### Devices and inventory

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `INVENTORY_VIEW` | View devices | Browse and open inventory with the staff-safe projection. |
| `DEVICE_CREATE` | Add devices | Open the add-device workflow, upload device images, and create a device. |
| `DEVICE_EDIT` | Edit devices | Find one device through a limited selector and edit eligible fields. |
| `DEVICE_DELETE` | Delete unsold devices | Find and soft-delete an eligible unsold device with a reason. |
| `DEVICE_RESTOCK` | Return device to inventory | Restock an eligible returned device with a reason. |

### Sales and receivables

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `SALE_VIEW` | View sales | Browse and open staff-safe cash/debt sale records. |
| `SALE_CREATE` | Create sale | Select an in-stock device and customer through limited pickers and sell it. |
| `SALE_EDIT` | Edit sale | Find and edit eligible sale/customer/reminder fields. |
| `SALE_PAYMENT_RECEIVE` | Receive sale payment | Find an unpaid sale and record an incoming payment. |
| `SALE_REMINDER_MANAGE` | Manage sale reminders | Enable, disable, or reschedule an eligible sale reminder. |
| `SALE_RETURN_REFUND` | Return and refund sale | Return an eligible cash/debt sale and refund no more than collected money. |
| `RECEIVABLES_VIEW` | View due and overdue queue | View the staff-safe due/overdue queue without payment authority. |

### Nasiya

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `NASIYA_VIEW` | View nasiyas | Browse and open staff-safe nasiya contracts. |
| `NASIYA_CREATE` | Create nasiya | Select limited device/customer data and create a nasiya contract. |
| `NASIYA_EDIT` | Edit nasiya | Edit eligible identity, note, and contract-management fields. |
| `NASIYA_PAYMENT_RECEIVE` | Receive nasiya payment | Find an eligible schedule and record an incoming payment. |
| `NASIYA_DEFER` | Defer nasiya payment | Move one eligible schedule date through the idempotent defer workflow. |
| `NASIYA_REMINDER_MANAGE` | Manage nasiya reminders | Enable or disable reminders for an eligible contract. |
| `NASIYA_CANCEL` | Cancel nasiya | Cancel and return an eligible nasiya using the safe return/refund ledger. |
| `NASIYA_ARCHIVE` | Archive nasiya | Archive an eligible contract with a reason. |
| `NASIYA_WRITE_OFF` | Retired legacy permission | Inactive and retained only so historical grants/events remain auditable; new write-offs are not supported. |
| `NASIYA_REOPEN` | Reopen nasiya | Reopen an eligible archived/written-off contract with a reason. |

### Olib-sotdim

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `OLIB_VIEW` | View olib-sotdim | Browse staff-safe supplier/customer deal records. |
| `OLIB_CREATE` | Create olib-sotdim | Complete the device, supplier, customer, and sale workflow. |
| `SUPPLIER_PAYMENT_MARK_PAID` | Mark supplier payment paid | Record an outgoing supplier settlement. |

Incoming customer payments and outgoing supplier settlements must never share
one permission.

### Customers and private documents

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `CUSTOMER_VIEW` | View customers | Browse and open the staff-safe customer profile. |
| `CUSTOMER_CREATE` | Add customers | Create a standalone customer record. |
| `CUSTOMER_EDIT` | Edit customers | Edit basic customer identity and contact fields. |
| `CUSTOMER_PASSPORT_PHOTO_VIEW` | View passport photo | View a private signed passport image for one selected customer. |
| `CUSTOMER_PASSPORT_REVEAL` | Reveal passport number | Reveal the decrypted identifier through an audited action. |
| `CUSTOMER_PASSPORT_MANAGE` | Manage passport information | Add, replace, or remove passport identifier/photo data. |
| `CUSTOMER_TRUST_OVERRIDE` | Change trust level | Set or clear the manual trust override. |

### Statistics, reports, and logs

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `DASHBOARD_OPERATIONAL_VIEW` | View operational statistics | See non-financial counts, workflow state, and staff-safe operational summaries. |
| `DASHBOARD_FINANCIAL_VIEW` | View financial statistics | See cash flow, profit, cost, refunds, and financial dashboard totals. |
| `REPORT_VIEW` | View historical reports | Use month/range/admin filters and view report charts and totals. |
| `LOG_VIEW` | View activity logs | Browse audited staff-safe log projections and links. |

Financial dashboard access does not imply inventory, customer, sale, nasiya,
report, export, or log access.

### Import and export

| Code | Owner-facing label |
| --- | --- |
| `IMPORT_CUSTOMERS` | Import customers |
| `IMPORT_OLD_NASIYA` | Import old nasiyas |
| `EXPORT_DEVICES` | Export devices |
| `EXPORT_CUSTOMERS` | Export customers |
| `EXPORT_SALES` | Export sales |
| `EXPORT_NASIYA` | Export nasiyas |
| `EXPORT_OLIB` | Export olib-sotdim |
| `EXPORT_RETURNS` | Export returns/refunds |
| `EXPORT_LOGS` | Export logs |
| `EXPORT_REPORTS` | Export reports |

Each export has a fixed, reviewed column contract and works from a dedicated
export center. Export access does not require access to the corresponding UI
list. Every exported cell continues to use the formula-safe CSV/XLSX pipeline.

### Staff administration

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `STAFF_VIEW` | View workers | Browse the non-owner staff roster. |
| `STAFF_CREATE` | Add worker | Create an active or inactive worker with zero capabilities. |
| `STAFF_EDIT_PROFILE` | Edit worker information | Edit staff name and phone. |
| `STAFF_RESET_PASSWORD` | Reset worker password | Set a new password and revoke sessions. |
| `STAFF_STATUS_MANAGE` | Activate/deactivate worker | Change worker status and revoke sessions when disabling. |
| `STAFF_DELETE` | Delete worker | Soft-delete a worker with a reason and revoke sessions. |
| `STAFF_PERMISSION_MANAGE` | Manage worker permissions | Assign only routine capabilities to another worker. |
| `STAFF_NOTIFICATION_MANAGE` | Manage worker notifications | Enable/disable that worker's Telegram eligibility. |

A delegated staff manager cannot target the owner, target themselves for
permissions/status/deletion, grant administrative or sensitive capabilities,
or grant `STAFF_PERMISSION_MANAGE` to anyone. Only the owner may grant every
capability in the catalog.

### Shop settings

| Code | Owner-facing label | Complete allowed outcome |
| --- | --- | --- |
| `SHOP_PROFILE_EDIT` | Edit shop information | Edit public shop identity/contact fields. |
| `SHOP_CURRENCY_MANAGE` | Change shop currency | Change preferred display currency under existing rate rules. |
| `SHOP_TELEGRAM_MANAGE` | Manage shop Telegram | Change the shop-wide notification master switch. |

### Per-member Telegram eligibility

`telegramNotificationsEnabled` remains an explicit per-member boolean rather
than a route permission. It is `false` by default. When false, the staff member
is not an eligible recipient and cannot receive messages. When true, delivery
still requires the Telegram package feature, the shop master switch, an active
member, a valid Telegram ID, and `/start` verification. The setting grants no
application capability.

## 4. Things that are not staff capabilities

- Shop ownership transfer.
- Subscription, package, or billing management.
- Shop deletion or global shop activation status.
- Owner account recovery/security.
- Super-admin functions.
- Personal password change, logout, and session management, which remain
  available to the authenticated member.
- Internal support mechanics such as uploads, signed URLs, search indexes,
  pickers, cache synchronization, and notification queue processing.

## 5. Authorization architecture

### Authoritative catalog

The TypeScript catalog is the source for capability metadata:

- stable code;
- Uzbek label and description;
- group and order;
- package feature requirement;
- risk class: routine, financial, private, destructive, or administrative;
- owner-assignable flag;
- staff-manager-delegable flag;
- navigation/workspace association;
- sync/cache domains.

`PermissionDefinition` stores stable database definitions and foreign-key
targets. Startup and tests assert that code and migration definitions match.

### Server enforcement

- Every API method declares one exact operation capability.
- Shared entity-dependent routes authorize the exact operation after loading a
  tenant-scoped target. An `any` guard may enter the route but may not authorize
  the final mutation.
- Support endpoints accept a typed purpose and map it to one action capability.
- DTOs are purpose-specific. A sale picker cannot return inventory cost or
  supplier data; a payment context cannot return unrelated customer history.
- Owner access remains package-bounded and implicit. Staff access is an exact
  saved grant, never inferred from another grant.

### Client enforcement

- Navigation, cards, buttons, dialogs, and links use the same catalog codes.
- The initial staff landing page selects the first reachable workspace.
- A staff account with no capabilities sees a neutral no-access state and
  personal security settings, not a broken or empty workflow.
- Client checks improve UX only. A forged request is still denied by the server.

### Caching and revocation

- Existing authorization and permission versions remain in query/cache keys.
- Every permission change increments the target permission version and shop
  authorization version.
- Active sessions for the target are revoked after permission, password,
  status, or Telegram-eligibility changes.
- Sync domains are filtered by effective capability. Events never carry data
  from a disabled domain into a staff cache.

## 6. Data migration

The migration is additive and backward-compatible:

1. Insert every new `PermissionDefinition` with `ON CONFLICT DO NOTHING`.
2. Map legacy grants to the equivalent new grants inside one transaction.
3. Mapping never crosses a disabled package feature.
4. Existing broad `PAYMENT_RECEIVE` maps separately to enabled sale payment,
   nasiya payment, and supplier settlement capabilities because that is the
   access it already represented.
5. Existing owner-only grants cannot exist for staff; the migration does not
   create new sensitive staff access.
6. Legacy full-access workers receive only the routine operational capabilities
   they currently possess, never new financial/private/administrative powers.
7. Old permission definitions remain temporarily for backward compatibility but
   disappear from the staff UI and cannot be newly assigned.
8. Increment permission/authorization versions and revoke affected sessions.

The SQL must not drop tables, delete business rows, change money/status data, or
reset the database. A later cleanup migration may retire unused legacy codes
only after production evidence shows no remaining grants.

## 7. UI and UX

- Use grouped sections: Devices, Sales, Nasiya, Olib-sotdim, Customers, Stats,
  Data transfer, Staff, and Settings.
- Use switches/checkboxes for binary grants and a separate active-account switch.
- Telegram eligibility is visibly separate and defaults off.
- Sensitive capabilities show a compact risk label and require owner confirmation.
- Presets are optional helpers: Cashier, Inventory worker, Nasiya collector,
  Supervisor, and Accountant. Applying a preset merely changes switches.
- Package-disabled capabilities show `Unavailable in current package`; they are
  not displayed as enabled and cannot cause a server validation surprise.
- Editing an existing worker shows the effective saved capabilities, not legacy
  aliases or hidden implied grants.
- Save is atomic and requires an audit reason for existing-worker changes.
- The UI summarizes the exact number of enabled capabilities and Telegram state.
- Responsive layouts must avoid nested cards, overflow, and inaccessible toggle
  labels at 390, 768, 1024, and 1440 pixel widths.

## 8. Security and abuse controls

- Deny unknown/retired capability codes at schema and database boundaries.
- Use strict command schemas so one endpoint cannot accept fields controlled by
  a different capability.
- Re-check target shop, target member, owner identity, package, and grant policy
  inside the same serializable transaction used for a permission mutation.
- Prevent self-escalation, owner mutation, cross-tenant target IDs, mass
  assignment, and hidden legacy-code submission.
- Rate-limit authentication, password reset, passport reveal, export, and
  high-impact financial actions.
- Require idempotency for payments, deferrals, returns/refunds, cancellations,
  imports, and other replay-sensitive commands.
- Require reasons and immutable logs for cancellation, refund, write-off,
  reopen, delete, password reset, status, and permission changes.
- Preserve existing money, refund-cap, upload, CSV-injection, Telegram identity,
  and tenant-isolation controls.

## 9. Testing proof

### Catalog and migration

- Code/SQL catalog parity.
- Unique stable codes and complete metadata.
- Legacy-to-v2 mapping tests for every old permission.
- Migration replay on a fresh database and on a legacy fixture.
- No grant broadening and no business-row changes.

### Capability isolation

For every capability `C`, create a staff principal with only `C` and prove:

1. Its navigation/workspace is reachable.
2. Its support data is sufficient and contains no unrelated fields.
3. Its allowed server operation succeeds for an eligible fixture.
4. Every unrelated server operation returns 403/404 as designed.
5. Direct URLs, forged requests, exports, and sync do not bypass the denial.
6. Turning `C` off revokes the next request and removes cached domain data.

Critical standalone browser scenarios include sale creation without inventory
view, nasiya creation without customer/inventory view, payment without nasiya
view, defer without nasiya management, report-only staff, export-only staff,
staff-creator-only staff, and Telegram-only eligibility.

### Business behavior

- Cancel nasiya uses the safe return/refund ledger and exact collected-money cap.
- Sale return/refund cannot exceed collected money and permits zero refund.
- Payment, defer, cancellation, return, and import retries are idempotent.
- Supplier settlement is never authorized by an incoming-payment capability.
- Nasiya archive/write-off/reopen each require their own capability.
- Telegram stays silent before `/start`, while disabled, or after revocation.

### Quality gates

- Prisma generate and validate.
- Unit and source-guard tests.
- PostgreSQL integration tests.
- Typecheck, lint, production build, and `git diff --check`.
- Authenticated Playwright checks at desktop/mobile sizes with no console errors.
- Production health proves database connectivity and exact deployed commit.

## 10. Release and rollback

1. Implement behind the backward-compatible catalog/migration contract.
2. Rehearse migrations against disposable PostgreSQL and a restored staging
   snapshot when available.
3. Run production preflight read-only diagnostics.
4. Merge/push only after all local checks pass.
5. Require successful CI for the exact `main` commit.
6. Use the guarded GitHub `Release production` workflow. It builds first,
   migrates second, verifies an unaliased deployment, and promotes last.
7. Smoke owner login, restricted staff login, permission revocation, Telegram
   eligibility, reports, cancellation/refund denial, and `/api/health`.
8. If deployment fails before migration, do not promote. If migration succeeds
   and application smoke fails, use a forward fix; do not reset production.

## 11. Definition of done

- Every catalog capability is independently usable with no other staff grant.
- Every disabled capability is inaccessible through UI, API, export, sync, or
  indirect support endpoints.
- Telegram is off by default and is still verification-gated when enabled.
- Nasiya cancellation and sale return/refund are separately assignable.
- Staff creation and staff permission management are separately assignable.
- Stats/report access is owner-assignable and does not leak other modules.
- All automated, integration, browser, migration, CI, production health, and
  manual smoke gates pass for the exact deployed commit.
