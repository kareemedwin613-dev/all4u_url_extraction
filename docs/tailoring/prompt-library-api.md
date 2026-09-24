# Tailoring prompt library API (milestone 2)

Implemented locally; not connected to tailoring workers yet. Apply migration
`202609241000_v3_111_tailoring_prompt_library.sql` before deploying these API routes.
There is no dashboard editor until milestone 3, and publication will not affect
tailoring jobs until milestone 4. No production database changes were made during implementation.

## Access and routes

All routes require a Bearer session for an active `ADMIN` or `APPLYING_MANAGER`.
The API uses the caller's Supabase token, never a service key. Database functions
check the same role requirement; RLS protects reads and client table writes are denied.
Responses use the normal `{ data, requestId }` envelope.

Base path: `/api/v1/tailoring-prompts`.

| Method/path | Purpose | Request body |
| --- | --- | --- |
| `GET /` | List tree metadata, excluding instruction bodies | None |
| `GET /:id` | Get draft, published-version history, and audit events | None |
| `GET /:id/history` | Get versions and audit events | None |
| `POST /` | Create an unpublished draft | Name, instructions, priority, scope, category IDs |
| `PUT /:id/draft` | Replace draft fields without changing published content | Name, instructions, priority, expectedRevision |
| `POST /:id/publish` | Publish draft as a new immutable version | expectedRevision |
| `POST /:id/archive` | Exclude prompt from future selection; preserve history | expectedRevision |
| `POST /:id/restore` | Publish an old version's content/name/priority as a NEW version | expectedRevision, version |
| `POST /preview` | Read-only selection for a JD; does not run a model | jobDescriptionId |

UUID parameters use UUID v4. A prompt's scope/category IDs are fixed at creation;
create a new prompt and archive the old one to change its placement in the tree.

Example create request:

```json
{
  "name": "Java tailoring",
  "instructions": "Use concise bullet points and emphasize Java system design.",
  "priority": 20,
  "scope": "SUBTYPE",
  "primaryCategoryId": "11111111-1111-4111-8111-111111111111",
  "subcategoryId": "22222222-2222-4222-8222-222222222222"
}
```

Use existing active taxonomy IDs. `GENERIC` takes no category IDs. `PRIMARY` takes
only a primary-category ID. `SUBTYPE` takes both, and the subtype must belong to
that primary category. Name: 1–120 trimmed characters; instructions: nonblank,
at most 20,000 characters, stored verbatim; priority: integer 0–100,000 (default 0).

Mutation responses return the full detail with its incremented `revision`.
Send that value as `expectedRevision` on the next edit, publish, archive, or restore.
On `PROMPT_STALE`, reload and reconcile changes; never blindly retry overwriting edits.
Restoring explicitly replaces the working draft and publishes immediately, so the
dashboard should warn about unsaved/draft changes before restoring.

## Response fields

List/detail metadata includes `id`, `scope`, `primary_category_id`, `subcategory_id`,
`draft_name`, `draft_priority`, `draft_pending`, `revision`, `published_version`,
`published_priority`, `archived`, authors, and timestamps. List also includes
`published_name`; detail includes `draft_body`, `versions`, and `events`.

Published versions include `version`, `name`, `body`, `priority`, `contract_version`,
`published_by`, `published_at`, and `restored_from_version`. Audit events record
create/save/publish/archive/restore with actor, revision, version, and timestamp.
Intermediate draft bodies are mutable, not retained as published versions.
Seeded Generic v1 has no human author and a `SEED` event.

Preview returns `promptId`, `name`, `version`, `instructions`, `contractVersion`,
`scope`, `primaryCategoryId`, `subcategoryId`, `priority`, `jobDescriptionId`, and
an explanatory `reason`. It uses the latest published configuration at read time,
not a job snapshot. Job snapshot persistence is milestone 4.

## Publication and selection rules

1. Among the JD's matching published subtype prompts, select the highest priority.
2. Otherwise select its published primary-category default.
3. Otherwise select published Generic.

Read all JD subtype tags, with legacy single-subtype fallback. A high-priority
Generic or primary default never outranks a subtype match. Drafts, archived
definitions, and inactive/mismatched taxonomy are not selected.

At most one active published prompt is allowed for each scope/category/subtype.
Published subtype priorities must be unique within a primary category, even if a
particular JD currently has only one tag. This prevents future multi-tag ambiguity.
Draft conflicts are allowed, but publication rejects them atomically without leaving
a partial version or audit event. Management writes use a transaction-scoped lock,
revision comparison, and unique indexes. Generic cannot be archived while published;
edit and publish its next version instead. An archived prompt can be reactivated by
publishing/restoring a new version if its scope and priority are available.

Published versions and audit events cannot be updated or deleted. Archiving only
changes future selection and retains versions for future job snapshot references.

## Errors and verification

- `400 PROMPT_INVALID`: invalid scope, taxonomy, or content.
- `403 PROMPT_FORBIDDEN`: manager/admin access required.
- `404 PROMPT_NOT_FOUND`, `PROMPT_VERSION_NOT_FOUND`, `PROMPT_JOB_NOT_FOUND`.
- `409 PROMPT_STALE`, `PROMPT_CONFLICT`, `PROMPT_FALLBACK_REQUIRED`.
- Unexpected database failures return a generic `502 DATABASE_ERROR`.

Local verification: executable PostgreSQL/PGlite migration tests cover versions,
selection, priority/scope conflicts, competing requests, RLS, and immutability.
HTTP tests use actual Nest auth/role/validation layers with a stubbed Supabase boundary.
Independent-connection concurrency and deployed end-to-end smoke tests remain part
of milestone 5; PGlite processes statements through one backend.

## Isolated draft tests and saved job prompts (milestones 3-4)

- `POST /api/v1/tailoring-prompts/:id/tests`: manager/admin only, body
  `{ "expectedRevision": 2, "applicationId": "<uuid>" }`. Returns `{run,ticket}`.
- `GET /api/v1/tailoring-prompts/tests/:id`: manager/admin status and result,
  without input or ticket hash.
- `POST /api/v1/tailoring-prompt-test-runner`: capability-only endpoint, body
  `{ticket,action}` (`CLAIM`), `{ticket,action:"SUBMIT",result}`, or
  `{ticket,action:"FAIL",failureCode}`. Tickets have a `tpt_` prefix, expire after
  two hours, and require the creator to retain active manager/admin access.

Tests snapshot the saved draft revision, never publish, and never create/assign a
resume. The local test command loads `apps/tailoring-worker/.env`. Claiming returns
input contract `1.3` with `promptSnapshot.isTest=true`, `version=null`, and
`draftRevision`. Normal jobs use an immutable published numeric version. Both have
fixed compiler contract `2`, exact `composedPrompt`, and `referenceDate`.

New job inputs are snapshotted on creation, not on claim. Current published prompt
selection never overrides an existing job snapshot. Public job metadata uses
`prompt_provenance`; generated resume details use `tailoring_prompt_provenance`.
Neither metadata object contains full prompt text. Legacy jobs retain input `1.2`.
See [rollout instructions and limitations](prompt-rollout.md) before deploying.
