# Unified Vercel deployment

The repository deploys as one Vercel project and one public origin:

- `dashboard/dist` is the React/Vite static application.
- `api/index.mjs` initializes and caches the NestJS application as one Vercel Function.
- `/api/v1/*`, `/health`, `/ready`, and development-only `/api/docs/*` route to NestJS.
- Other paths fall back to the dashboard `index.html`.

The dashboard leaves `VITE_API_BASE_URL` unset in Vercel and therefore calls the API on its own origin. The Chrome extension is not hosted by Vercel; load its production bundle in Chrome and set **Backend API URL** to the Vercel production origin.

## Create the project

1. Push this repository to a Git provider and import it into Vercel.
2. Keep the Vercel **Root Directory** at the repository root (`resume-jd-capture`).
3. Vercel reads `vercel.json`; do not override its install command, build command, or output directory in the project UI.
4. Add the environment variables below for Production and Preview.
5. Deploy, then verify `/health`, `/ready`, sign-in, a dashboard read, and one authorized write.

Fluid Compute is enabled in `vercel.json`. Before the production deploy, open the Supabase project settings and note its AWS region, then select the closest matching **Functions Region** in the Vercel project settings. Do not guess the region and do not configure multiple primary regions for this single-region database.

You can also use the CLI from the repository root:

```powershell
npx vercel
npx vercel --prod
```

## Environment variables

Set these server-only variables:

```text
NODE_ENV=production
API_BASE_PATH=api/v1
CORS_ORIGINS=chrome-extension://YOUR_EXTENSION_ID
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_OR_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_JWT_ISSUER=https://YOUR_PROJECT_REF.supabase.co/auth/v1
SUPABASE_JWKS_URL=https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_AUDIENCE=authenticated
RATE_LIMIT_TTL_MS=60000
RATE_LIMIT_MAX=60
INGESTION_RATE_LIMIT_MAX=20
LOG_LEVEL=info
SWAGGER_ENABLED=false
```

Set these Vite build variables:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Do not set `VITE_API_BASE_URL` on Vercel. Same-origin requests work for both preview and production domains. The publishable/anon key is intentionally usable by the browser and backend with authenticated user JWTs; never add a service-role key, Supabase secret key, database password, or user access token.

For local development, keep `VITE_API_BASE_URL=http://localhost:3000` in `dashboard/.env.local` and run `npm run dev:api` plus `npm run dev:dashboard`.

## Supabase settings

Add the production and any required preview dashboard URL to Supabase Authentication URL Configuration. For the Workspace-removal release, deploy the application code first and then apply the pending database migrations. The API's temporary legacy capture fallback and the dashboard's slow status-refresh fallback keep the app working until the atomic capture and Realtime migrations arrive, while deploying code first ensures the old API cannot race the destructive mirror cleanup.

Migration `202609021119_v3_55_remove_google_workspace_mirror.sql` permanently removes the retired Workspace sync functions and their historical sync-state table. After deploying it, delete any obsolete `GOOGLE_WORKSPACE_JD_SYNC_*` variables from the Vercel project.

## File upload limit

Vercel Functions accept request bodies up to 4.5 MB. The current application permits files up to 5 MiB, so uploads near that application limit can be rejected by Vercel before NestJS receives them. Use files below 4 MB for this deployment. A later direct-to-private-Supabase signed-upload flow can remove this transport limitation without exposing a privileged key.

## Verification checklist

- `GET https://YOUR_DOMAIN/health` returns `status: ok`.
- `GET https://YOUR_DOMAIN/ready` reports Supabase as `ready`.
- The dashboard loads on `/` and a refreshed hash route still loads.
- Sign-in succeeds and the access context loads.
- An authorized JD or Application mutation succeeds through `/api/v1/*`.
- The Chrome extension connects using the same production origin.
- A Resume under 4 MB uploads and its private signed URL opens.
- A user without the required role receives the expected authorization error.

Vercel preview deployment, live Supabase, Chrome-extension, and manual acceptance results must be recorded separately; local builds do not prove them.
