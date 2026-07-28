# Resume API

All routes require `Authorization: Bearer <Supabase access token>`. The API verifies the token and creates a Supabase client scoped to that same user, so existing table and private Storage RLS policies remain active.

- `GET /api/v1/resumes` provides bounded server-side search, filters, sorting, and pagination.
- `GET /api/v1/resumes/count` and `GET /api/v1/resumes/recent` support dashboard summaries.
- `GET /api/v1/resumes/:id` returns one accessible Resume.
- `GET /api/v1/resumes/:id/file-url` returns a private signed URL valid for 90 seconds. Storage policy checks still apply.
- `POST /api/v1/resumes/identity-duplicates` checks candidate name, email, and phone. Admin only.
- `GET /api/v1/resumes/checksum/:checksum` checks an active file checksum. Admin only.
- `POST /api/v1/resumes` accepts multipart fields `metadata` (JSON) and `file`. Admin only; maximum file size is 5 MB.
- `PATCH /api/v1/resumes/:id` updates allowlisted metadata. Admin only.
- `PATCH /api/v1/resumes/:id/status` changes status to `ACTIVE` or `ARCHIVED`. Admin only.

The backend never accepts a caller-supplied owner ID when creating a Resume. It derives `user_id` and the private Storage path from the verified JWT subject. No service-role key is used.
