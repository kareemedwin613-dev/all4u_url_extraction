# Dashboard troubleshooting

- **Setup required:** create `dashboard/.env.local`, set both `VITE_` values, and restart Vite. The project URL must be standard `https://PROJECT.supabase.co`.
- **Invalid key:** copy the publishable/anon key from the Supabase project API settings. Never use a secret or privileged server key in the browser.
- **Invalid credentials:** create or confirm the user under Supabase Authentication → Users. Dashboard credentials are application-user credentials, not necessarily the Dashboard login.
- **Session expired:** sign in again. If it repeats, verify browser storage is allowed and the project is not paused.
- **No rows:** owner RLS means the signed-in user sees only rows whose `user_id` matches their Auth UUID.
- **Unknown category:** confirm the seed was applied and the referenced category is active/readable.
- **Original resume will not open:** confirm the row points to `original-resumes`, the object still exists at `storage_path`, and its first folder is the user's UUID. Do not make the bucket public.
- **Build failure:** run `npm install`, confirm the supported Node version, then run `npm run build:dashboard` again.
- **Static route issue:** deploy `dashboard/dist` and use the hash routes (`#/jobs`); no rewrite rule is needed.
- **Stale browser assets:** clear the static host/browser cache or use a fresh private window after deploying a new build.
- **Different data between products:** confirm the dashboard `.env.local` and extension Settings use the same Supabase project URL.
