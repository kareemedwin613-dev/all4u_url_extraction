# Temporary Google Sheets JD mirror

Supabase remains the authoritative JD database. This Apps Script project receives HMAC-signed server-to-server deliveries from NestJS and upserts one spreadsheet row by Supabase JD ID. It is not called by the Chrome extension and does not receive a Supabase token.

## Deploy

1. Create or select the destination Google Sheet and copy its spreadsheet ID from the URL.
2. Create a standalone Apps Script project, copy `Code.gs` and `appsscript.json`, and enable the manifest in project settings if needed.
3. In **Project Settings > Script Properties**, set:
   - `SPREADSHEET_ID`: destination spreadsheet ID.
   - `SHEET_NAME`: optional; defaults to `Job Descriptions`.
   - `SYNC_SECRET`: a random value containing at least 32 characters.
4. Deploy as a Web app, execute as the script owner, and permit access to anyone who has the URL. Payload authentication is enforced independently with the HMAC secret.
5. Copy the `/exec` deployment URL and configure the API environment:

```dotenv
GOOGLE_WORKSPACE_JD_SYNC_ENABLED=true
GOOGLE_WORKSPACE_JD_SYNC_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_WORKSPACE_JD_SYNC_SECRET=THE_SAME_RANDOM_32_OR_MORE_CHARACTER_SECRET
GOOGLE_WORKSPACE_JD_SYNC_TIMEOUT_MS=5000
```

Redeploy the API after setting the variables. Never put `SYNC_SECRET` in the extension, dashboard, repository, or Vite environment. Generate a value locally with `openssl rand -hex 32` or an equivalent cryptographically secure password generator.

## Delivery behavior

- Supabase commits first and is never rolled back because Google is unavailable.
- The API records `SYNCING`, `SUCCEEDED`, or `FAILED` in `job_description_workspace_syncs`.
- Saving the same JD again safely retries a failed or stale delivery and upserts the same Sheet row.
- Concurrent requests do not send a second delivery while an attempt is active.
- Descriptions are split across five columns because one Google Sheets cell is limited to 50,000 characters.
