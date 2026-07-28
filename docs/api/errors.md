# API errors and request IDs

Every response includes `X-Request-ID`. A safe incoming ID is retained; otherwise the API generates `req_<uuid>`.

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request contains invalid fields.",
  "requestId": "req_example",
  "fieldErrors": { "sourceUrl": ["sourceUrl must be a URL address"] }
}
```

Foundation codes include `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `DATABASE_ERROR`, `DEPENDENCY_UNAVAILABLE`, and `INTERNAL_ERROR`. Raw SQL errors, stack traces, tokens, and secrets are not returned. Use the request ID for troubleshooting.
