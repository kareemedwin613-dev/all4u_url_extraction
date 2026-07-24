# Bulk assignment and table sorting

Migration `202607240017_bulk_assignment_and_table_sorting.sql` adds a protected, set-based `bulk_assign_applications` RPC. Active Applying Managers and Admins may submit up to 500 distinct Application IDs, one active Applier ID or `null`, and an optional reason of at most 2,000 characters.

The RPC validates authorization and the destination Applier, updates changed Applications in one statement, derives `assigned_by` from `auth.uid()`, and writes one `application_assignment_history` row per change. Any automatic work-status transition also receives an `application_status_history` row. Assigning an unassigned row changes its work status to `ASSIGNED`; unassigning changes it to `UNASSIGNED`. Existing in-progress statuses are preserved during reassignment. Missing and unchanged rows are returned as outcomes instead of silently disappearing.

The dashboard shows selection only to Applying Managers and Admins. Selection survives pagination, the UI blocks requests above 500 rows, and an explicit assignment action is required before confirmation. No Applier, Developer, or Development Manager can invoke the RPC directly.

All dashboard data tables now provide Ant Design header sorting. Small, fully loaded tables sort locally. Paginated Application, Application Batch, and Admin User tables pass an allowlisted sort to versioned server RPCs so order remains stable across pages. Job Description and Resume tables retain their existing Supabase query ordering with expanded allowlists.

Apply migrations in order, then rebuild the dashboard:

    npx supabase db push --dry-run --linked
    npx supabase db push --linked
    npm run build:dashboard

Never put a service-role key, secret key, or database password in browser code or settings.
