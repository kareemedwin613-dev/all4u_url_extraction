# Resume tailoring worker v1.2

This separately buildable local worker proves the Codex CLI tailoring contract without reading or writing Supabase. It accepts a prepared fixture selected by Application UUID, exposes only the original Resume summary, experience records, and skills to Codex, validates a strict JSON result, and writes a create-only local preview.

## Local proof

Install and verify the worker:

```powershell
npm ci --prefix apps/tailoring-worker
npm run test:tailoring
npm run build:tailoring
```

Run the synthetic proof with the locally authenticated Codex CLI:

```powershell
npm run proof:tailoring -- `
  --fixture apps/tailoring-worker/fixtures/application-19.json `
  --application-id 11111111-1111-4111-8111-111111111119 `
  --output apps/tailoring-worker/artifacts/application-19.preview.json
```

The output directory is ignored by Git. The command refuses to overwrite an existing preview. Delete or rename an earlier preview intentionally before rerunning.

Codex runs in an ephemeral, read-only, isolated temporary workspace with user/project configuration ignored. The subprocess receives a minimal environment and no Supabase settings, access token, database password, service-role key, or Resume contact metadata. The JD is explicitly treated as untrusted data. This milestone creates no database records and no DOCX or PDF.
