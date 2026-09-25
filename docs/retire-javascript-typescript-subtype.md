# Retire JavaScript / TypeScript Engineering

Prepared migration: `202609241040_v3_115_retire_javascript_typescript_subtype.sql`.
Status: applied to the linked database on 2026-09-24 after the migration-history
audit/repair. The final migration dry run reports the database is up to date.

The preflight found 83 JD junction assignments and 25 tagged active original
resumes. The category itself is retained with `active=false`. Its JD/resume
taxonomy assignments are removed, with recovery copies in the manager-readable
`retired_taxonomy_assignments` table. Legacy subtype columns are synchronized to
a remaining subtype or NULL. A resume's primary category is preserved.

JavaScript/TypeScript skill text, resume content, existing applications and their
statuses are not changed. Existing tailoring snapshots and published prompt history
are not rewritten. Lookup and AI classification feeds already use active taxonomy.
Cached extension lookup lists can take 30 minutes to refresh; stale assignment
submissions are rejected by existing active-category validators.

Affected JDs receive `subcategory_match_required=true`. When no subtype remains,
they are excluded from new applications rather than falling back to every resume
in Software Engineering. Adding another valid subtype restores their normal matching.
The installed category gate and legacy bulk helper receive this narrowly scoped
check; unrelated untagged JDs keep their existing matching behavior. Other matching
rules, function security modes and grants remain unchanged.

## Verification

```powershell
node --test --test-concurrency=1 tests/retire-javascript-typescript-subtype.test.js
npx supabase db query --linked --file scripts/sql/inspect-javascript-typescript-retirement.sql
npx supabase db push --dry-run
```

Six PostgreSQL-backed checks passed, covering cleanup/recovery records, preserved
skills and applications, primary-category preservation, matching before/after
retagging, stale client rejection, and audit-table permissions.

## Resolved deployment blocker

The migration dry run reports `LegacyDbPushMissingRemoteError` and asks to replay
12 older local migrations dated September 20-23. Some corresponding behavior is
already present in the database, including the retired evaluation and application-
scoped blocking functions. Do not run `--include-all` blindly: that list includes
the earlier JD-wide sibling-blocking migration. Audit/reconcile the missing history
with the authoritative deployment records first; do not mark migrations applied
solely because one function appears present. No history repairs or production
changes were made during the initial retirement task.

In the subsequent authorized repair, the existing review schema, keys/indexes,
RLS/grants, active subtype, and whitespace-normalized function bodies were audited.
Six already-present/superseded migration entries (202609231000 through 202609231500)
were marked applied. The missing v110 was then applied, followed by v115 and a new
v116 restoring the priority/due-date fix overwritten by the older replay. No review
tables were dropped. `scripts/sql/audit-september-migration-state.sql` and
`scripts/sql/verify-september-migration-repair.sql` document the checks.

Important: before this repair, the user's older v106 replay recorded 8,941
`CANCELLED` → `BLOCKED` application transitions at 2026-09-24 20:01:18 UTC. This repair
does not reverse those historical row changes. Any recovery must be separately
authorized and protect applications updated since that timestamp. New JD-wide
cascades are disabled, and the priority/due-date preservation checks pass.

Post-deployment verification can be repeated with:

```powershell
npx supabase db query --linked --file scripts/sql/verify-javascript-typescript-retirement.sql
```

Verified: `active=false`, zero remaining subtype assignments, 3,840 recovery
records, and both matching retirement guards enabled. There were 83 affected JDs;
19 have no remaining subtype and are excluded until retagged. The post-deployment
check uses function-definition guards rather than an expensive production-wide
JD/resume Cartesian matching query. Removed taxonomy assignments can
be reconstructed from the recovery table if an explicit rollback is requested;
do not overwrite subsequent human/AI retagging when doing so.
