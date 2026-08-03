# Job-description read API

The React dashboard and Chrome extension use the NestJS API for the JD read domain. Every protected request carries the current Supabase access token. NestJS verifies the token and role, then creates a user-scoped Supabase client so PostgreSQL RLS remains active.

## Endpoints

- `GET /api/v1/job-descriptions` lists accessible JDs with bounded pagination, full-text search, allowlisted filters, and allowlisted sorting.
- `GET /api/v1/job-descriptions/:id` returns one accessible JD.
- `GET /api/v1/job-descriptions/count` returns an optional status-filtered count.
- `GET /api/v1/job-descriptions/recent` returns 1–20 recent JDs.
- `GET /api/v1/lookups/categories` returns active primary and subcategories.
- `GET /api/v1/lookups/industry-domains` returns active controlled industry domains.

Read endpoints require an active business-data role. Capture accepts Applying Manager, JD Finder, or Admin; lookup endpoints also accept JD Finder. Every endpoint returns the standard request ID and error shape. The browser no longer reads `job_descriptions`, `categories`, or `industry_domain_categories` directly for these workflows.

When the temporary Google Workspace mirror is enabled, ingestion commits Supabase first and then attempts one HMAC-signed Apps Script upsert. `data.workspaceSync` reports `SUCCEEDED`, `FAILED`, `PENDING`, or `DISABLED`. Failed delivery remains recorded for a safe retry when the same JD is saved again; it does not turn a valid Supabase save into an API failure.

No privileged Supabase key is used. Supabase Auth remains browser-facing for session creation and refresh.
