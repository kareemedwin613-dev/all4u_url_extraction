# Resume JD Capture and Operations Platform v0.5.0

A Supabase-backed Chrome extension and separate read-only React/Vite dashboard. No OpenAI API or other AI API is used.

## Milestones

- v0.3 — Supabase Chrome extension for reviewed JD capture, structured resume upload, local deterministic matching, and the existing tailoring queue.
- v0.4 — Read-only JD/resume operations dashboard.
- v0.5 — Auth-linked profiles, five fixed system roles, multi-role assignments, role-aware routes/navigation, Admin user management, application activation, and database-enforced RBAC.

The dashboard already used React before v0.5, so the milestone preserves that actual repository architecture rather than converting frameworks. The extension extraction implementation remains separate and unchanged by the access-control design.

## Fixed roles

`APPLIER`, `APPLYING_MANAGER`, `DEVELOPER`, `DEVELOPMENT_MANAGER`, and `ADMIN` are immutable system role codes. Users may have multiple roles. v0.5 uses one shared internal workspace and does not provide tenant or organization isolation.

- Applier reads shared JDs/resumes and private original resume files.
- Applying Manager has business read plus existing extension write workflows for owned records.
- Developer and Development Manager see account/profile information only.
- Admin has all v0.5 dashboard, business, and user-management access.

RLS and private Storage policies independently enforce these boundaries. The browser uses only the project URL and publishable/anon key; no service-role or secret key is used or exposed.

## Development

```sh
npm install
npm test
npm run dev:dashboard
npm run build:dashboard
npm run build:extension
npm run check
```

Configure `dashboard/.env.local` as described in [v0.5 setup](docs/V0.5_SETUP.md). Load `extension/dist` through `chrome://extensions` after `npm run build:extension`.

Apply migrations locally with `npx supabase db reset`, or link and push with:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

After migration `202607220009`, manually bootstrap the first Admin using the exact idempotent SQL in [v0.5 setup](docs/V0.5_SETUP.md). Later role/status changes are made through the Admin Users dashboard. Users themselves are still created manually in Supabase Auth Dashboard.

See [v0.5 testing](docs/V0.5_TESTING.md) and [v0.5 troubleshooting](docs/V0.5_TROUBLESHOOTING.md). Earlier extension, Supabase, dashboard, security, and manual-testing guides remain in `docs/` where still applicable.

## Repository

- `extension/`: Manifest V3 side-panel client and deterministic extraction.
- `dashboard/`: React/Vite read-only operations and Admin access UI.
- `supabase/migrations/`: additive schema, RLS, RPC, and private Storage migrations.
- `supabase/tests/`: pgTAP schema, role, RPC, RLS, and Storage tests.
- `tests/` and `dashboard/tests/`: JavaScript regression and access-control tests.

## Current limitations and exclusions

v0.5 has one shared workspace. Users are manually created in Supabase Auth; the dashboard cannot invite/delete Auth users or administer passwords/emails. Roles are fixed, detailed permission tables do not exist, and role changes require an access-context refresh. There are no organizations, teams, manager/applier relationships, applications, assignments, batches, bulk operations, technical dashboards, Realtime role updates, Google Workspace integration, or AI APIs. Dashboard business pages remain read-only. The extension remains the write interface for Applying Manager/Admin. No automatic tailoring or job application occurs.

Local PDF/DOCX/TXT parsing remains deterministic. Scanned PDFs have no OCR, complex reading order may be imperfect, and users must review extracted categories, skills, salary, location, security/travel requirements, and text before saving.
