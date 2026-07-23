# Troubleshooting

- **Side panel:** use Chrome 114+, reload the built extension, and inspect its manifest errors.
- **Build/PDF worker:** run `npm install`, then `npm run clean && npm run build`; verify `extension/dist/assets/pdf.worker.min.mjs` exists.
- **Connection/key:** only standard HTTPS `*.supabase.co` URLs are supported. Use a publishable/anon key. A paused project or network block can appear as a fetch failure.
- **Login/session:** create the user in Dashboard, confirm email/password auth, and clear the extension session before retrying configuration changes.
- **RLS insert/403:** verify migrations, `auth.uid()`, category IDs, row ownership, and Storage folder first segment. Inspect Supabase Auth, Postgres, API, and Storage logs.
- **Missing bucket:** push the Storage migration and confirm both buckets are private.
- **Partial upload:** inspect the authenticated user's Storage folder. The extension attempts deletion when metadata insertion fails and reports a cleanup error separately.
- **Duplicate JD:** use Update Existing JD only after reviewing the existing record. URL fragments and known tracking parameters normalize away.
- **Parser:** `.doc` and image-only PDFs are unsupported. Verify extension/MIME agreement and the 5 MiB limit.
- **Paylocity:** refresh the page, grant its origin, and inspect side-panel and service-worker DevTools diagnostics.
- **Site permission:** use Chrome's extension site-access controls if the prompt was denied.

Open side-panel DevTools by right-clicking the panel. Open service-worker DevTools from `chrome://extensions`. Never paste credentials, sessions, resumes, or complete JDs into support logs.
