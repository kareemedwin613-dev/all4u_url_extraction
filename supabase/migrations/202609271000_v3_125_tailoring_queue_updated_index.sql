-- v3.125: the Tailored Resumes queue lists the newest 100 tailoring jobs (optionally one status)
-- ordered by updated_at. Without an index on that order, PostgREST's embedded joins ran the
-- application, job description, and resume RLS checks for every job before sorting, which
-- exceeded the 8s statement timeout at ~25k jobs. These indexes let the planner walk the newest
-- jobs first and stop at the limit.

create index if not exists tailoring_jobs_updated_idx
  on public.tailoring_jobs (updated_at desc, id);

create index if not exists tailoring_jobs_status_updated_idx
  on public.tailoring_jobs (status, updated_at desc, id);
