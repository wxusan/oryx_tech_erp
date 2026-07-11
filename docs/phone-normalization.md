# Phone normalization

New and edited Uzbekistan phone values are validated and stored as
`+998901234567`. The UI renders the same value as `+998 90 123 45 67`.

Existing records are deliberately not migrated by this change. The formatter
continues to display legacy local, digits-only, and already-formatted values
without modifying them. Search remains compatible with the existing
digits-only `normalizedPhone` column.

If a data cleanup is needed later, run it first against a database backup and
report malformed values and duplicate canonical numbers before updating any
rows. Backfill the display field and `normalizedPhone` together, resolve
duplicates manually, and deploy it as a reviewed migration or maintenance job
rather than a destructive bulk edit during a UI release.
