# Application match scoring

This worker scores **original Resume + JD** alignment for the AI-scored Application creation option. It does not tailor resumes, approve candidates, or submit applications to employers. Existing Applications and their tailored files are unchanged.

## Choose a matching method

Single and bulk creation now offer two choices:

- **AI score** (default): candidates share a primary category; a completed score at the configured threshold (currently 70) is required. Subcategories are ignored.
- **Category/subcategory — no AI evaluation**: use the previous v3.68 rule. Any shared primary category qualifies; Software Engineering JDs with a subcategory also require that subcategory on a Resume tech stack. Other categories and Software Engineering JDs without a subcategory use primary-only matching. Eligible pairs can be created immediately, even if the model is unconfigured or an existing score is low/failed.

Both methods require active originals, active/approved JDs, and valid categories. Duplicate-family, banned-company and assignment permissions still apply. Category mode does not queue scoring, poll AI progress, or assign a fake score. It shows `NOT_REQUIRED` with null score/assessment/threshold fields. Switching the selector refreshes candidates and clears old selections; it does not cancel an already-running external scoring command. Revoke that command or stop its worker separately if necessary.

Apply `202609111000_v3_77_application_matching_choice.sql` with `npx supabase db push` after reviewing pending migrations, then deploy/restart the API and dashboard. No scoring-worker change is required for this choice if v3.76 is already installed. Existing API callers default to score-based matching; there is no silent fallback to categories. New Applications and batches record `matching_mode`; old rows remain untouched with null method provenance. Tailored replacements preserve the recorded creation method. A bulk retry key cannot be reused for a different method.

## AI scoring workflow

1. A manager selects approved, active JDs. The initial candidate pool contains only active original Resumes with **any primary category matching the JD's primary category**, using the existing multi-primary tech-stack assignments. Subcategories are ignored. JDs without a valid active primary category require classification first. Existing family duplicates and banned companies remain excluded.
2. The preview reads cached scores; it never makes a model call. Select **Create / resume scoring command** on single or bulk creation. The authenticated API queues unassessed, changed, or failed pairs and issues a ticket scoped to that selection. Pending pairs can get a new command without resetting active leases; completed pairs reuse their scores.
3. Copy and run the command locally, exactly like tailoring. Each claimed job includes both whitelisted source snapshots. The worker makes **one model call per pair**, returning five integer/null ratings, a sufficiency flag and one short summary. It checks numeric integrity and submits the score through `/api/v1/application-match-runner/*`; it never connects directly to Supabase. No separate extraction, document lookup/save, quote checks, fact lists or per-dimension explanations are required. Model calls stay outside the API request.
4. Code calculates a 1–100 score. Required skills weigh 35%, preferred skills 15%, responsibilities 25%, seniority 15%, and domain 10%. A dimension genuinely absent from the JD is excluded and remaining weights are renormalized. Missing candidate evidence is not an absent JD requirement.
5. The preview polls every five seconds while selected pairs are pending. It shows score, component ratings, a short summary, status, and exclusion reason. Historical scores can still show older detailed explanations; new scores do not generate them. New passing pairs become selected; manual deselections remain deselected.
6. Score-mode creation requires a shared primary category and a current completed score **>=70**. The database enforces the selected method for single, bulk, legacy RPC, and direct insertion. Score, threshold, and assessment ID are saved only for score-mode Applications. Replacing an original Resume with its tailored child retains the historical method and score.

No default/fake score is assigned on error. Title-only JDs and skills-only resumes yield `INSUFFICIENT_DATA`; missing source content is skipped before spending a model call. Scoring reads the structured original Resume (summary, skills, experience, education and certificates), not raw file text. All role details and dates are retained. The full JD description is sent once, using structured sections as a fallback when it is empty. Contact fields and explicit demographic fields are not included; narrative text is not a guarantee of complete de-identification.

