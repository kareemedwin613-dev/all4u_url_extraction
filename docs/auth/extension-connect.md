# Extension sign-in: built-in settings and "Connect with dashboard"

Phase 1 of the authentication milestone. Supabase Auth stays the identity store; nothing about
tokens, RLS policies, or roles changes.

## Built-in settings

`extension/config/defaults.js` holds the production Supabase project URL, the publishable key, and
the API and dashboard URL. These are public values (the dashboard bundle ships the same ones), so
appliers install the extension and sign in without opening Settings. Settings saved in the
extension still override them, for development. A build can also override them:

```powershell
$env:EXTENSION_API_BASE_URL="http://localhost:3000"; $env:EXTENSION_DASHBOARD_URL="http://localhost:4174"; npm run build:extension
```

The build refuses a secret key in `EXTENSION_SUPABASE_PUBLISHABLE_KEY`. Never put a secret key in
the extension.

## Connect with dashboard

1. The extension creates a random 256-bit secret and a pairing ID, and opens
   `<dashboard>/#/connect-extension?pairing=<id>&challenge=<sha256(secret)>`. The secret never
   leaves the extension.
2. The dashboard (signing in first if needed; the link survives the sign-in redirect) shows a
   confirmation code derived from the challenge. The extension shows the same code. The user
   approves only if they match. `approve_extension_pairing_v124` binds the pairing to the caller,
   who must be active and hold at least one role.
3. The extension polls `POST /api/v1/extension-pairings/redeem` with the secret.
   `redeem_extension_pairing_v124` returns PENDING until approval, then consumes the pairing once.
   The API creates a **separate** Supabase session for that user and returns it; the extension
   stores it like a password sign-in. A USER_LOGIN event with client type EXTENSION is recorded.

Pairings are single use and expire after 5 minutes. The code check stops someone who sends a user
a Connect link from receiving that user's session.

## Server setup (required once)

Set `SUPABASE_SECRET_KEY` on the API (Vercel project environment variables, **server only**; never
a `VITE_` variable). Use a Supabase secret key (`sb_secret_…`) or the legacy service-role key.
Without it the API runs normally and Connect reports that it is not configured; email and password
sign-in in the extension keeps working.

The key is read in exactly one place, `apps/api/src/extension-pairing/extension-session-minter.ts`,
which only creates a session for a user the database has just verified.

## Rollout

1. Apply migration `202609251600_v3_124_extension_pairing.sql`.
2. Set `SUPABASE_SECRET_KEY` and deploy the API and dashboard.
3. Build and distribute the extension; appliers reload it.
