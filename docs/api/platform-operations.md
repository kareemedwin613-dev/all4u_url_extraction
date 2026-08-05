# Platform operations API

The final migration slice places profiles, Administration, business overview, and tailoring queue operations behind NestJS.

- `PATCH /api/v1/profile` updates the authenticated user's display name.
- `/api/v1/admin/roles` and `/api/v1/admin/users...` provide Admin-only role, user, and activation management.
- `GET /api/v1/business-overview` returns the existing role-protected summary.
- `/api/v1/tailoring-jobs` supports bounded queue creation, listing, cancellation, and private 90-second Resume links.
- `POST /api/v1/tailoring-jobs/application/:applicationId` requests one idempotent v1.3 preview job.
- `GET /api/v1/tailoring-jobs/:id/input` returns only the sanitized v1.2 worker contract and marks the job `PROCESSING`.
- `PUT /api/v1/tailoring-jobs/:id/preview` revalidates and stores a preview as `NEEDS_REVIEW`.
- `GET /api/v1/tailoring-jobs/:id` returns the review state and validated preview to authorized users.
- `PATCH /api/v1/tailoring-jobs/:id/review` lets an Applying Manager or Admin save controlled edits, approve, or reject a review-ready preview with optimistic concurrency.
- `GET /api/v1/tailoring-jobs/:id/reviews` returns the immutable human review history.
- `POST /api/v1/tailoring-jobs/:id/runner-ticket` lets an Applying Manager or Admin issue one short-lived, job-scoped local runner capability.
- `PATCH /api/v1/tailoring-jobs/:id/format` selects audited `DOCX` or `PDF` output before rendering begins.
- `POST /api/v1/tailoring-jobs/:id/materialize` renders approved content in the selected format, writes the private artifact, and invokes one atomic database finalization.
- `GET /api/v1/tailoring-jobs/:id/file-url` returns a 90-second link to the tailored artifact after completion, or the source file before completion.
- `POST /api/v1/tailoring-runner/claim` exchanges that capability for sanitized input and a bounded run window.
- `PUT /api/v1/tailoring-runner/preview` consumes the claimed capability by submitting one database-validated preview.
- `POST /api/v1/tailoring-runner/failure` records one allowlisted failure code without accepting logs or Resume content.

Tailoring creation accepts a JD ID and up to 100 Resume match records. The backend deduplicates Resume IDs, resolves actual active Resume Storage paths, and derives `user_id` from the verified JWT. Browser-supplied owner IDs and Storage paths are ignored. Existing PostgreSQL RLS policies continue to authorize every query and mutation.

No service-role key, database password, or privileged credential is used. Supabase Auth remains client-side solely to obtain and refresh the user's access token.

The public v1.5 runner capability still stops at preview submission. Only the authenticated manager/admin v1.6 endpoint can render and materialize approved content. The API uses the caller's Supabase token for Storage and RPC operations; it does not use a service-role client.
