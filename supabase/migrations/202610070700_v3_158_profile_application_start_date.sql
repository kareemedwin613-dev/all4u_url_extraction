-- Profile Status: Application Start Date is the profile's earliest applied date.

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
  v_admin boolean := public.has_role('ADMIN', auth.uid());
  v_applier boolean := public.has_role('APPLIER', auth.uid());
  v_activity_scoped boolean := (p_to - p_from) <= interval '7 days';
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;
  if not (public.is_active_user(auth.uid()) and (v_admin or v_applier)) then
    raise exception 'APPLICATION_ACCESS_DENIED: Active Applier or Admin access is required.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.total_count desc, x.profile_name, x.id),
    '[]'::jsonb
  )
  into v_rows
  from (
    with actors as (
      select p.id
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      join public.roles r on r.id = ur.role_id
      where r.active and r.code = 'APPLIER'
    ),
    period_apps as (
      select
        a.id,
        a.status,
        a.applied_at,
        a.created_at,
        coalesce(r.resume_type, 'ORIGINAL') as resume_type,
        coalesce(r.parent_resume_id, r.id) as profile_id
      from public.applications a
      join actors ac on ac.id = a.assigned_to
      left join public.resumes r on r.id = a.resume_id
      where coalesce(r.parent_resume_id, r.id) is not null
        and (
          (a.created_at >= p_from and a.created_at < p_to)
          or (a.applied_at >= p_from and a.applied_at < p_to)
          or (
            v_activity_scoped
            and (
              (a.updated_at >= p_from and a.updated_at < p_to and a.updated_at is distinct from a.created_at)
              or exists (
                select 1
                from public.application_status_history h
                where h.application_id = a.id
                  and h.created_at >= p_from
                  and h.created_at < p_to
              )
            )
          )
        )
        and (
          v_admin
          or exists (
            select 1
            from public.applier_resume_profiles arp
            join public.resumes map_r on map_r.id = arp.resume_id
            where arp.applier_user_id = auth.uid()
              and coalesce(map_r.parent_resume_id, map_r.id) = coalesce(r.parent_resume_id, r.id)
          )
        )
    ),
    mapped as (
      select distinct on (coalesce(map_r.parent_resume_id, map_r.id))
        coalesce(map_r.parent_resume_id, map_r.id) as profile_id,
        arp.applier_user_id,
        coalesce(
          case
            when nullif(btrim(p.full_name), '') is not null
              and position('@' in btrim(p.full_name)) = 0
              and lower(btrim(p.full_name)) is distinct from lower(btrim(coalesce(p.email, '')))
            then btrim(p.full_name)
          end,
          nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
          'Unknown Applier'
        ) as applier_name
      from public.applier_resume_profiles arp
      join public.resumes map_r on map_r.id = arp.resume_id
      join public.profiles p on p.id = arp.applier_user_id
      order by coalesce(map_r.parent_resume_id, map_r.id), arp.created_at desc nulls last
    ),
    profile_starts as (
      select
        coalesce(start_resume.parent_resume_id, start_resume.id) as profile_id,
        min(start_app.applied_at) as application_start_at
      from public.applications start_app
      join public.resumes start_resume on start_resume.id = start_app.resume_id
      where start_app.applied_at is not null
        and coalesce(start_resume.parent_resume_id, start_resume.id) is not null
      group by coalesce(start_resume.parent_resume_id, start_resume.id)
    )
    select
      pa.profile_id as id,
      coalesce(
        nullif(btrim(root.candidate_name), ''),
        nullif(btrim(root.resume_name), ''),
        'Unnamed Profile'
      ) as profile_name,
      coalesce(nullif(btrim(root.resume_name), ''), 'Unnamed Resume') as resume_name,
      m.applier_user_id,
      m.applier_name,
      min(ps.application_start_at) as application_start_at,
      root.status as resume_status,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to and pa.status <> 'CANCELLED'
      )::integer as total_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to and pa.status <> 'CANCELLED'
      )::integer as assigned_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from and pa.applied_at < p_to
      )::integer as applied_count,
      count(pa.id) filter (
        where pa.created_at >= p_from
          and pa.created_at < p_to
          and pa.status in ('ASSIGNED', 'IN_PROGRESS')
      )::integer as pending_count,
      count(pa.id) filter (
        where pa.created_at >= p_from
          and pa.created_at < p_to
          and pa.status = 'BLOCKED'
      )::integer as blocked_count,
      count(pa.id) filter (
        where pa.created_at >= p_from
          and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED'
      )::integer as interview_count,
      count(pa.id) filter (
        where pa.created_at >= p_from
          and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED'
          and pa.resume_type = 'TAILORED'
      )::integer as interview_tailored_count,
      count(pa.id) filter (
        where pa.created_at >= p_from
          and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED'
          and pa.resume_type = 'ORIGINAL'
      )::integer as interview_non_tailored_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from
          and pa.applied_at < p_to
          and pa.resume_type = 'TAILORED'
      )::integer as tailored_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from
          and pa.applied_at < p_to
          and pa.resume_type = 'ORIGINAL'
      )::integer as non_tailored_count
    from period_apps pa
    join public.resumes root on root.id = pa.profile_id
    left join mapped m on m.profile_id = pa.profile_id
    left join profile_starts ps on ps.profile_id = pa.profile_id
    group by
      pa.profile_id,
      root.candidate_name,
      root.resume_name,
      root.status,
      m.applier_user_id,
      m.applier_name
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_applier_resume_profile_workload_v31(timestamptz, timestamptz) is
  'Profile workload by resume root. application_start_at is the profile earliest applied_at. resume_status is the original resume Active or Archived state. Applied counts still use submissions in the reporting period.';

notify pgrst, 'reload schema';
