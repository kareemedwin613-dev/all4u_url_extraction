-- v2.6: JD Finders may browse only the JDs/URLs they captured themselves.
-- Existing job_descriptions RLS remains authoritative. This helper returns a
-- single self option for JD Finders and the shared attribution list for
-- Applying Managers/Admins.

create or replace function public.list_job_description_capturers()
returns table(id uuid,display_name text,email text,captured_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user(auth.uid()) or not public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN','JD_FINDER']) then
    raise exception 'Only active job-description readers can list capturers.' using errcode='42501';
  end if;

  return query
  select jobs.user_id,
    coalesce(nullif(btrim(profiles.full_name),''),nullif(btrim(legacy.display_name),''),profiles.email,legacy.email,jobs.user_id::text),
    coalesce(nullif(profiles.email,''),nullif(legacy.email,''),''),count(*)::bigint
  from public.job_descriptions jobs
  left join public.profiles profiles on profiles.id=jobs.user_id
  left join public.user_profiles legacy on legacy.id=jobs.user_id
  where public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']) or jobs.user_id=auth.uid()
  group by jobs.user_id,profiles.full_name,profiles.email,legacy.display_name,legacy.email
  order by lower(coalesce(nullif(btrim(profiles.full_name),''),nullif(btrim(legacy.display_name),''),profiles.email,legacy.email,jobs.user_id::text)),jobs.user_id;
end$$;

revoke all on function public.list_job_description_capturers() from public,anon;
grant execute on function public.list_job_description_capturers() to authenticated;

comment on function public.list_job_description_capturers() is
  'Returns only the caller attribution to JD Finders; managers retain the shared captured-by filter.';
