# API authentication and authorization

Clients authenticate with Supabase and send `Authorization: Bearer <token>`. The API verifies the signature against `SUPABASE_JWKS_URL`, issuer, expiration, and configured audience. It never accepts a user ID or role from the request body.

JD ingestion requires an active profile and `APPLYING_MANAGER` or `ADMIN`, loaded from trusted `get_my_access_context` data. The user-scoped Data API request then carries the caller token, so PostgreSQL RLS independently enforces access.

Tokens, passwords, keys, and authorization headers are redacted and must never be logged. Invalid or expired tokens return HTTP 401.
