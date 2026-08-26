# Bulk assignment API

`POST /api/v1/applications/bulk-assignment-preview` creates no records. It accepts `strategy: "PROFILE"` and up to 5,000 unique Application IDs. Each Application is matched to the Applier who owns that Resume in `applier_resume_profiles`. Applications with no profile mapping are excluded (`RESUME_PROFILE_MISSING`). Inactive Appliers or users without the Applier role are excluded. Capacity and availability are not enforced for PROFILE assignment.

`POST /api/v1/applications/bulk-assign` accepts the reviewed explicit `{applicationId, assignedTo}` pairs from preview, `strategy: "PROFILE"`, and an optional batch name. It requires an `Idempotency-Key` header (8–200 safe characters). The database revalidates Applications, Appliers, roles, and profile allowlist. Capacity and availability are not enforced for PROFILE. It locks affected Applier and Application rows, updates eligible rows, and writes assignment history and batch results in the same transaction. Partial success is represented by `ASSIGNED`, `SKIPPED`, and `FAILED` row outcomes.

The same actor, key, and normalized payload returns the original result. Reusing that key for a different payload returns `IDEMPOTENCY_CONFLICT`. After a network timeout, retry with the same key. Preview and commit time out after 15 and 30 seconds and are rate-limited to 30 per five minutes and 10 per ten minutes respectively.

Only active Applying Managers and Admins may call these endpoints. Map Resume profiles in Applier Directory before bulk assigning.
