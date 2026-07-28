# Bulk Idempotency

Generate one opaque `Idempotency-Key` before submitting a reviewed bulk-create request and reuse it after a timeout, lost response, or network interruption.

Keys are scoped to the authenticated user. PostgreSQL serializes requests for the same user/key, stores a SHA-256 hash of the normalized payload, and enforces a partial unique index. The same key and payload replay the original result; a different payload returns HTTP 409 `IDEMPOTENCY_CONFLICT`.

Keys must contain 8â€“200 letters, numbers, dots, underscores, colons, or hyphens and must never contain credentials.
