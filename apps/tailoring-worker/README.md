# Resume tailoring worker v1.5

This separately buildable local worker proves the Codex CLI tailoring contract without reading or writing Supabase. It accepts a prepared fixture selected by Application UUID, exposes only the original Resume summary, experience records, and skills to Codex, validates a strict JSON result, and writes a create-only local preview.

v1.3 also supports an authenticated NestJS lifecycle. The worker loads a database-derived, sanitized input and submits only the validated preview. It never connects to Supabase directly.

v1.5 is the normal operator workflow. The dashboard creates a ten-minute, one-job runner ticket and shows the complete command. The worker claims it without a Supabase access token, receives a 30-minute run window, writes a unique local recovery artifact, and submits one validated preview.

## v1.5 one-command mode

1. Sign in to the dashboard as an Applying Manager or Admin.
2. Open an Application and select **Request or View Tailoring**.
3. Select **Create Runner Command** and copy the displayed command.
4. From the repository root, paste and run it. For example:

```powershell
npm run tailoring:run -- --ticket "trt_<short-lived-ticket>" --api-base-url "https://your-dashboard.example"
```

No `TAILORING_ACCESS_TOKEN`, job UUID, or output path is required. The dashboard polls while the job is pending or processing and displays the preview when it reaches `NEEDS_REVIEW`. Creating another command revokes the earlier ticket. Raw tickets are temporary secrets and must not be shared or committed.

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

## Legacy v1.3 API mode

First request an Application tailoring job through `POST /api/v1/tailoring-jobs/application/:applicationId`. Then run the worker with a short-lived authenticated user session:

```powershell
$env:TAILORING_API_BASE_URL="http://localhost:3001"
$env:TAILORING_ACCESS_TOKEN="<current Supabase user access token>"
npm run proof:tailoring -- `
  --job-id 11111111-1111-4111-8111-111111111113 `
  --output apps/tailoring-worker/artifacts/job-111.preview.json
```

The token stays in the parent worker process and is excluded from the Codex subprocess environment. If API submission fails, the validated create-only local artifact remains available for deliberate recovery.

Codex runs in an ephemeral, read-only, isolated temporary workspace with user/project configuration ignored. The subprocess receives a minimal environment and no Supabase settings, access token, database password, service-role key, or Resume contact metadata. The JD is explicitly treated as untrusted data. v1.3 stores validated preview JSON but creates no tailored Resume row and no DOCX or PDF.
