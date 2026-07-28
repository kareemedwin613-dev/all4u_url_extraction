# Extension JD ingestion

`POST /api/v1/extension/job-descriptions`

Headers: Bearer Supabase token and JSON content type are required. `Idempotency-Key` is recommended and `X-Request-ID` is optional.

Required fields are `sourceUrl`, `company`, `jobTitle`, `descriptionText`, and `categoryId`. Reviewed subcategory, industry domain, seniority, location, arrangement, clearance, travel, salary, skills, capture metadata, capture time, and extension version are supported.

Limits: company/job title 200 characters, URL 4,000, description 100–200,000, location 300, travel/salary text 500, 250 skills of at most 100 characters, and five controlled clearance values. Unknown properties are rejected.

- New record: HTTP 201 and `duplicate=false`.
- Same normalized URL, or the same case-insensitive company and job title for the caller: HTTP 200, original record, `duplicate=true`, and a `duplicateReason` identifying the matched rule.
- Invalid input: 400. Invalid/expired token: 401. Inactive/wrong role or RLS denial: 403. Throttle exceeded: 429.

The extension retries only network, timeout, and 502–504 failures, and only with an idempotency key. Validation and authorization failures are not retried.
