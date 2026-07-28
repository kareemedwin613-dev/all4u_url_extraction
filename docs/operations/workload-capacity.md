# Operating workload capacity

Open **Applier Workloads** as an Applying Manager or Admin. Each active user with the Applier role has availability, active workload, maximum capacity, and remaining capacity. Users without an explicit settings row default to available with a maximum of 50 active Applications.

Set `is_available` to false for leave, onboarding, or other pauses. Existing assignments remain assigned and continue to count; the user simply cannot receive a new bulk assignment. Capacity is a ceiling, not a target, and may be set from 1 to 10,000. If an existing workload already exceeds a newly reduced capacity, remaining capacity is zero.

Active workload includes only `ASSIGNED`, `IN_PROGRESS`, and `BLOCKED`. `UNASSIGNED`, completed, cancelled, and terminal application statuses do not consume capacity.

Preview may become stale while another manager works. The final database transaction always recalculates capacity and reports affected rows as skipped instead of overflowing capacity or reassigning a row. For a timeout or interrupted response, keep the same idempotency key and retry. Investigate the assignment batch and its paginated results before attempting a different request.

After deploying the migration, verify with two manager sessions that overlapping batches cannot double-assign an Application or overflow a destination. This concurrency check requires a live Supabase project and is not covered by static tests.