For a cold pair, model calls drop from three to one and per-pair API calls from six to two (claim job + save result, excluding ticket activation and queue polling). Previously cached document analyses already avoided extraction calls, so this is not a promise of 3x faster batches. Shorter output and fewer sequential requests follow [OpenAI's latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization); measure actual model time with terminal stage logs.

### Updating an existing installation to single-pass scoring

1. Stop the old local matching worker and let its active jobs finish.
2. Apply `202609101060_v3_76_application_matching_direct.sql` via `npx supabase db push` after reviewing pending migrations.
3. Deploy/restart the updated API, then restart the local matching command. This change does not require a dashboard change.
4. Confirm `matching.started` shows `scoringMode: "direct-v1"`. Keep your current model, `MATCHING_CODEX_REASONING_EFFORT=none`, and `MATCHING_CONCURRENCY=2` if already configured; this update does not reset them.

The worker and API negotiate `direct-v1` before claiming work. An old worker cannot consume job attempts against the new protocol. Existing completed scores, ticket scope, weights and the 70 threshold are preserved; this migration does not force rescoring. Restart an unexpired command or generate a new ticket if needed. Legacy extraction helpers/tables remain for history and migration compatibility, but the active worker does not use them.

## Local verification (no credentials, paid calls, or production writes)

Application details now support original/tailored score comparisons (migrations v3.78/v3.79). These are explicitly scoped to an existing Application; duplicate exclusion still applies to creating new Applications. Completed current original scores are reused, and the tailored document receives its own evaluation with the same numeric rubric. Creation eligibility scores are not overwritten. The updated tailoring CLI automatically executes the returned comparison ticket after creating the PDF, using this worker and its `.env` configuration. Older tailored Applications and failed comparisons can generate a replacement command from Application details. No model runs just by opening the page.

From the repository root, after installing root and API dependencies:

```powershell
npm run test:matching
node --test dashboard/tests/application-matching.test.js
npm run test:api
npm run build:api
npm run build:dashboard
npm run matching:run -- --help
```

Matching tests execute the real new migrations in an ephemeral PGlite PostgreSQL database with a minimal schema, existing single-create/family-duplicate/variant functions, and the existing bulk idempotency wrapper. Provider calls are mocked. This does **not** replace staging tests against the complete Supabase schema, RLS, concurrent database connections, and real model outputs.

## Staged rollout

There is deliberately no selected default model or embedded credential. `UNCONFIGURED` blocks new **score-mode** Applications rather than silently using the category rule. Category-mode creation requires an explicit selection and no model configuration.

1. Use a staging Supabase project with the repository's existing migrations applied. Back up production before its eventual rollout. Schedule a quiet maintenance window: pause dashboard polling, captures, workers and other traffic, and let in-flight requests finish. The first migration obtains `NOWAIT` locks on Applications/JDs/Resumes (plus the profile FK parent) before changing anything. These locks remain held through the hash backfill and commit; if a table is busy it fails early with `MATCHING_MIGRATION_BUSY` instead of waiting while holding source-table locks. Apply these migrations in order, through your normal migration process:
   - `202609101000_v3_70_application_matching.sql`
   - `202609101010_v3_71_application_matching_preview.sql`
   - `202609101020_v3_72_application_matching_create.sql`
   - `202609101030_v3_73_application_matching_runner.sql`
   - `202609101040_v3_74_application_matching_runner_issuer.sql`
   - `202609101050_v3_75_application_matching_primary_candidates.sql`
   - `202609101060_v3_76_application_matching_direct.sql`
   - `202609111000_v3_77_application_matching_choice.sql`
2. Install Codex CLI on the private worker host, then run `codex login` and sign in with **ChatGPT**, just like tailoring. Verify with `codex login status`. Choose a model your Codex account supports (for example, the same model you already use successfully for tailoring). No OpenAI API key is required in the default Codex mode. A saved API-key login is deliberately rejected in that mode; there is no automatic paid API fallback.
3. Optional: copy `.env.example` to `apps/matching-worker/.env` for local performance settings. Defaults are `MATCHING_PROVIDER=codex` and `MATCHING_CONCURRENCY=1`. **No Supabase URL, service-role key, publishable key, or user access token is required on the worker.** The API already connects to the same Supabase project as the dashboard using its existing configuration. The ticket supplies the model; `MATCHING_MODEL` is only an optional local assertion.
4. As a database administrator, configure the scoring model in the existing settings row. Replace the placeholder before executing:

   ```sql
   update public.application_match_settings
   set model_id = 'YOUR_CHOSEN_MODEL_ID', threshold = 70
   where singleton;
   ```

5. Deploy the updated API and dashboard together. In single or bulk Application creation, select the JD/original-Resume pairs and click **Create / resume scoring command**. Run the copied command from the repository root with Node 22.9+:

   ```powershell
   npm run matching:run -- --batch-ticket "<ticket-from-dashboard>" --api-base-url "https://your-dashboard-or-api.example"
   ```

   Keep the terminal and machine running until the selection finishes; do not run model work inside an unawaited Vercel request. The process must run as the OS user with the saved Codex ChatGPT login. Concurrency defaults to one for Codex (two for API mode), configurable from one to four. Scoring and tailoring share your Codex account's usage limits; no unlimited usage or faster latency is implied. `--once` drains only immediately available work and exits if only delayed retries remain; omit it for normal runs. The dashboard command supplies the existing API origin. For private automation, `MATCHING_BATCH_TICKET` and `MATCHING_API_BASE_URL` can replace the flags; never commit or share the ticket.
6. Smoke-test one original/JD pair, then a small bulk set. Verify 69 is blocked, 70 qualifies, duplicates are skipped, edited sources need rescoring, and a tailored replacement keeps its original creation score. Existing assignment permissions must still pass. The local worker automatically exits after the ticket's pairs reach terminal states; this does not automatically create Applications.
7. Review real scores on the positive reference cases below before enabling large batches. Then repeat the coordinated rollout in production. No migrations, model configuration, or live model calls are performed by the test commands above.

### Codex provider (default)

The worker invokes `codex exec` using the same saved-login, shell-free Windows launcher approach as tailoring, following [official non-interactive execution guidance](https://learn.chatgpt.com/docs/non-interactive-mode). It activates the ticket to read its model, checks the ChatGPT login before taking any jobs, and pins that model and ChatGPT authentication mode. Single-pass scoring uses a compact numeric JSON schema; the five weights, pair cache and 70 threshold are unchanged. The current protocol requires migrations through **v3.76** and the updated API; earlier applied migrations are not modified.

- The model comes from `application_match_settings.model_id` via the ticket. Optional `MATCHING_MODEL` must match; the worker never silently substitutes a different model. A model change requires a new scoring command; previous assessments remain historical records.
- `MATCHING_CODEX_BIN` optionally selects the CLI executable. If unset, the worker accepts `TAILORING_CODEX_BIN`, then looks for `codex` on PATH. No tailoring code or behavior is changed.
- `MATCHING_CODEX_REASONING_EFFORT` defaults to `low`; supported configuration values are `none`, `low`, `medium`, `high`, and `xhigh`, subject to the selected model's support.
- `MATCHING_CODEX_SERVICE_TIER` defaults to `default`; `auto` and `fast` are explicit options, subject to account/model support. It does not inherit tailoring's Fast setting automatically.
- Each call uses an ephemeral, read-only isolated workspace with user config, shell tools and web search disabled. Source JSON goes through stdin, not shell arguments. The child environment excludes Supabase and API keys. Only the temporary schema and output are written by the worker/CLI, and the worker removes its temporary directory afterward. Ephemeral local sessions are not a promise of zero provider retention; review [authentication and data-handling differences](https://learn.chatgpt.com/docs/auth) before sending real data.
- A call has a 60-second timeout inside a five-minute job lease. No document lease is acquired. Timeout handling terminates the owned CLI process tree. Login/configuration failures stop the worker instead of draining the queue; fix the login/model/CLI and restart, then explicitly retry any failed pair. Rate limits use the existing bounded retry and cooldown behavior.
- Startup logs ticket activation and provider checks, then `matching.started` with provider, model, concurrency, and (for Codex) the configured reasoning effort, service tier and model timeout. These are requested settings, not a claim that a particular service tier was delivered. While waiting for other runners or delayed retries, the worker polls at bounded intervals. It prints `matching.finished` and exits when the selection finishes. No model output or account tokens are printed by the worker.

### Detailed terminal logs

Detailed JSON-line logs are enabled by default. After the single-pass migration/API rollout, restart the local matching command to load the new stage names. Logging itself adds no model calls.

- Every line includes an ISO timestamp. Per-job lines include the assessment `id` and `attempt`, so concurrent jobs can be distinguished.
- `matching.stage.started` / `matching.stage.completed` show only `score.prepare`, `score.generate`, `score.validate`, and `score.save` for normal jobs. Stage durations are in milliseconds. `matching.stage.progress` is emitted every 15 seconds while a stage is still running; it indicates waiting, not a percentage or proof that the model has generated tokens.
- `matching.stage.failed` and `matching.failed` include a safe diagnostic `reason` and schema `field` when available. Examples: `INVALID_RATING_TYPE`, `RATING_OUT_OF_RANGE`, `MODEL_OUTPUT_MISSING`, `MODEL_OUTPUT_EMPTY`, `MODEL_OUTPUT_NOT_JSON`. Types/sizes may be included; offending values and full provider errors are not printed. The stored error code stays `INVALID_MODEL_OUTPUT` for compatibility. There are no active quote/fact-count checks.
- The final `matching.failed` line identifies the original failed stage, even if recording the failure also fails. `failureRecorded` says whether the API acknowledged recording it; `retryScheduled` is true only when that succeeded and the existing retry policy allows another attempt. `retryAfterSeconds` is omitted when no retry was scheduled. A failed reporting request is visible as a separate `failure.report` stage failure.
- `matching.waiting` reports idle polling or model cooldown at most every 15 seconds across the local runner. `matching.queue.retrying` reports transient queue-request failures and delay. `matching.scoring.skipped` identifies insufficient source data.
- `matching.completed` includes the persisted score returned by the server, when available; stale/insufficient results do not log an accepted score. `matching.finished` summarizes local job attempts, model calls, completion/failure counts and total elapsed time. Local `failedAttemptCount` counts attempts, while server `failedCount` describes the ticket's final failures. Cached completed pairs never enter the worker queue. Interruptions or `--once` exits log `matching.paused` instead of claiming the ticket is finished.

Illustrative failure (not a real run):

```json
{"event":"matching.failed","timestamp":"2026-09-11T14:30:00.000Z","id":"example-job","attempt":1,"stage":"score.validate","code":"INVALID_MODEL_OUTPUT","reason":"INVALID_RATING_TYPE","field":"components.requiredSkills.rating","retryable":false,"failureRecorded":true,"retryScheduled":false,"durationMs":12000}
```

Paste the `matching.failed` line and preceding `matching.stage.*` lines when troubleshooting. Do not paste the command itself: npm can echo the batch ticket before the worker starts, even though the worker's logs never include it.

### Optional OpenAI API provider

Set `MATCHING_PROVIDER=openai` and supply `OPENAI_API_KEY` privately on the worker host to explicitly use the previous model API adapter. Configure a Responses Structured Outputs-capable model in database settings. Codex is not invoked in this mode; database access still uses the same limited runner ticket, not a Supabase key.

The API adapter uses strict JSON Schema through Responses `text.format`, `store: false`, a 60-second request timeout, and explicit refusal/incomplete-response handling following the [official structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs). The prompt/schema ask for much less generated text; the existing API token ceiling is unchanged to preserve compatibility with configured models. `store: false` is not a promise of zero provider retention. Allow for separate privacy/retention review when enabling real data.

### Recovering from a failed migration push

- The original `40P01` at `ALTER TABLE applications` came from acquiring an Application lock after source-table DDL locks. The startup lock preflight avoids that ordering on retry. It does not make schema changes lock-free; a maintenance window is still required. PostgreSQL documents the transaction lifetime and fail-fast behavior of [LOCK ... NOWAIT](https://www.postgresql.org/docs/current/sql-lock.html).
- Do not use `db reset`, terminate database sessions, or mark an unsuccessful migration as applied. The failed migration transaction should roll back, while previously committed migrations remain applied. Confirm history/schema before retrying if another person or manual SQL may have changed the database.
- Once connectivity works, use `npx supabase migration list` and `npx supabase db push --dry-run` to check which files remain pending, then `npx supabase db push` during the maintenance window. If `MATCHING_MIGRATION_BUSY` or a lock timeout appears, let existing activity finish and retry; do not remove the lock guard.
- A separate `cannot execute GRANT ROLE in a read-only transaction` during CLI login initialization happens before the migration/query runs. Check the project's database health, read-only settings and disk/database usage in Supabase before retrying. Do not assume it is caused by this deadlock or blindly disable read-only protection. Supabase describes possible resource-limit causes in its [database-size documentation](https://supabase.com/docs/guides/platform/database-size#read-only-mode).
- For `42P13: cannot change name of input parameter "p_job_description_id"`, use the corrected v3.70 migration. Its legacy helper replacement preserves the existing parameter declarations via the PostgreSQL catalog, including deployments whose third parameter is `p_job_description_id` instead of v3.68's `p_subcategory_id`. It replaces only the body without dropping the function, changing its identity, or removing dependent objects. Tests cover both named-call signatures and the optional third-argument default. A matching migration version in history does not guarantee every deployed function definition matches the local file.

### Fresh scoring tickets rejected as invalid

If a freshly copied command fails with `MATCH_TICKET_INVALID` even though its plain-text ticket is correctly formatted, apply `202609101040_v3_74_application_matching_runner_issuer.sql` with `npx supabase db push`. v3.73 incorrectly used caller-bound role helpers to check the stored issuer: those helpers require a user JWT, but ticket requests intentionally have none. v3.74 checks the issuer's active profile and manager/admin assignment inside the private ticket function, leaving general-purpose RLS helpers and ticket scope unchanged. It preserves all existing tickets, assessments and scores; an unexpired command can be retried after the migration. Generate a replacement only if its 15-minute activation window has elapsed. No API/dashboard rebuild or new credential is needed for this database-only correction.

## Cache, retries, and operations

- Only an active Applying Manager/Admin can issue or revoke commands. Tickets are stored hashed, must be activated within 15 minutes, and run for up to 8 hours without extending expiry on repeated claims. Each operation rechecks the issuing manager's active role. Keep commands private: possession authorizes reading/submitting results for their fixed pairs, just like tailoring's bearer tickets. This is scoped authorization, not cryptographic proof that a score came from an AI model.
- A ticket cannot read unrelated source documents, acquire unrelated jobs, or submit results using another ticket's lease. Only essential result checks remain: boolean sufficiency, five integer ratings from 0 to 100 or null, no ratings for insufficient data, and at least one rating for a sufficient result. PostgreSQL computes the weighted total. Optional text is normalized/truncated rather than rejected. Completed identical submissions are idempotent. The unrestricted queue RPCs remain service-only; only the ticket-checking dispatcher is available to the API's anonymous client.
- Use **Revoke this command** to invalidate a copied command and requeue only its currently owned jobs. Other commands and completed scores remain unchanged. If the process crashes, restart the same command before its runtime expires or generate a new one; existing job leases recover after five minutes. New commands do not steal live leases.
- Source hashes cover scoring fields (and the original file hash). Names, statuses, and category labels do not invalidate an assessment; primary-category membership and active/approved/banned/duplicate checks are performed separately at creation. A previously scored pair outside the category pool cannot create a new Application, but its stored score can be reused if its category membership matches again. Threshold changes reuse computed scores.
- Changing model, snapshot/extractor namespace, or rubric versions invalidates pair eligibility. No document analysis is needed. The existing `facts-v1` namespace and `match-v1` rubric remain unchanged because the input snapshots and score weights remain compatible; `direct-v1` separately negotiates the new transport. This does not guarantee identical model ratings: review the reference cases after rollout. Previously stored assessments remain history.
- Queue leases last five minutes. Claims use `SKIP LOCKED`. Source changes in flight discard late results. Obsolete queued snapshots are skipped before spending provider calls.
- Invalid model output is recorded once and **not automatically retried**. Transient network, timeout and rate-limit failures retain bounded exponential backoff and stop after three attempts. The API adapter honors numeric `Retry-After`; Codex rate-limit errors start with a 60-second cooldown. Refusals/auth/config errors are not converted into qualifying scores. A manager can explicitly retry a failed pair.
- Job logs contain timestamps, assessment/document IDs, attempts, stage timings, progress metadata, safe validation diagnostics, retry disposition and persisted scores—not source documents, model output, lease tokens or keys. See **Detailed terminal logs** above. Persistent provider setup failures require fixing the configuration; repeatedly pressing Retry will not resolve them.
- The preview is bounded to 5,000 category-matched pairs and 1,000 JDs. Counts, truncation and Resume options are based on the category-filtered pool, not every JD crossed with every Resume. Narrow Resume/JD selection if it is truncated; scoring and creation controls are blocked until the preview fits. There is no silent first-5,000 creation.
- v3.75 applies this category prefilter before queueing, claiming and creating. Old tickets skip queued pairs outside the pool; model calls already in flight may finish, but a mismatched pair's result is discarded. Existing Applications and completed historical scores are not deleted or changed. Apply the migration and deploy the updated dashboard copy; no worker/model configuration change is required. Category labels are not sent to the model and never add points to the score.
- Rollback is a coordinated deployment decision: stop the worker and revert application code/database functions from reviewed backups. Merely setting `UNCONFIGURED` pauses scoring and blocks score-mode creation; it is not a rollback. Category mode remains an explicit alternative. Do not delete assessment history referenced by Applications.

## Positive reference cases (not yet numerical calibration)

The initial weights and 70 threshold are provisional, not validated probabilities of getting an interview. No negative examples are required for this first rollout, but positives alone cannot measure false-positive rate or establish an optimal cutoff. Interview outcomes are evaluation labels only and are never sent to the scorer.

Read-only reference review identified these `INTERVIEW_SCHEDULED` Applications:

| Application | JD / role | Original Resume | Tailored comparison |
| --- | --- | --- | --- |
| 1836 | BDO / Lead Data Engineer | 11 | — |
| 4465 | Hansei / Senior AI Engineer | 22 | — |
| 8177 | Major Scale / Front End–Product Engineer | 33 | 861 |
| 11781 | Kentech / Lead Platform Architect | 40 | — |
| 13826 | Paylocity / Senior Engineer | 12 | 2818 |
| 13835 | Paylocity / Senior Engineer | 48 | 389 |
| 17857 | Ncontracts / Data Engineer II | 15 | — |
| 18810 | Paylocity / Senior Engineer | 9 | — |
| 21723 | Opplane / Applied AI, Developer Experience | 22 | — |

Use the full user-supplied Opplane and Major Scale JD texts for a private calibration run: their stored JD bodies were incomplete during review. Those production records have **not** been replaced. Keep exported resumes and tailored comparisons private, outside git; use originals for eligibility and inspect tailored versions only to explain presentation changes.

Review expectations, not forced scores:

- Major Scale is a broad mid-to-staff frontend search, not a single mandatory staff role. React/TypeScript/Next.js, product collaboration and UI ownership matter; Node/Python are optional. Original 33 has relevant frontend evidence; tailored 861 foregrounds product/design.
- Opplane combines applied LLM engineering with causal experimentation and quantitative productivity measurement. Original 22 has relevant LLM/tooling/evaluation evidence; that does not itself prove causal-inference/statistics expertise.
- Ncontracts 17857 is a positive despite no explicit original dbt evidence: report the gap, do not make one missing keyword a hard veto. A parser hint of Go inside Google is not a Go requirement.
- BDO includes stack alternatives; Kentech emphasizes architectural judgment. Do not treat alternatives as cumulative requirements or exact framework overlap as the entire match.
- Paylocity tailored 2818 adds skill keywords not clearly evidenced in original 12. Do not use those additions to inflate original eligibility.

All referenced originals had been updated after the application date, so current originals are not proven application-time snapshots. Keep this provenance limitation in any evaluation report. Real-model calibration, latency/cost measurement, and production concurrency testing are still required before claiming production scoring quality.
