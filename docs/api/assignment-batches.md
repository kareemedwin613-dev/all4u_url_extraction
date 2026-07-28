# Assignment batch API

Assignment batches are the audit record for v0.8 bulk assignment and are distinct from Application-creation batches.

- `GET /api/v1/assignment-batches` supports opaque cursor pagination plus `status`, `strategy`, `createdBy`, `createdFrom`, `createdTo`, and `search` filters.
- `GET /api/v1/assignment-batches/:id` returns batch summary and creator information.
- `GET /api/v1/assignment-batches/:id/results` supports opaque cursor pagination and an `outcome` filter.

Batch states are `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, and `FAILED`. Result outcomes are `ASSIGNED`, `SKIPPED`, and `FAILED`; each result records the destination, error code/message, and timestamp. Reads require an active Applying Manager or Admin. RLS denies other roles and all direct authenticated writes.
