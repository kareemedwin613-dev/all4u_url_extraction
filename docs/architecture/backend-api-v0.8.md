# Backend API architecture v0.8

The React dashboard sends the authenticated user's Supabase access token to NestJS. NestJS verifies the JWT and checks database-backed roles before creating a request-scoped Supabase client with that same token. Normal requests never use a service-role client, and PostgreSQL RLS remains the final authorization boundary.

The v0.8 vertical slice adds workload, preview, commit, and audit-read endpoints. Browser code does not write assignment fields, history, workload settings, batches, or results directly and does not call the v0.8 RPCs.

Preview is deterministic but advisory. Commit is authoritative: one `SECURITY DEFINER` operation locks destination profiles in a stable order, locks Applications, recalculates active workloads, checks capacity for every proposal, updates Applications, and writes assignment history and batch results atomically. A transaction-scoped advisory lock serializes the authenticated actor's idempotency key. Unique constraints prevent duplicate batches and results.

The three new tables have RLS enabled. Managers/Admins have controlled read access; settings mutations and batch writes occur only through protected functions that derive the actor from `auth.uid()`. Existing private Resume Storage and signed-URL flows are unchanged.
