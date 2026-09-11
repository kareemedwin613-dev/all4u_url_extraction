# Application API

## Extension Resume download

`GET /api/v1/applications/:id/resume-file-url` returns a 90-second signed URL for only the active Resume currently attached to the authorized Application. The response also includes `resumeNumber`, `resumeType`, filename, MIME type, and byte size. v1.7 extension cards use this endpoint to distinguish and download Original versus Tailored variants; they never query Supabase Storage directly.

All routes require a verified Supabase bearer token. NestJS calls the existing PostgreSQL functions with that same user's token; PostgreSQL role checks, RLS, constraints, histories, and bulk set-based behavior remain authoritative.

Core routes include:

- `GET /api/v1/applications`, `/mine`, `/counts`, and `/:id`
- `GET /api/v1/applications/appliers`, `/options/jobs`, and `/options/resumes`
- `POST /api/v1/applications`
- `PATCH /api/v1/applications/:id/progress` and `/:id/assignment`
- `GET /api/v1/applications/:id/resume-file-url`

## Original vs tailored match scores (v3.78–v3.79)

`GET /api/v1/applications/:id/match-comparison` is a read-only, Application-access-scoped view of the original and attached tailored Resume scores, reasons, component ratings and evaluation dates. The creation score/threshold/reason remain separately visible and unchanged. Missing scores are not zero. Historical scores are marked stale; a point difference is returned only when both are completed against current source hashes and the same configured model/rubric. This measures document alignment, not verification of the candidate's experience.

`POST /api/v1/applications/:id/match-comparison` accepts an empty body and requires Applying Manager/Admin access. It snapshots only this Application's JD, original Resume and attached tailored child, reuses completed current assessments and issues a normal matching runner ticket for pending evaluations. No new Application is created and eligibility/duplicate gates are unchanged. The dashboard shows the usual `npm run matching:run` command for historical resumes or retries. Reading the details page never starts AI work.

After PDF materialization, v3.79 attaches a comparison ticket to the existing materialization receipt. The local tailoring CLI runs the existing matching worker automatically with that ticket and the same API origin, using the matching worker's environment file. Each tailoring slot uses one scoring slot to avoid multiplying batch concurrency. A cached original score normally leaves one model call for the tailored Resume; absent/stale originals require another. Scoring failures do not undo or re-run successful tailoring. Browser-only materialization queues the scores, but a local matching command must still execute them.

Rollout: stop workers, apply `202609111010_v3_78_application_score_comparison.sql` and `202609111020_v3_79_tailoring_score_comparison.sql`, deploy/restart API and dashboard, then run the updated local tailoring worker. No score backfill or mass reevaluation runs during migration. Already tailored Applications can be evaluated from their details page.

Single creation accepts optional `matchingMode: "SCORE" | "CATEGORY"`; omitted means `SCORE`. Supply the same `matchingMode` query parameter to `/options/resumes` and in the bulk-preview body used to check the selected pair. `CATEGORY` restores the previous category/subcategory eligibility without AI evaluation, as described in [Bulk Applications API](./bulk-applications.md). It does not bypass assignment permissions, bans, duplicate checks or active/approved source requirements. The chosen method is recorded on creation and preserved when the original Resume is replaced with its tailored child.

Bulk and batch routes include:

- `POST /api/v1/applications/bulk-preview`
- `POST /api/v1/applications/bulk-create`
- `GET /api/v1/application-batches`, `/options`, `/:id`, and `/:id/results`
- `POST /api/v1/applications/bulk-assignment-preview` and `/bulk-assign`
- `GET /api/v1/assignment-batches`, `/:id`, and `/:id/results`

Application confirmation screenshots use authenticated list, multipart upload, delete, and 90-second signed-download routes below `/api/v1/applications/:id/screenshots`. Browser code no longer writes screenshot objects or metadata directly.

Applying Managers and Admins may create, individually assign, bulk assign, preview, bulk create, and read batch administration records. Assigned Appliers may use the progress and screenshot routes; the existing database functions re-check assignment and allowed fields. Creation request DTOs enforce UUIDs, matching-method enums, URL/date formats, text limits, a 1,000-JD preview limit and a 5,000-pair creation limit. Assignment limits are defined separately by the bulk-assignment API.
