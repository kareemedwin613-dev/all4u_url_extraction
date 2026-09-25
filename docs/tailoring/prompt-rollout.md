# Configurable prompts: rollout and operations

## Current state (2026-09-24)

Milestones 3 and 4 are implemented locally. Milestone 5 local automated checks
pass; production rollout and live model/browser smoke checks are **not complete**.
No production writes or paid model calls were made during this implementation.

`npx supabase db push --dry-run` stopped with `LegacyDbPushMissingLocalError`.
Production has these migration versions that are missing from this branch:

```
202609221000
202609231000
202609231100
202609231200
202609231300
202609231400
202609231500
202609231600
```

Bring their original migration files into this branch from the authoritative
branch before pushing. Do **not** mark applied migrations reverted to bypass this
check. Reconcile code changes from those migrations too, then rerun verification.

## Deployment sequence

1. Reconcile the missing production migrations and branch changes. Run the tests
   below and repeat the migration dry run; inspect every proposed migration.
2. Pause new tailoring submissions during rollout and let current model calls
   finish. Update/restart every local worker from this revision. New workers accept
   legacy input `1.2` and configured input `1.3`; old workers cannot process `1.3`.
3. Apply migrations in order: `202609241000` (library), `202609241010`
   (job snapshots), `202609241020` (isolated tests). These are additive but change
   job creation behavior immediately. Use the normal migration command only after
   the dry run is clean. Do not enable only part of the new API/dashboard.
4. Deploy the API and dashboard from the same revision, then resume workers.
   API reads now include the new provenance columns, so database migrations must
   precede this deployment.
5. As a manager/admin, open **Tailoring Prompts**. Confirm Generic v1 exists.
   Save a draft, run its one-item test command, and inspect its result. Draft
   tests generate JSON previews only; they do not create PDFs or change applications.
6. Preview a JD with no override, a primary override, a subtype override, and
   multiple subtype tags. Confirm the highest-priority matching subtype wins.
7. Create one real tailoring job, then publish a newer version before running it.
   Confirm the queued job keeps its saved version and a subsequently created job
   uses the new version. Confirm the generated PDF and resume detail attribution.
8. Confirm appliers cannot access the editor/test creation and legacy jobs still
   show “Legacy — no saved prompt version.” Check two independent manager sessions
   for stale-edit/publication conflicts. Only then mark production rollout complete.

## Manager workflow

Select **Tailoring Prompts** → Generic/category/subtype tree node → edit → **Save
draft** → optional **Test saved draft** → **Publish**. Restoring a previous version
publishes a new version; it never rewrites history. Unsaved edits block publication
and warn on navigation. Draft tests use a saved draft revision and an application
still linked to an active original resume. Commands expire after two hours and use
the existing local Codex login and `apps/tailoring-worker/.env`; no Supabase private
key is needed. Keep test tickets private. Keep the test terminal open until complete.

Test commands run `npm --prefix apps/tailoring-worker run prompt:test -- ...`.
Their results are kept in isolated test records, not normal tailoring jobs. The
editor polls while open; its ticket is shown only when created. If the page is
closed, create another draft test to get a fresh command. The previous test is
retained and remains accessible by its test ID through the manager API.

## Compatibility and reproducibility

- Instructions are selected from the **JD**, not the resume's categories.
- Missing/archived/unpublished overrides fall back to primary, then Generic.
- New jobs atomically save input, selected body/version, exact composed prompt,
  compiler contract, and role-target reference date. Retries read that snapshot;
  publication and source text edits do not recompose it. Existing source eligibility
  checks still run. Personal/role/date rendering remains source-controlled.
- Prompt body publication metadata and the fixed compiler contract are separately
  versioned. Generic body v1 remains the original writing instructions; the compiler
  appends the non-editable JSON/role/skill rules after dashboard instructions.
- Compiler v3 (migration v3.117) adds `sourceResume.summary` and each role's
  `details` to the model context, and its fixed rules require content grounded in
  them (fewer bullets rather than invented ones). Earlier v2 snapshots stay frozen
  without source content; workers accept both. The output schema is unchanged.
- Authenticated, single-ticket, and batch inputs expose the same snapshot contract.
- Job/resume detail displays name/version. Full prompt/input text is not returned
  in ordinary listing metadata or written to terminal logs.
- Historical jobs are not backfilled. Their legacy prompt builder is unchanged.
- Do not downgrade workers while `1.3` jobs are pending. If an override is poor,
  restore/publish a known-good version for **new** jobs; existing queued snapshots
  intentionally remain unchanged. Avoid deleting history or snapshot records.
- Model, effort, concurrency, normal PDF generation, and application eligibility
  were not changed by these milestones.

## Local verification

```powershell
node --test --test-concurrency=1 tests/tailoring-prompt-library.test.js tests/tailoring-prompt-snapshots.test.js dashboard/tests/tailoring-prompts.test.js dashboard/tests/tailoring-prompts-editor.test.js dashboard/tests/router.test.js dashboard/tests/route-access.test.js
npm --prefix apps/tailoring-worker test
npm --prefix apps/tailoring-worker run typecheck
npm --prefix apps/tailoring-worker run build
npm --prefix apps/api run build
npm run build:dashboard
```

API targeted suite (run from `apps/api`):

```powershell
node --import tsx --test --test-concurrency=1 test/api-foundation.spec.ts test/api-integration.spec.ts test/tailoring-prompts.spec.ts test/automatic-tailoring-v34.spec.ts test/tailored-resume-renderer-v16.spec.ts test/tailored-resume-templates-v18.spec.ts test/tailored-resume-pdf-v19.spec.ts test/tailoring-selection-status-v32.spec.ts
```

PostgreSQL tests execute the new migrations in PGlite with minimal surrounding
schema/auth fixtures and the real preview validator. They cover duration bounds,
snapshots, fallback/priority, publication, retry stability, isolated test capability
expiry/revocation, permissions and immutability. Legacy claim/auth scaffolding is
stubbed; production RPC integration remains a deployment smoke check. The rendered
React editor test uses real hooks/API calls with stubbed visual widgets. It is not
a full-browser visual/accessibility test. PGlite does not prove independent-connection
race behavior. These limitations are why rollout is not marked complete yet.
