# Resume JD Capture and Operations Platform v0.7.2

This repository contains a Manifest V3 Chrome extension, a React/Vite/Ant Design operations dashboard, Supabase migrations, and a NestJS API. The dashboard and API can be deployed together as one Vercel project and public origin; the extension points to that same origin. See [unified Vercel deployment](docs/DEPLOYMENT_VERCEL.md), [API setup](apps/api/README.md), and [architecture](docs/architecture/backend-api-v0.7.2.md).

All business-data operations now use the NestJS API: access context, profiles, Admin users/roles, Job Descriptions, Resumes, Applications, bulk/batches, assignments, screenshots, business overview, controlled lookups, and tailoring queue/files. Supabase Auth intentionally stays in the browser to establish and refresh the user's session; its access token is then sent to NestJS, which uses the same token for RLS-protected Supabase access.

Applying Managers and Admins can select up to 100 Job Descriptions, preview every active same-category Resume combination, exclude existing Applications, keep selections across preview pages, and submit up to 2,000 reviewed pairs in one database call. Each request creates an auditable batch with per-pair outcomes. Bulk-created Applications are always unassigned with `UNASSIGNED`, `NOT_APPLIED`, and `NORMAL` defaults. Appliers, Developers, and Development Managers cannot use or query the bulk administration workflow.

Applying Managers and Admins can also select up to 500 existing Applications and assign all of them to one active Applier, or explicitly return them to the unassigned queue, through one protected set-based database call. Changed rows receive assignment-history records; repeated no-op assignments do not create duplicate history. Dashboard data tables expose ascending and descending sorting from their column headers. Paginated Applications, users, and creation batches use allowlisted server-side sorting.

Long dashboard workflows use compact Ant Design tabs instead of stacking every section vertically. Press `Alt+1` through `Alt+9` to open a numbered tab, or focus the tab strip and use the arrow keys. Tab contents remain mounted, so switching sections does not discard unsaved form edits. Primary list tables use bounded viewport scrolling to keep filters, actions, and pagination nearby.

The role-aware sidebar follows Ant Design's collapsible-overlay pattern: a 64-pixel icon rail remains on desktop, expanding over the workspace without changing its width. Use the edge trigger, the header trigger on narrow screens, or `Alt+M`; press `Escape` to collapse it. The header eyebrow reflects the current section instead of a static label. On desktop, the pin control in the expanded sidebar switches it from a temporary overlay to a docked panel that pushes page content aside so nothing is covered; pinning is unavailable on narrow screens, where the overlay always covers content and a click-to-close backdrop is used instead. The current section stays highlighted on detail routes.

## Local commands

    npm install
    npm run lint
    npm run typecheck
    npm test
    npm run test:db
    npm run build:dashboard
    npm run build:extension
    npm run check

`npm run test:db` requires a running local Supabase stack. The repository is JavaScript/JSX, not TypeScript; `typecheck` validates the dashboard and extension module/build contracts.

## Supabase

Apply all migrations in filename order. The v0.7 migration is `supabase/migrations/202607240016_v0_7_bulk_application_creation.sql`; the follow-up bulk-assignment and sorting migration is `supabase/migrations/202607240017_bulk_assignment_and_table_sorting.sql`.

For a linked project, inspect before explicitly deploying:

    npx supabase db push --dry-run --linked
    npx supabase db push --linked

See the [v0.7 implementation record](docs/V0.7_IMPLEMENTATION.md), [v0.7 setup](docs/V0.7_SETUP.md), and [v0.7 testing](docs/V0.7_TESTING.md). Existing v0.5 Admin bootstrap and v0.6 workflow documentation remain applicable.

## Security model

All new batch tables use RLS. Authenticated table access is read-only and role-scoped; preview, creation, and bulk assignment use `SECURITY DEFINER` RPCs that verify the active caller. Bulk assignment accepts only Application IDs, validates any destination as an active Applier, and derives the actor from `auth.uid()`. Private Resume Storage and short-lived signed URLs are unchanged.

Only the Supabase project URL and publishable/anon key belong in browser settings. Never place a service-role key, secret key, database password, or other private credential in frontend code.

## Boundaries

Automatic workload distribution, teams, organizations, feature-permission tables, AI matching/scoring, Resume tailoring automation, job-site submission, Google Workspace integration, OpenAI API, and every other AI API are intentionally excluded.
