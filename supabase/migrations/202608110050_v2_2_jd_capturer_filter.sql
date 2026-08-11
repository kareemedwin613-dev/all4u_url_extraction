-- v2.2: controlled capturer options for the Job Descriptions filter.
-- The function exposes only attribution already attached to shared JDs and
-- explicitly enforces the same business roles as the JD read policy.

create or replace function public.list_job_description_capturers()
returns table (
  id uuid,
  display_name text,
  email text,
  captured_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role(array['APPLIER', 'APPLYING_MANAGER', 'ADMIN']) then
    raise exception 'Only active business users can list job-description capturers.'
      using errcode = '42501';
  end if;

  return query
  select
    jobs.user_id,
    coalesce(nullif(btrim(profiles.full_name), ''), nullif(btrim(legacy.display_name), ''), profiles.email, legacy.email, jobs.user_id::text),
    coalesce(nullif(profiles.email, ''), nullif(legacy.email, ''), ''),
    count(*)::bigint
  from public.job_descriptions as jobs
  left join public.profiles as profiles on profiles.id = jobs.user_id
  left join public.user_profiles as legacy on legacy.id = jobs.user_id
  group by jobs.user_id, profiles.full_name, profiles.email, legacy.display_name, legacy.email
  order by lower(coalesce(nullif(btrim(profiles.full_name), ''), nullif(btrim(legacy.display_name), ''), profiles.email, legacy.email, jobs.user_id::text)), jobs.user_id;
end;
$$;

revoke all on function public.list_job_description_capturers() from public, anon;
grant execute on function public.list_job_description_capturers() to authenticated;
