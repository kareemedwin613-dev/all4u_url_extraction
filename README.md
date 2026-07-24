# Resume JD Capture and Operations Platform v0.6.0

This repository contains a Manifest V3 Chrome extension, a React/Vite operations dashboard, and Supabase migrations. v0.6 adds the individual Application workflow while preserving the extension’s JD extraction, Resume upload, private Storage, authentication, profiles, fixed multi-role RBAC, and Admin user management.

An Application links exactly one Job Description and one active Resume. Applying Managers and Admins create, assign, reassign, unassign, prioritize, schedule, update, or cancel Applications. Assigned Appliers can see only their Applications and can update progress fields. Work status and employer-facing Application status remain separate, and assignment/status changes are recorded automatically.

Admins can also upload a text-based PDF Resume from the dashboard. The browser extracts the complete text, Summary/Education/Skills sections, technical skills, category/subcategory suggestion, seniority, industry experience, candidate-name suggestion, SHA-256 checksum, and repeatable Professional Experience records. Before saving, an Admin can add or remove positions and edit each company, job title, location, start/end month, current-role state, and one multiline achievements-and-responsibilities field containing all bullets for that experience. New dashboard uploads use structured Resume schema version 2; version 1 records remain readable. The rule-based flow does not use an AI API.

## Local commands

    npm install
    npm run lint
    npm run typecheck
    npm test
    npm run build:dashboard
    npm run build:extension
    npm run check

npm run test:db requires a running local Supabase stack. The repository is JavaScript/JSX, not TypeScript; typecheck performs full module-graph and bundler-contract validation for both browser applications.

## Supabase

Apply migrations in order. The v0.6 Application migration is supabase/migrations/202607220010_v0_6_individual_applications.sql. Structured Resume schema version 2 is enabled by supabase/migrations/202607240011_resume_structured_schema_v2.sql. Assigned-Applier status/URL updates are corrected by supabase/migrations/202607240012_fix_applier_progress_updates.sql.

For a linked project, first inspect the pending migration:

    npx supabase db push --dry-run --linked

Then explicitly deploy when ready:

    npx supabase db push --linked

See [v0.6 setup](docs/V0.6_SETUP.md), [v0.6 testing](docs/V0.6_TESTING.md), and [v0.6 troubleshooting](docs/V0.6_TROUBLESHOOTING.md). The first Admin bootstrap and Auth-user creation remain documented in [v0.5 setup](docs/V0.5_SETUP.md).

## Security model

The five fixed roles remain APPLIER, APPLYING_MANAGER, DEVELOPER, DEVELOPMENT_MANAGER, and ADMIN; multiple roles form a union. All Application tables have RLS. Browser roles receive read-only table grants, while protected writes execute through authenticated PostgreSQL functions that derive the actor from auth.uid(). Resume objects remain private and Application Resume links expire after 90 seconds.

Only the Supabase project URL and publishable/anon key belong in extension or dashboard settings. Never place a service-role key, secret key, or database password in frontend code.

## v0.6 boundaries

There is no bulk creation or assignment, batching, organizations, teams, detailed permissions table, automatic matching/scoring, new tailoring automation, job-site submission automation, Google Workspace integration, OpenAI API, or other AI API. Existing legacy matching/tailoring code is retained only for regression compatibility and is not extended by v0.6.
