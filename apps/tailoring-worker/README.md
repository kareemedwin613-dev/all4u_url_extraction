# Resume tailoring worker v1.5

This separately buildable local worker proves the Codex CLI tailoring contract without reading or writing Supabase. It accepts a prepared fixture selected by Application UUID, exposes only the original Resume summary, experience records, and skills to Codex, validates a strict JSON result, and writes a create-only local preview.

v1.3 also supports an authenticated NestJS lifecycle. The worker loads a database-derived, sanitized input and submits only the validated preview. It never connects to Supabase directly.

v1.5 is the normal operator workflow. The dashboard creates a ten-minute, one-job runner ticket and shows the complete command. The worker claims it without a Supabase access token, receives a 30-minute run window, writes a unique local recovery artifact, and submits one validated preview. The API then automatically approves it, randomly chooses one of the twelve ATS-safe templates, renders a clean PDF, creates the TAILORED child Resume, and assigns it to the Application.

## v1.5 one-command mode

1. Sign in to the dashboard as an Applying Manager or Admin.
2. Open an Application and select **Request or View Tailoring**.
3. Select **Create Runner Command** and copy the displayed command.
4. From the repository root, paste and run it. For example:

```powershell
npm run tailoring:run -- --ticket "trt_<short-lived-ticket>" --api-base-url "https://your-dashboard.example"
```

No `TAILORING_ACCESS_TOKEN`, job UUID, or output path is required. The dashboard polls while the job is pending, processing, or materializing and exposes the completed Resume when ready. Creating another command revokes the earlier ticket. Raw tickets are temporary secrets and must not be shared or committed.

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

Generated previews pass only structural validation before they can be saved or submitted. The worker protects the output shape, preserves the exact source-experience ID/count/order mapping used to render employer, title, and date fields, and rejects refusals. Skills, facts, metrics, project narratives, outcomes, keyword coverage, bullet style/count, action verbs, wording similarity, summary length, and warning content are not quality-gated.

The preview retains one prioritized flat `skills` list capped at 80 items for ATS coverage and adds `skillGroups` for readable category-aligned PDF rendering. Exact JD skills come first, followed by candidate fundamentals and project-essential additions. Missing or legacy group metadata is reconciled automatically without changing the database schema.

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

Codex runs in an ephemeral, read-only, isolated temporary workspace with user/project configuration ignored. The subprocess receives a minimal environment and no Supabase settings, access token, database password, service-role key, or Resume contact metadata. The JD is explicitly treated as untrusted data. A successful API submission immediately creates the tailored Resume artifact; fixture-only proof mode still writes only local preview JSON.

On Windows, the worker safely resolves the npm `codex.cmd` shim to `@openai/codex/bin/codex.js` and launches it with the current Node executable. This avoids `spawn codex.exe ENOENT` without invoking a command shell. `TAILORING_CODEX_BIN` remains available for an explicit native Codex executable path.

Tailoring defaults to the efficient `TAILORING_CODEX_MODEL=gpt-5.6-luna`, `TAILORING_CODEX_REASONING_EFFORT=none`, disabled reasoning summaries, and `TAILORING_CODEX_SERVICE_TIER=fast` because generation is schema-bound, high-volume, and tool-free. Override the model with `gpt-5.6-terra` or `gpt-5.6-sol`, or set reasoning to `low`, `medium`, `high`, or `xhigh`, when a different latency/quality tradeoff is needed. Set the service tier to `default` or `auto` to opt out of Fast priority processing.

For a bounded bulk run, select up to five pending jobs in **Tailoring**, create the bulk runner command, and run it once from the repository root. The command uses `--tickets "ticket-1,ticket-2"`, isolates failures, and automatically creates every successful Application Resume.

## v2.1 resumable batch mode

For operational batches, select up to 500 Applications on the Applications page and choose **Tailor Selected**. Open the resulting **Tailoring Batch**, create the runner command, and run it once:

```powershell
npm run tailoring:run -- --batch-ticket "trb_<short-lived-ticket>" --api-base-url "https://your-dashboard.example"
```

The worker leases and processes two items concurrently by default. Set `TAILORING_BATCH_CONCURRENCY=1`, `2`, or `3`, or pass `--concurrency 1|2|3`; two is the recommended balance. Each item keeps an independent lease and recovery artifact, automatically approves a structurally valid result, selects a template independently at random, and materializes the Application Resume. Provider rate-limit responses stop new leases during the exponential 30–900 second cooldown and resume automatically while the runner remains open. The dashboard shows each item's attempt count, failure stage/code, sanitized message, duration, and retry eligibility.

If the terminal closes, create a replacement command from the same batch. The server revokes the old capability and safely requeues its leased item. Validation failures are not automatically retried; other transient worker/API failures can be selected for retry from the batch page.
