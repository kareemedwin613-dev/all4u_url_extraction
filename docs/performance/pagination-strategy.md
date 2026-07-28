# Pagination strategy (v0.7.1)

## Before

Every list in the app used offset pagination: `p_limit`/`p_offset` (RPCs) or `.range(from, to)` (direct table reads), paired with a `count(*)` for the "Showing X–Y of Z" text and numbered-page `<Pagination>` controls. Page sizes were already capped (25/50/100, server-enforced via `least(greatest(...))` in every paginated RPC) before this migration — that part of the spec's ask was already satisfied.

## After

Offset pagination is **unchanged everywhere except the dashboard's Applications list**, which now uses real cursor (keyset) pagination:

- New RPC `list_applications_cursor` — same filters as `list_applications_v07`, fixed order `updated_at desc, id desc` (keyset pagination requires one deterministic order; per-column sorting isn't compatible with it), predicate `(updated_at, id) < (:cursor_updated_at, :cursor_id)`, fetches `limit + 1` rows to compute `hasMore` without a separate `count(*)`.
- `list_applications_v07` (offset-based) is **untouched** — the extension's "My Applications" tab and any other caller keep working exactly as before, unaffected by this addition.
- The dashboard's Applications page (`dashboard/src/features/applications/application-pages.jsx`) now drives a Previous/Next UI from local cursor-stack state instead of `<Pagination>` page numbers.

## Trade-offs this introduces (read before extending this pattern elsewhere)

This was an explicit, informed choice, not a free upgrade — cursor pagination on the Applications page comes with two real regressions worth knowing about:

1. **No more column-header sorting on the Applications list.** Keyset pagination needs one fixed comparison order; the "Sort" filter field and 30-key sort allowlist UI were removed from this page (the underlying `list_applications_v07` RPC still supports all of them, for the extension and any future offset-based consumer). If a specific sort becomes a hard requirement again, the honest options are: (a) maintain a small number of precomputed fixed orders each with their own cursor predicate, or (b) fall back to offset pagination for that view.
2. **No more "jump to page N" or URL-persisted page position.** Cursor state lives in local component state, not the URL — reloading the page or sharing a link always returns to page 1. This is the fundamental trade-off of keyset pagination (there is no way to compute "page 7" without scanning/counting), not an oversight.

## Why not everywhere

`job_descriptions`/`resumes` lists, Admin Users, and Application Batches keep offset pagination. None of these had a demonstrated need for cursor pagination (their row counts and access patterns don't currently justify the sort/URL trade-offs above), and the spec's own scenario list (Section 22) specifically calls out "Applier queue" and "Manager Application list" as the cursor-pagination targets — which the Applications page now covers for both roles through one implementation.

## Bulk preview

Unchanged — `preview_bulk_applications` already returns its full (capped at 2,000-combination) result set in one set-based call, and the dashboard paginates that in-memory array client-side. This is correct as-is: the cap already bounds the payload, and introducing server pagination for a result set the UI needs to filter/select across in full (eligibility review before bulk creation) would just move the same data over multiple round trips instead of one.
