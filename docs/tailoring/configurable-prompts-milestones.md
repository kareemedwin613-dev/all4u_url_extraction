# Configurable tailoring prompts: milestones

## Scope and agreed behavior

- Dashboard tree view only: Generic, primary-category defaults, and subtype prompts.
- Managers/admins can edit drafts and publish; appliers cannot change prompts.
- Use the JD's primary category and all its subtype IDs, not the candidate's categories.
- Precedence: matching published subtype prompt, then published primary-category default,
  then published Generic. Among matching subtype prompts, higher priority wins.
- Priority does not allow a category default or Generic to outrank a subtype match.
- One published version per prompt; one active default per scope. Reject ambiguous
  priority ties within the same primary category before publication.
- Preserve the fixed JSON schema, role identity/order, renderer-owned personal/date
  fields, skill assembly, and formatting contract. Editing prose is not schema editing.
- Category prompts replace the generic editable body; do not concatenate prompts.
- Publishing creates an immutable version. Restoring an old version publishes a new
  version with that content, preserving history.
- Resolve and snapshot when a new tailoring job is created. Retries use that snapshot,
  even if the prompt is subsequently edited, archived, or republished.
- Historical jobs with no snapshot remain explicitly legacy; do not claim they used
  a newly published version. Their existing behavior must remain supported.
- No changes to model, reasoning, concurrency, PDFs, or existing eligibility rules.

## Milestone 1 — Prompt foundation

Status: complete locally (2026-09-24).

- Extract the existing writing instructions as immutable Generic v1.
- Separate worker-owned header/output instructions from that editable-body baseline.
- Keep the current worker on Generic v1; do not enable custom prompts yet.
- Add a pre-refactor SHA-256 regression check using the existing fixture and fixed date.

Acceptance: generated prompt is byte-for-byte unchanged; worker tests and typecheck pass.
No migration, dashboard setting, API change, or production write in this milestone.

## Milestone 2 — Versioned storage, management API, and selection

Status: complete locally (2026-09-24); migration not applied to production.

- Add prompt definitions and immutable published versions, plus draft editing.
- Store name, scope/category/subtype, priority, body, author, and timestamps.
- Seed Generic v1 from the milestone-1 baseline with a consistency test.
- Add manager/admin-authorized list, draft, publish, archive, history, and restore APIs.
- Validate active taxonomy relationships, default uniqueness, and priority conflicts.
- Prevent removing the last published Generic fallback.
- Implement selection and a read-only preview explaining the winning prompt/fallback.
- Serialize publication and reject stale edits to prevent accidental overwrites.

Acceptance: category fallback, multi-subtype priority, drafts/archives, permissions,
immutability, and concurrent publication are covered by database/API tests.

## Milestone 3 — Dashboard tree editor

Status: complete locally (2026-09-24); not deployed.

- Add Tailoring Prompts navigation for authorized managers/admins.
- Show Generic and primary-category branches, with subtypes nested beneath categories.
- Show Published/Draft, version, priority, and inherited/default prompt indicators.
- Select a node to open its editor and version history.
- Support draft save, publication, archive, restore-as-new-version, and unsaved-edit warning.
- Provide JD-based prompt selection preview. No list view in the initial release.

Acceptance: editors can manage the library entirely from the dashboard; appliers cannot
access management actions; fallback and tie errors are visible and understandable.

## Milestone 4 — Job snapshots and worker integration

Status: complete locally (2026-09-24); migrations not applied to production.

- Snapshot prompt ID/name/version, category selection, priority, exact instructions,
  and fixed-contract version atomically on new jobs (single and batch workflows).
- Pass the snapshot through API/ticket claims with explicit contract compatibility.
- The database composes and snapshots trusted configuration, fixed output instructions,
  and input at creation; workers use the exact saved text without recomposing it.
- Keep schema-critical skill limits and role/format requirements in the fixed contract;
  do not rely on editable instructions to preserve them.
- Store the exact composed prompt and role-target reference date for reproducibility;
  use protected job storage rather than terminal logs.
- Preserve the snapshot across restarts, retries, and queued work.
- Expose prompt name/version on tailoring detail and the resulting tailored-resume record.
- Add a one-item test flow using a draft without publishing it; record it as a test run.

Acceptance: publishing affects only new jobs, retries cannot silently change versions,
and older clients/jobs cannot silently ignore a category-specific configuration.

## Milestone 5 — End-to-end verification and rollout

Status: local automated verification complete; production rollout blocked by missing
local copies of eight already-applied production migrations. See [rollout notes](prompt-rollout.md).

- Test Generic, category default, one subtype, multiple subtypes, and missing/archived overrides.
- Test draft editing, publish/restore, queue/retry stability, and visible version attribution.
- Verify worker JSON, bullet formatting, grouped skills, and PDF output.
- Verify permissions and stale-edit/concurrent-publication handling.
- Apply migrations before enabling the dashboard/worker feature; document compatible versions.
- Verify deployed behavior before marking production rollout complete.

## Progress log

- 2026-09-24: Milestones recorded on `feat/tailoring-configurable`. Milestone 1 extracts
  the baseline only. Database storage, prompt selection, dashboard editing, and job
  snapshots are not implemented yet. Existing untracked artifacts are untouched.
- Milestone 1 verification: all 39 worker tests passed, including byte-for-byte prompt
  compatibility; worker typecheck and build passed. No model calls or production changes.
- 2026-09-24: Milestone 2 implemented with a seeded prompt library, immutable versions,
  audited mutations, role/RLS checks, optimistic edit revisions, serialized publication,
  priority/scope conflict indexes, and JD-based selection preview. See
  [API reference](prompt-library-api.md) for routes and payloads.
- Milestone 2 verification: 10 database tests, 50 API foundation/integration/prompt tests,
  and 39 worker tests passed. API build and worker typecheck passed. Full API typecheck
  still reports existing errors in `resume-banned-companies.spec.ts` and
  `resume-cover-letter.spec.ts`; no errors were reported in the new prompt files.
- No live model calls, production migration, or deployment performed. Milestone 3
  (dashboard tree editor) is next; workers still use their existing Generic v1 body.
- 2026-09-24, milestones 3-5 continuation: added the manager/admin tree editor,
  draft save/publish/archive/restore, selection preview, navigation protection,
  immutable creation-time prompt/input snapshots, legacy compatibility, version
  attribution on job and resume detail, and isolated one-item draft test commands.
- Local verification now covers the real rendered editor workflow (visual widgets
  stubbed), database snapshot/test-run lifecycle, worker input compatibility, and
  API authorization. Existing skill/PDF rendering tests still pass. No model,
  effort, concurrency, application eligibility, or rendering behavior was changed.
- Verification totals: 29 database/dashboard/route tests, 42 worker tests, and 65
  targeted API/rendering tests passed (136 total). API and dashboard builds, worker
  typecheck/build, diff whitespace check, and repository security scan passed.
  Dashboard build retains its existing large-chunk warning.
- Production migration dry run failed with `LegacyDbPushMissingLocalError`: eight
  production migration files are absent on this branch. No migration history was
  repaired and no production data was changed. Milestone 5 rollout remains open;
  follow [rollout and verification instructions](prompt-rollout.md).
