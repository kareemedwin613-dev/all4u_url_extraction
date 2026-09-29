# Education layout and keyword diagnostics

Education uses existing structured fields or legacy text. Legacy dates are moved
to the right only when a complete line is unambiguously a year or date range.
Source records are never rewritten. Each entry, including wrapped details, is kept
together when it fits on one page. Education has extra line and entry spacing.

The job detail page's **Check coverage** button calls the manager-only
`GET /api/v1/tailoring-jobs/:id/keyword-coverage` endpoint. The diagnostic uses the
immutable job input, saved generated content (excluding the cover letter), and the
actual stored tailored PDF, downloaded with the caller's existing Storage access.
It does not run AI, update a job, reject output, or change approval. Unavailable
PDFs are reported as **Not checked**, never as missing keywords. Coverage is based
on detected JD keywords and a small alias map, not all natural-language JD duties;
presence alone does not prove candidate proficiency. No database migration is needed.

## Deployment verification

After deploying the API and dashboard, `/health` should include:

```json
{"tailoring":{"renderedSkillLimit":80,"educationLayoutVersion":2,"keywordCoverageVersion":1}}
```

`buildCommit` is the Vercel Git commit when available. A response containing only
API version `0.7.2` cannot prove which renderer is deployed. A newly started local
worker can be checked without contacting AI or the database:

```sh
npm --prefix apps/tailoring-worker run run -- --capabilities
```

Expect contract `6` support and `maxSkills: 80`. Workers run locally, not on Vercel;
checking this checkout does not verify a worker running on another machine.

## Existing jobs and #64257

Retry preserves the old prompt/input snapshot. Publishing a prompt or deploying
the renderer does not rebuild already-stored PDFs. A fresh local capture and
regenerated preview for #64257 are in the gitignored directory
`apps/tailoring-worker/artifacts/retailor-64257-20260929/` (private candidate data).
They use Generic prompt revision 7 and output contract 6. The existing production
job, its snapshot, and the assigned PDF were not replaced.

An audited production fresh-attempt workflow is still required before attaching
this replacement. Do not delete the old immutable snapshot, overwrite its Storage
object, or assume the normal retry command refreshes the prompt. Verify the new
deployment before any production replacement.
