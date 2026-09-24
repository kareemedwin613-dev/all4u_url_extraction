# Bulk saved-JD review and automatic approval (v4)

## Rollout

1. Review pending migrations with `npx supabase db push --dry-run`, then apply them through the normal migration process, including `202609231300_v3_107_ai_review_auto_approve.sql` after v3.104–v3.106. No production migration is applied by the implementation.
2. Deploy the dashboard and update the local worker checkout. Install repository dependencies with `npm ci`. The existing JD review API routes and login mechanism are unchanged.
3. Sign in to the existing Codex CLI with `codex login`. No OpenAI API key or private Supabase key is needed.
4. Select JDs → **Bulk AI Classification** → confirm automatic approval → **Create / resume runner command**.
5. For an older batch, use **Create classification batch from these JDs**. This creates a v4 batch without changing the old comments/history. Failed legacy results are NOT relabeled as successful reviews; they need a fresh AI run, not another human review.
6. Run the generated `npm run jd-review:run -- --batch-ticket "…" --api-base-url "…"` command.
7. Revisit **JD Review Batches** for progress, ETA, **AI reviewed**, **Failed**, comments and before/after changes.

Model remains `gpt-5.6-sol`, medium reasoning, concurrency 2. Model/prompt version are pinned on the batch; local tailoring/matching settings do not override them. Prompt: `apps/jd-review-worker/src/review.mjs`, version `jd-classify-v4`.

## Decisions

- A completed AI review saves supported blank fills and corrections, records the comment/history and automatically sets the JD's existing review status to `APPROVED`. The batch item becomes `AI_REVIEWED` and displays **AI reviewed**. No second manual approval.
- Uncertain optional fields (including salary period) stay unchanged. Other valid edits still save; the comment identifies preserved fields.
- Primary category is exactly one active taxonomy value. Ambiguous classification retains the existing active primary instead of guessing. If neither the response nor existing data has a usable primary, the run fails rather than inventing a category.
- Only Software Engineering uses multiple language/technology subtypes. C# OR Java and C# AND Java both select the supplied C#/.NET and Java tags. Do not select generic role-focused tags. Non-SE primaries clear subtype tags.
- If no supported SE technology tag can be selected, retain existing valid tags or leave an empty set and comment. This no longer blocks AI approval. Application matching rules are unchanged: approval does not guarantee eligible category/subtype matches.
- AI uses the saved description only. No HTML fetching, URL expiration checks, new blocking or unblocking decisions. URL and description are immutable.
- Already assigned applications cause the entire JD to be skipped. Archived/blocked JDs are also skipped.
- Missing source, model failures, malformed response shape and database failures are **Failed**, not “AI reviewed.” They leave JD fields and approval status unchanged. Retry failed items from the batch page; successful items are not retried.
- Concurrent manager edits are preserved, with a failed batch result that can retry against the new data.

The new workflow never emits `NEEDS_ATTENTION` or sets `NEEDS_CORRECTION`. These values remain in historical data and the manual JD review workflow; deleting them globally would erase unrelated history. Old batch failures display **Not completed (legacy)**. No bulk approval/backfill of old failures is performed.

## Validation and audit

The v3 all-or-nothing uncertainty rule and exact-verbatim-quote checks are removed. The response schema restricts primary/subtype IDs to the supplied taxonomy. Unsupported metadata values are omitted individually, with comments, instead of rejecting all valid edits. Database checks still protect IDs, field types, immutable source data, assigned applications, access and leases.

Correctable metadata includes company, title, primary category, SE subtypes, industry/domain, seniority, location, work arrangement, skills, clearance, travel and salary. Company/title changes require explicit support in the saved description according to the prompt. Correct values remain unchanged. No-op tag reordering is not a correction.

Saved changes, approval and audit snapshots commit in one transaction. Comments include the model, prompt version and item ID. They state once that live availability was not checked. AI can still misclassify; uncertain retained fields are not claimed to be verified facts.

No application rows are created, cancelled, updated or unassigned by this workflow.

## Reliability

- The existing background supervisor continues when the terminal closes and retries unexpected exits. Use `npm run workers:status`, `npm run workers:logs -- <run-id> --follow`, and `npm run workers:stop -- <run-id>`.
- Keep the computer awake; this is not an OS service.
- Tickets are hashed, expire after 24 hours and are scoped to the initiating active manager. Replacement commands and cancellation revoke old tickets.
- Five-minute leases reclaim interrupted work. Three abandoned attempts produce **Failed**. Transient model errors get one automatic retry. Persistent quota errors pause the worker instead of failing every JD.
- Logs contain event codes, stages, IDs and timings, not tickets or source/model text.
- Old prompt versions cannot resume under the new worker; create a new batch to keep version history accurate.

## Checks

`npm run test:jd-review` exercises the worker decisions and actual v3.104–v3.107 PostgreSQL migration functions in PGlite, including automatic approval, field-level uncertainty, audit, idempotency, failed retries and legacy preservation. Dashboard tests are in `dashboard/tests/jd-review.test.js`; API tests are in `apps/api/test/jd-review.spec.ts`. These tests do not call live Codex or modify production.
