# Platform operations API

The final migration slice places profiles, Administration, business overview, and tailoring queue operations behind NestJS.

- `PATCH /api/v1/profile` updates the authenticated user's display name.
- `/api/v1/admin/roles` and `/api/v1/admin/users...` provide Admin-only role, user, and activation management.
- `GET /api/v1/business-overview` returns the existing role-protected summary.
- `/api/v1/tailoring-jobs` supports bounded queue creation, listing, cancellation, and private 90-second Resume links.

Tailoring creation accepts a JD ID and up to 100 Resume match records. The backend deduplicates Resume IDs, resolves actual active Resume Storage paths, and derives `user_id` from the verified JWT. Browser-supplied owner IDs and Storage paths are ignored. Existing PostgreSQL RLS policies continue to authorize every query and mutation.

No service-role key, database password, or privileged credential is used. Supabase Auth remains client-side solely to obtain and refresh the user's access token.
