# Load testing (v0.7.1)

## Scripts

- `scripts/performance/generate-synthetic-data.mjs` — opt-in synthetic data generator. Refuses to run without `--confirm`, prints the target Supabase project URL host before writing anything, defaults to the spec's "Small" profile, tags every row it creates (`synthetic_batch` marker in a dedicated free-text field where available, or a recognizable name/email prefix where not) so it can be cleaned up with `--cleanup`.
- `scripts/performance/loadtest.mjs` — fires configurable-concurrency requests at the list RPCs (`list_applications_cursor`, `list_applications_v07`, `get_business_overview`, JD/Resume list reads) using the existing `@supabase/supabase-js` client (no new dependency) and reports p50/p95/p99 per query. Requires an explicit `--url`/`--key`/credentials file; never defaults to reading the app's own `.env.local`, so it can't accidentally fire at whatever project a developer happens to have configured.

Both scripts require real credentials for a project you choose and explicitly confirm — neither targets anything by default. **Do not point either script at production or a shared free-tier Supabase project without explicit approval**, per the spec's own requirement.

## Suggested profiles (from the spec, unchanged)

```text
Small:  10,000 JDs / 2,000 Resumes / 50,000 Applications / 200,000 history rows
Medium: 100,000 JDs / 10,000 Resumes / 500,000 Applications / 2,000,000 history rows
Large:  250,000 JDs / 25,000 Resumes / 1,000,000 Applications / 5,000,000 history rows (isolated project only)
```

## Performance test scenarios (spec Section 22) — status

| Scenario | Script/RPC coverage | Actually run in this session? |
|---|---|---|
| Applier queue (filter + sort + cursor navigation) | `list_applications_cursor` via `loadtest.mjs` | No — no live Supabase environment available here |
| Manager Application list (filter/sort) | `list_applications_v07` via `loadtest.mjs` | No |
| JD search | `.textSearch` via `loadtest.mjs` | No |
| Resume search | `.textSearch` via `loadtest.mjs` | No |
| Application detail | `get_application_detail` via `loadtest.mjs` | No |
| Bulk preview (100 JDs / 2,000 combinations) | `preview_bulk_applications` via `loadtest.mjs` | No |
| Dashboard summary | `get_business_overview` / `get_application_counts` via `loadtest.mjs` | No |

**None of the above were executed.** This environment has no Docker/Supabase CLI and no live project credentials, so I could not run `generate-synthetic-data.mjs`, `loadtest.mjs`, or `EXPLAIN (ANALYZE, BUFFERS)` against real data. Both scripts are written and ready to run; doing so — and recording real before/after numbers in the format below — is the concrete next step for whoever has access to a disposable Supabase project.

## Measurement template (spec Section 6.4 / 28)

```text
Query:
Dataset size:
Environment:
Before:
After:
Execution-plan notes:
```

No entries exist yet under this template — filling it in requires the run above. Do not treat the absence of numbers here as "acceptable," and do not fill in plausible-looking numbers without running the query — that would violate the one hard rule this whole milestone is built around.
