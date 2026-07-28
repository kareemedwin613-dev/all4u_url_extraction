# Data retention planning (v0.7.1)

Planning placeholders only. **No data is deleted, moved, or archived by this milestone** — this document exists to record open questions for a future, explicitly-approved retention milestone, per the spec's own boundary.

## Closed Applications

- Question: how long should a `CLOSED`/`WITHDRAWN`/`REJECTED` Application (and its `application_status_history`/`application_assignment_history` rows) remain in the primary `applications` table before it's a candidate for archival?
- Constraint: `application_number` is a permanent, unique, sequential identifier (`202607240015_application_tracking_number.sql`) — any future archival design must preserve number lookups even for archived rows, or explicitly document that archived Applications become unsearchable by number.

## Old Job Descriptions / Resumes

- Question: do JDs/Resumes with no Application ever created against them (or only Applications that are all closed) become candidates for archival? `applications_job_resume_key` is a unique constraint on `(job_description_id, resume_id)` — deleting a JD/Resume that still has Application rows is already blocked by `on delete restrict` on both foreign keys, so any future archival needs a defined path for what happens to dependent Applications first.

## Histories

- `application_status_history`/`application_assignment_history` are append-only and already indexed by `(application_id, created_at desc)` (unchanged this migration — already correct). These will be the fastest-growing tables in the schema. Documented future partition candidates (not implemented, per spec Section 19): partition both by `created_at` (e.g. monthly range partitions), which would let old partitions be detached/archived without touching live query performance.
- `application_screenshots` (new this session, in the prior `application_screenshots` migration) will also grow append-mostly; the same partition-by-`created_at` option applies if it becomes large, alongside a Storage-side lifecycle rule for the underlying files.

## Candidate privacy

- `resumes.candidate_email`/`candidate_phone` (added in `202607240014_resume_candidate_identity.sql` for duplicate-candidate detection) are the most privacy-sensitive columns in the schema. Any future retention/deletion policy needs an explicit answer for candidate-initiated deletion requests (right-to-erasure style), which is out of scope here but should be a required input to whatever retention milestone follows this one.

## Archive access

- Open question, not decided here: if/when archival ships, does an Admin need read access to archived data through the same dashboard, a separate read-only view, or an out-of-band export? This has UI and RLS implications significant enough to warrant its own planning pass rather than a guess folded into this document.

## What this migration explicitly does NOT do

No `delete`, no `truncate`, no data movement, no partitioning, no archiving. `alter table ... add column` (`search_vector`, trigger-maintained) and index changes are the only DDL against existing tables with data in them, and both are additive/non-destructive (documented in `index-strategy.md`/`search-strategy.md`).
