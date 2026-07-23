# Dashboard setup

## Prerequisites

- Node.js 20.19+ or 22.12+ (Vite 7.1.11 requirement)
- npm
- An existing Supabase project with this repository's migrations applied
- An existing Supabase email/password user

The dashboard frontend uses React 19, React DOM, JSX, and Vite. The Chrome extension remains a separate vanilla-JavaScript application.

Install dependencies from the repository root with `npm install`.

## Configure

Copy `dashboard/.env.example` to `dashboard/.env.local` and set:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Use only the browser-safe publishable/anon key. Never place a Supabase secret key, privileged server key, database password, or administrator credential in a `VITE_` variable. The dashboard and extension are configured separately even when they point to the same project.

## Commands

```sh
npm run dev:dashboard
npm run build:dashboard
npm run preview:dashboard
npm run build:extension
npm test
```

Open the local Vite URL and sign in with an existing Supabase Auth user. Sessions use the normal Supabase browser session store. After v0.5, RLS grants shared business reads only to active Applier, Applying Manager, and Admin users; private resume objects use the same role boundary. Applying Manager writes remain owner-scoped, while Admin is authorized across the shared workspace.

The production output is `dashboard/dist`. Deploy that folder to any static host. Hash routes need no server rewrite. Provider-specific deployment automation is outside v0.4. Verify the extension separately with `npm run build:extension` and load `extension/dist` in Chrome.
