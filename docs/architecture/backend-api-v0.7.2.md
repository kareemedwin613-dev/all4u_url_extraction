# Backend API architecture — v0.7.2

The NestJS application in `apps/api` is independently buildable. Supabase Auth remains the identity provider and PostgreSQL remains responsible for constraints, uniqueness, atomicity, and RLS.

```text
Chrome extension -- bearer JWT --> NestJS API -- same user JWT --> Supabase Data/Storage APIs --> PostgreSQL/RLS
React dashboard -- bearer JWT --> NestJS API -- same user JWT --> Supabase Data/Storage APIs --> PostgreSQL/RLS
Dashboard / extension -----> Supabase Auth (sign-in, refresh, sign-out only)
```

The API verifies JWT signatures using the configured Supabase JWKS, issuer, expiration and optional audience. Identity always comes from `sub`. The role guard calls `get_my_access_context` through a user-scoped Supabase client configured with Supabase's `accessToken` callback and permits active Applying Managers, JD Finders, and Admins for ingestion. The service inserts with the same access token and explicitly uses the verified subject as `user_id`; existing RLS remains effective.

There is no privileged/system client and no direct PostgreSQL connection. Administrative and complex business workflows pass through NestJS. Latency-sensitive extension access, controlled lookups, My Applications progress, and screenshot operations call narrowly scoped RPCs/tables/Storage directly with the same user JWT and existing RLS policies. Private dashboard uploads still use API multipart requests, and downloads use short-lived signed URLs.

The `capture_job_description_v353` RPC checks `(user_id, normalized_source_url)` and the case-insensitive `(user_id, company, job_title)` pair, uses transaction advisory locks, and inserts or returns the duplicate in one database round trip. The normalized-URL unique index remains an additional race-condition-safe constraint. A duplicate returns HTTP 200 with its reason; a new row returns HTTP 201. `Idempotency-Key` is accepted and validated, and the extension supplies one for safe transient retries.

Cross-cutting controls include fail-fast environment validation, restricted CORS, global and ingestion-specific throttling, request IDs, structured redacted logs, standard errors, Swagger outside production, and graceful shutdown.
