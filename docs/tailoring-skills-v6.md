# Complete skills: contract v6

## Behavior

- Original skills come from `structured_content.skills`. If that field is missing/null, use the Skills section in extracted `resume_text`. An explicitly empty structured section stays empty. Old tags are a last resort only when neither section is recoverable; there is no whole-document keyword scan in this authoritative read.
- A database trigger synchronizes `resumes.skills` on original-resume inserts and updates to the section, extracted text, or tags. Migration 132 repairs active originals only. Archived originals, tailored copies, files, and frozen job snapshots are not rewritten. Editing metadata cannot replace a structured section with stale tags.
- Parsing preserves custom skills and methods, removes category labels, splits explicit delimiters and unambiguous whitespace-only technology lists, and deduplicates without ranking or capping the source. Ambiguous phrases remain intact. The original raw section is also included in model input.
- New snapshots use input version `1.4`, prompt contract `6`, and `sourceResume.skillsSection`. User-authored prompt versions and instructions are unchanged. Contract v6 overrides the old additions-only wording.
- The model returns the **complete ranked skills section**, maximum 80, including relevant fundamentals, methods, practices, and domain capabilities. There is no quota to fill, source/JD union, or literal-text filter after generation. The fixed prompt still asks for relevant, supported skills, not every keyword indiscriminately.
- Worker and API use the same category rules, including Research & Analytics. PDF rendering keeps the same maximum 80 instead of silently stopping at 30. Groups paginate without empty trailing pages.
- v2–v5 job snapshots continue using their original generation behavior. Retrying an old job does **not** upgrade its snapshot. Use an application with no previous tailoring job, or an isolated prompt test, to verify v6. Do not remove immutable history to force an upgrade.

## Deployment order

1. Update all local tailoring-worker checkouts and install their dependencies. Stop older worker runs before creating v6 jobs.
2. Deploy the updated API/dashboard.
3. Verify which Supabase project is linked. Run `npx supabase db push --dry-run` and review the migration list, then `npx supabase db push` against the intended environment.
   - `202609282100_v3_131_restore_tailoring_contract_v5.sql`: recovery for the earlier duplicate migration timestamp.
   - `202609282200_v3_132_complete_resume_skills.sql`: authoritative skills, tag synchronization/backfill, and v6 compiler.
   - `202609282300_v3_133_unique_tailoring_artifact_paths.sql`: attempt-scoped PDF paths to avoid conflicts with retained archived artifacts.
4. Create a fresh job or prompt test. Confirm contract `6` and the complete source skills in its new snapshot. Existing prompt-library version numbers need not be changed.

Migration 132 needs no new resume columns. Migration 133 adds `tailoring_jobs.materialization_storage_path` to authorize/finalize the exact new upload path, while allowing null for attempts already in flight. It adds no anonymous read permission. Old PDFs are retained. The API never deletes/overwrites an archived PDF to make room and logs the underlying Storage error server-side. Failed or response-lost uploads can leave orphan objects for a separately audited cleanup; they are not deleted automatically.

## Repeatable isolated verification

```powershell
npm run build:api
npm run build:tailoring
node scripts/verify-tailoring-skills.mjs
# Optional real model call; uses the same worker defaults or local overrides.
node --env-file-if-exists=apps/tailoring-worker/.env scripts/verify-tailoring-skills.mjs --live
```

The script creates a fresh job in an in-memory PostgreSQL database using the real snapshot trigger and compiler. Only synthetic source/JD data is used. `--live` runs the real worker and checks that every generated skill appears in every one of the six PDFs, with no blank pages. Artifacts are saved under `apps/tailoring-worker/artifacts/skills-v6-<job-id>/`. It does not connect to Supabase or attach a test resume to any production application.

Verified locally: 36 original skills -> 36 ranked skills in four groups, one model attempt; all six PDFs retained all skills on one page. Regression tests also cover 80-skill PDFs, frozen older contracts, tag synchronization, and upload-path authorization/finalization.

The capture-permission regression test now includes the banned-company guard. Separate API test typechecking still reports existing implicit/unknown types in `resume-banned-companies.spec.ts` and `resume-cover-letter.spec.ts`. Production API/worker builds and the API runtime test suite pass.
