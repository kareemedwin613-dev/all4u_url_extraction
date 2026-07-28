# Bulk Applications API

Both endpoints require a verified Supabase bearer token and an active `APPLYING_MANAGER` or `ADMIN` role. PostgreSQL revalidates authorization through the caller-scoped JWT.

`POST /api/v1/applications/bulk-preview` accepts `{ "jobDescriptionIds": ["uuid"] }`, deduplicates at most 100 IDs, and invokes `preview_bulk_applications` once without writing data. Its timeout is 10 seconds and rate limit is 30 requests per five minutes.

`POST /api/v1/applications/bulk-create` accepts an optional `batchName` and 1â€“2,000 camel-case `{ jobDescriptionId, resumeId }` pairs. `Idempotency-Key` is required. Database defaults remain authoritative: no assignee, `UNASSIGNED`, `NOT_APPLIED`, `NORMAL`, and `created_by = auth.uid()`. Its timeout is 30 seconds and rate limit is 10 requests per ten minutes.
