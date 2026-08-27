-- Split Blocked out of Pending on Applier profile workload Overview chart.
create or replace function public.get_applier_resume_profile_workload_v31(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;
  if not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Active Applier access is required.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.total_count desc, x.profile_name, x.id),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      arp.resume_id as id,
      coalesce(
        nullif(btrim(r.candidate_name), ''),
        nullif(btrim(r.resume_name), ''),
        'Unnamed Profile'
      ) as profile_name,
      coalesce(nullif(btrim(r.resume_name), ''), 'Unnamed Resume') as resume_name,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status <> 'CANCELLED'
      )::integer as total_count,
      count(a.id) filter (
        where a.applied_at >= p_from
          and a.applied_at < p_to
      )::integer as applied_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status in ('ASSIGNED', 'IN_PROGRESS')
      )::integer as pending_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status = 'BLOCKED'
      )::integer as blocked_count
    from public.applier_resume_profiles arp
    join public.resumes r on r.id = arp.resume_id
    left join public.resumes app_resume
      on coalesce(app_resume.parent_resume_id, app_resume.id) = arp.resume_id
    left join public.applications a
      on a.resume_id = app_resume.id
      and a.assigned_to = auth.uid()
    where arp.applier_user_id = auth.uid()
    group by arp.resume_id, r.candidate_name, r.resume_name
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz) is
  'Applier-only Overview workload by mapped Resume profile: total, applied, pending, and blocked Applications.';
