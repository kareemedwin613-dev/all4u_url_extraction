# Backend API architecture — v0.7.2

The NestJS application in `apps/api` is independently buildable. Supabase Auth remains the identity provider and PostgreSQL remains responsible for constraints, uniqueness, atomicity, and RLS.

```text
Chrome extension -- bearer JWT --> NestJS API -- same user JWT --> Supabase Data/Storage APIs --> PostgreSQL/RLS
React dashboard -- bearer JWT --> NestJS API -- same user JWT --> Supabase Data/Storage APIs --> PostgreSQL/RLS
Dashboard / extension -----> Supabase Auth (sign-in, refresh, sign-out only)
```

The API verifies JWT signatures using the configured Supabase JWKS, issuer, expiration and optional audience. Identity always comes from `sub`. The role guard calls `get_my_access_context` through a user-scoped Supabase client configured with Supabase's `accessToken` callback and permits active Applying Managers, JD Finders, and Admins for ingestion. The service inserts with the same access token and explicitly uses the verified subject as `user_id`; existing RLS remains effective.

There is no privileged/system client and no direct PostgreSQL connection. Every business-data workflow now passes through NestJS, including access context, profiles, Admin users/roles, JD, Resume, Application, bulk/batch, assignment, screenshots, business overview, controlled lookups, and tailoring queue/files. Private uploads use multipart requests, Storage is accessed using the same user's JWT, and downloads return 90-second signed URLs. Browser Supabase usage is limited to authentication session lifecycle.

The API checks both `(user_id, normalized_source_url)` and the case-insensitive `(user_id, company, job_title)` pair. The existing normalized-URL unique index remains the race-condition-safe enforcement layer for URL matches. Either sequential match returns HTTP 200 with the existing row and a reason; a new row returns HTTP 201. `Idempotency-Key` is accepted and validated, and the extension supplies one for safe transient retries.

Cross-cutting controls include fail-fast environment validation, restricted CORS, global and ingestion-specific throttling, request IDs, structured redacted logs, standard errors, Swagger outside production, and graceful shutdown.
