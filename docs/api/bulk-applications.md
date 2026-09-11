# Bulk Applications API

Both endpoints require a verified Supabase bearer token and an active `APPLYING_MANAGER` or `ADMIN` role. PostgreSQL revalidates authorization through the caller-scoped JWT.

`POST /api/v1/applications/bulk-preview` accepts `{ "jobDescriptionIds": ["uuid"], "resumeIds": ["uuid"], "matchingMode": "CATEGORY" }`. `resumeIds` and `matchingMode` are optional. It deduplicates at most 1,000 JD IDs, returns at most 5,000 pairs with explicit truncation metadata, and makes one read-only RPC. Its timeout is 10 seconds and rate limit is 120 requests per five minutes.

Preview failures distinguish `DATABASE_TIMEOUT`, `DATABASE_UNAVAILABLE`, and `DATABASE_MIGRATION_REQUIRED`; other database errors do not suggest missing migrations. API logs emit `bulk.preview.failed` with the request ID, RPC name, duration and database error code, without SQL or source content. The dashboard retries temporary read failures after 5, 10 and 20 seconds, marks retained counts as potentially stale, and clears the warning after recovery. Permanent errors require a manual refresh. These retries never enqueue scores or create Applications.

`POST /api/v1/applications/bulk-create` accepts an optional `batchName`, optional `matchingMode`, and 1–5,000 camel-case `{ jobDescriptionId, resumeId }` pairs in `combinations`. `Idempotency-Key` is required and must not be reused after changing the method. Database defaults remain authoritative: no assignee, `UNASSIGNED`, `NOT_APPLIED`, `NORMAL`, and `created_by = auth.uid()`. Its timeout is 30 seconds and rate limit is 10 requests per ten minutes.

Matching methods (v3.77):

- `SCORE` (default): shared primary category and a completed AI score meeting the configured threshold (currently 70); subcategories ignored.
- `CATEGORY`: previous category/subcategory rules, with no AI evaluation. Any shared primary qualifies; Software Engineering JDs with a subcategory additionally require that exact subcategory on a Resume tech stack. Other categories use primary-only matching.

Use the same method for preview and creation. PostgreSQL rechecks current eligibility on creation; category mode does not require a model, queue evaluations, or save a fake score. Active originals, approved/active JDs, banned companies, family duplicates and access rules still apply. New Applications/batches record `matching_mode`; existing history remains unchanged. Apply migration `202609111000_v3_77_application_matching_choice.sql` and deploy both API and dashboard before using the new option.
