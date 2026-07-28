# Bulk assignment API

`POST /api/v1/applications/bulk-assignment-preview` creates no records. It accepts `MANUAL`, `EVEN`, or `CAPACITY_AWARE`, no more than 2,000 unique Application IDs, and no more than 100 unique Applier IDs. Only Applications with `assigned_to = null` and `work_status = UNASSIGNED` are eligible.

`EVEN` selects the lowest projected active workload, with user ID as a stable tie-breaker. `CAPACITY_AWARE` selects the greatest projected remaining capacity, then lowest projected workload and user ID. `MANUAL` accepts explicit `{applicationId, assignedTo}` pairs. Every strategy excludes inactive/unavailable non-Appliers and prevents projected capacity overflow.

`POST /api/v1/applications/bulk-assign` accepts the reviewed explicit pairs, strategy, and optional batch name. It requires an `Idempotency-Key` header (8–200 safe characters). The database revalidates all Applications, Appliers, roles, availability, and live capacity. It locks affected Applier and Application rows, updates eligible rows, and writes assignment history and batch results in the same transaction. Partial success is represented by `ASSIGNED`, `SKIPPED`, and `FAILED` row outcomes.

The same actor, key, and normalized payload returns the original result. Reusing that key for a different payload returns `IDEMPOTENCY_CONFLICT`. After a network timeout, retry with the same key. Preview and commit time out after 15 and 30 seconds and are rate-limited to 30 per five minutes and 10 per ten minutes respectively.

Only active Applying Managers and Admins may call these endpoints. Bulk reassignment and unassignment are deliberately unsupported.
