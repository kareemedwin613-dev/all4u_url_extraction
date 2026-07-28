# Applier workload API

All routes require a verified Supabase JWT and an active `APPLYING_MANAGER` or `ADMIN` role. The API uses the caller's token for Supabase calls, so RLS remains active.

`GET /api/v1/appliers/workloads` accepts `search`, `isAvailable`, `hasCapacity`, `cursor`, and `limit` (1–100). It returns only the Applier ID, display name, email, availability, active count, maximum capacity, and remaining capacity. Active workload is the count of assigned Applications in `ASSIGNED`, `IN_PROGRESS`, or `BLOCKED` work status.

`GET /api/v1/applier-workload-settings` provides the same paginated operational list. `GET /api/v1/appliers/:id/workload-settings` returns one active Applier's settings. `PATCH /api/v1/appliers/:id/workload-settings` accepts:

```json
{"isAvailable": true, "maxActiveApplications": 50}
```

Capacity must be between 1 and 10,000. An active Applier without a stored row uses the application defaults: available with capacity 50. Updating settings records the authenticated manager as `updated_by`.

Workload requests time out after 10 seconds. Direct browser writes to the settings table are denied.
