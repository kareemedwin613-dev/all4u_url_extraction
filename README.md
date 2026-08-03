# Resume JD Capture and Operations Platform v1.5

This repository contains a Manifest V3 Chrome extension, a React/Vite/Ant Design operations dashboard, Supabase migrations, and a NestJS API. The dashboard and API can be deployed together as one Vercel project and public origin; the extension points to that same origin. See [unified Vercel deployment](docs/DEPLOYMENT_VERCEL.md), [API setup](apps/api/README.md), and [v0.8 architecture](docs/architecture/backend-api-v0.8.md).

Development uses protected `main` plus short-lived typed branches and squash-merged pull requests. See the [branching and pull-request guide](CONTRIBUTING.md) before committing or opening a PR.

All business-data operations now use the NestJS API: access context, profiles, Admin users/roles, Job Descriptions, Resumes, Applications, bulk/batches, assignments, screenshots, business overview, controlled lookups, and tailoring jobs. Supabase Auth establishes and refreshes user sessions; access tokens are sent to NestJS, which uses the same token for RLS-protected Supabase access. The local tailoring worker talks only to NestJS and keeps its token outside the Codex subprocess.

Resume tailoring currently stops at a human-approved, Application-scoped structured preview. Applying Managers and Admins can edit only the summary, source-linked experience details, and source Resume skills, then save a draft, approve, or reject with immutable audit history. v1.5 replaces manual access-token and job-ID setup with a copyable, short-lived, one-job runner command. See [Resume variants](docs/tailoring/v1.1-resume-variants.md), the [local worker](apps/tailoring-worker/README.md), the [v1.3 preview lifecycle](docs/tailoring/v1.3-preview-lifecycle.md), [v1.4 review and approval](docs/tailoring/v1.4-review-approval.md), and the [v1.5 runner](docs/tailoring/v1.5-one-command-runner.md). No tailored file or Resume row is created yet.

Applying Managers and Admins can select up to 100 Job Descriptions, preview every active same-category Resume combination, exclude existing Applications, keep selections across preview pages, and submit up to 2,000 reviewed pairs in one database call. Each request creates an auditable batch with per-pair outcomes. Bulk-created Applications are always unassigned with `UNASSIGNED`, `NOT_APPLIED`, and `NORMAL` defaults. Appliers, Developers, and Development Managers cannot use or query the bulk administration workflow.

Applying Managers and Admins can select up to 2,000 unassigned Applications and distribute them manually, evenly, or by remaining capacity among as many as 100 active and available Appliers. Preview is deterministic and read-only; the final protected database operation rechecks eligibility and capacity under row locks, records assignment history and per-row batch outcomes, and supports safe idempotent retry. Workload settings default to available with capacity 50. See [bulk assignment](docs/api/bulk-assignment.md) and [capacity operations](docs/operations/workload-capacity.md).

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

`npm run test:db` requires a running local Supabase stack. The dashboard and extension use JavaScript/JSX; the NestJS API, shared contracts, and tailoring worker use TypeScript.

## Supabase

Apply all migrations in filename order. The latest migration is `supabase/migrations/202608030041_v1_5_one_command_tailoring_runner.sql`.

For a linked project, inspect before explicitly deploying:

    npx supabase db push --dry-run --linked
    npx supabase db push --linked

See the [v0.7 implementation record](docs/V0.7_IMPLEMENTATION.md), [v0.7 setup](docs/V0.7_SETUP.md), and [v0.7 testing](docs/V0.7_TESTING.md). Existing v0.5 Admin bootstrap and v0.6 workflow documentation remain applicable.

## Security model

All new workload and assignment-batch tables use RLS. Authenticated table access is role-scoped and direct writes are denied; preview and assignment use `SECURITY DEFINER` RPCs that verify the active caller. Bulk assignment accepts reviewed Application/Applier IDs, revalidates live eligibility and capacity, and derives the actor from `auth.uid()`. Private Resume Storage and short-lived signed URLs are unchanged.

Only the Supabase project URL and publishable/anon key belong in browser settings. Never place a service-role key, secret key, database password, or other private credential in frontend code.

## Boundaries

AI workload optimization, scheduled assignment, bulk reassignment, teams, organizations, feature-permission tables, AI matching/scoring, automatic tailored-file generation, job-site submission, Google Workspace integration, OpenAI API, and every other AI API are intentionally excluded. The local worker uses the locally authenticated Codex CLI only for an operator-triggered preview; the mandatory human decision remains separate.
