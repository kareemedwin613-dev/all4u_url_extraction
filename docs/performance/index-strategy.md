# Index strategy (v0.7.1)

## What was already there

Before this migration, `applications`, `job_descriptions`, `resumes`, and both history tables already had single-column or composite indexes covering most access patterns from earlier v0.5–v0.7 migrations (`assigned_to`, `work_status`, `application_status`, `priority`, `due_at`, `created_at desc`, `updated_at desc` on `applications`; `category_id` on `job_descriptions`; `(user_id, primary_category_id, status)` and `(primary_category_id, status)` on `resumes`; `(application_id, created_at desc)` on both history tables). Re-adding equivalents of these would have been pure duplication, so the migration does not touch them.

## What changed

- **Added** `idx_applications_assignee_queue (assigned_to, work_status, updated_at desc, id desc)` — the actual shape of the Applier-queue query (`list_applications_v07`/`list_applications_cursor`'s `where assigned_to = auth.uid() and work_status = ? order by updated_at desc, id desc`), which no single existing single-column index covers as a composite.
- **Removed** `user_roles_user_id_idx` — confirmed redundant: `user_roles`'s primary key is the composite `(user_id, role_id)`, whose leading column already serves any `where user_id = ?` lookup. The standalone index only added write overhead (one more index to maintain on every role assignment/removal) with no read-path benefit. Evidence: `\d user_roles` in the pre-migration schema shows both the PK and the standalone index covering the identical leading column; no query in the codebase filters on `user_id` with an access pattern the PK doesn't already satisfy.
- **Added** `idx_job_descriptions_search` / `idx_resumes_search` — GIN indexes backing the new full-text search columns (see `search-strategy.md`).

## RLS policy performance — what was rewritten and what wasn't

Every `has_role(...)`, `has_any_role(...)`, `application_actor_can_manage()`, and `is_active_user(auth.uid())` call inside a policy's `USING`/`WITH CHECK` clause was wrapped in `(select ...)` on `job_descriptions`, `resumes`, `tailoring_jobs`, and the `original-resumes`/`application-screenshots` storage policies. This lets Postgres cache one evaluation per query (an InitPlan) instead of re-running the function — and its internal `user_roles`/`roles` join — once per row scanned. This is safe because every wrapped call's argument is constant for the duration of a query (a role-code literal, or `auth.uid()`, not a per-row column).

**Deliberately not rewritten:** `application_actor_can_view(<row's own assigned_to column>)` on `applications`, `application_status_history`, `application_assignment_history`, and `application_screenshots`. That function's argument varies per row, so `(select ...)` wrapping provides no real caching benefit there — and decomposing its internal logic into a form that *would* benefit was considered and rejected, because it can't be verified against a live database in this environment and a subtly wrong decomposition of an authorization check is a security bug, not a performance one. If this needs revisiting, it should be done with `EXPLAIN (ANALYZE, BUFFERS)` evidence from a real environment, not guessed.

## Verification status

Static review only (table/column/policy names re-checked against the actual current migration files before writing the rewrite, and the pgTAP suite in `supabase/tests/v0_7_1_performance.sql` asserts both index presence/absence and that authorization is unchanged) — **not run against a live Postgres instance** (no Docker/Supabase CLI available in this environment). Before deploying, run the pgTAP suite (`npx supabase test db`) and, ideally, `EXPLAIN (ANALYZE, BUFFERS)` the Applier-queue query before/after against a realistic dataset size using `scripts/performance/generate-synthetic-data.mjs`.
