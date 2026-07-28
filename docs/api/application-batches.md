# Application Batches API

These authenticated Applying Manager/Admin endpoints expose batch administration without direct browser table access:

- `GET /api/v1/application-batches` supports bounded pagination, opaque cursor, status, creator, date range, search, and allowlisted sorting.
- `GET /api/v1/application-batches/:id` returns summary information and created Application references without row outcomes.
- `GET /api/v1/application-batches/:id/results` returns 25â€“100 outcomes per page and supports outcome and display-metadata filters.
- `GET /api/v1/application-batches/options` remains as a bounded Application-filter lookup.

RLS and RPC role assertions remain active.
