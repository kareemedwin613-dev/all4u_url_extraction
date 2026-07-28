# Application API

All routes require a verified Supabase bearer token. NestJS calls the existing PostgreSQL functions with that same user's token; PostgreSQL role checks, RLS, constraints, histories, and bulk set-based behavior remain authoritative.

Core routes include:

- `GET /api/v1/applications`, `/mine`, `/counts`, and `/:id`
- `GET /api/v1/applications/appliers`, `/options/jobs`, and `/options/resumes`
- `POST /api/v1/applications`
- `PATCH /api/v1/applications/:id/progress` and `/:id/assignment`
- `GET /api/v1/applications/:id/resume-file-url`

Bulk and batch routes include:

- `POST /api/v1/applications/bulk-preview`
- `POST /api/v1/applications/bulk-create`
- `GET /api/v1/application-batches`, `/options`, `/:id`, and `/:id/results`
- `POST /api/v1/applications/bulk-assignment-preview` and `/bulk-assign`
- `GET /api/v1/assignment-batches`, `/:id`, and `/:id/results`

Application confirmation screenshots use authenticated list, multipart upload, delete, and 90-second signed-download routes below `/api/v1/applications/:id/screenshots`. Browser code no longer writes screenshot objects or metadata directly.

Applying Managers and Admins may create, individually assign, bulk assign, preview, bulk create, and read batch administration records. Assigned Appliers may use the progress and screenshot routes; the existing database functions re-check assignment and allowed fields. Request DTOs enforce UUIDs, enums, URL/date formats, text limits, the 100-JD creation-preview limit, 2,000-Application assignment limit, 100-Applier assignment limit, and 2,000-pair creation limit.
