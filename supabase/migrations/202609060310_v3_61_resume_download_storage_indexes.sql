-- v3.61: Speed up Application Resume Storage reads used by signed-URL downloads.
-- Applier SELECT policies join resumes.storage_path = storage.objects.name; without
-- a supporting index those checks scan resumes under Storage pool pressure.

create index if not exists resumes_storage_lookup_idx
  on public.resumes (storage_bucket, storage_path);

create index if not exists applications_assigned_resume_idx
  on public.applications (assigned_to, resume_id);
