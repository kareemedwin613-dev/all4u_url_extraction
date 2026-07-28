# Search strategy (v0.7.1)

## Before

No full-text search existed anywhere in the app. All search was `ilike '%term%'` (or, client-side, `.or()` chains of `ilike`) against short fields only: `company`/`job_title` (Applications, JD list, JD picker), `candidate_name`/`resume_name` (Resume list, Resume picker), `email`/`full_name` (Admin Users, Active Appliers picker). Nothing searched `job_descriptions.description_text` (up to 200,000 chars) or `resumes.resume_text` (up to 300,000 chars) — there was no slow large-column scan to fix; this is genuinely new search capability, not a query optimization.

## After

`job_descriptions` and `resumes` each gained a `search_vector tsvector` column, maintained by a `BEFORE INSERT OR UPDATE` trigger (not `GENERATED ALWAYS AS ... STORED` — the resumes expression, which folds the `skills` array in via `array_to_string`, failed Postgres's "generated column expression must be immutable" check on a real project with `42P17`; a trigger function has no such restriction, so both tables use the same working mechanism), with a GIN index:

- `job_descriptions.search_vector`: `company` + `job_title` (weight A) + `description_text` (weight B).
- `resumes.search_vector`: `candidate_name` + `resume_name` (weight A) + `skills` (weight B) + `resume_text` (weight C).

Every place that searched the now-indexed short fields was **switched, not extended** — the user explicitly chose full replacement over an additive OR, understanding the semantic change (word/lexeme matching via `websearch_to_tsquery`, not raw substring matching):

- Dashboard JD/Resume lists: `job-read-service.js`/`resume-read-service.js` now call Supabase JS's `.textSearch("search_vector", value, {type:"websearch", config:"english"})` instead of `applySearch`'s `ilike` `.or()` chain.
- `list_applications_v07`, `list_applications_cursor`: `jobs.search_vector @@ websearch_to_tsquery('english', p_search)` replaces the `company`/`job_title` `ilike` checks (the exact numeric Application-number match is untouched).
- `list_application_jobs`, `list_application_resumes` (the Application-creation pickers): same FTS switch against the same columns.

## What was deliberately left alone

- **`p_company`** (Applications list's dedicated company filter, separate from the free-text search box) stays `ilike` — it's a precise field filter, not a "search box," and wasn't part of the replace decision.
- **`profiles.email`/`full_name`** search (Admin Users, Active Appliers picker) stays `ilike`. This was an explicit scoping decision, not an oversight: identity fields are a materially worse fit for lexeme-based FTS (an admin typing a partial email domain or a name fragment expects substring matching, and `profiles` is a small table with no performance problem to solve). `admin_list_users_v2` and `list_active_appliers` are unchanged.

## Known UX change to watch for

`websearch_to_tsquery` does whole-word/lexeme matching, not substring matching — searching "kubernet" will **not** match "kubernetes" the way the old `ilike '%kubernet%'` did (FTS needs the full lexeme or a trailing wildcard, which `websearch_to_tsquery` doesn't add automatically). This is the expected, accepted trade-off of the "replace" choice; if partial-word-while-typing search turns out to matter in practice, the fix is a prefix-aware query construction (splitting the input and appending `:*` to the last term) rather than reverting to `ilike`.

## Verification status

The migration's pgTAP tests (`supabase/tests/v0_7_1_performance.sql`) confirm FTS finds a job by body text and returns nothing for an unmatched term, and that results stay scoped to the caller's authorization. Not verified: real-world relevance/ranking quality against production-shaped data, which requires a live database — see `load-testing.md`.
