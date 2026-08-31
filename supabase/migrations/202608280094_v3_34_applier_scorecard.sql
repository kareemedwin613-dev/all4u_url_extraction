-- v3.34: Single-applier scorecard payload for Admin detail pages.

create or replace function public.get_applier_scorecard_v34(
  p_applier_id uuid,
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
  v_productivity jsonb;
  v_profile_workload jsonb := '[]'::jsonb;
  v_workload_settings jsonb;
  v_profiles jsonb := '[]'::jsonb;
  v_active_count integer := 0;
begin
  perform public.assert_active_admin();

  if p_applier_id is null then
    raise exception 'VALIDATION_ERROR: An Applier id is required.' using errcode = '22023';
  end if;

  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_applier_id
      and exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id
          and r.code = 'APPLIER'
          and r.active
      )
  ) then
    raise exception 'APPLIER_NOT_FOUND: Applier was not found.' using errcode = 'P0001';
  end if;

  select to_jsonb(x)
  into v_productivity
  from (
    with actor as (
      select
        p.id,
        coalesce(
          case
            when nullif(btrim(p.full_name), '') is not null
              and position('@' in btrim(p.full_name)) = 0
              and lower(btrim(p.full_name)) is distinct from lower(btrim(coalesce(p.email, '')))
            then btrim(p.full_name)
          end,
          case
            when nullif(btrim(up.display_name), '') is not null
              and position('@' in btrim(up.display_name)) = 0
              and lower(btrim(up.display_name)) is distinct from lower(btrim(coalesce(p.email, '')))
            then btrim(up.display_name)
          end,
          nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
          'Unknown Applier'
        ) as applier_name,
        p.email,
        p.status as profile_status
      from public.profiles p
      left join public.user_profiles up on up.id = p.id
      where p.id = p_applier_id
    ),
    activity as (
      select
        x.applier_id,
        count(distinct x.activity_day)::integer as active_days,
        max(x.activity_at) as last_activity_at
      from (
        select
          a.assigned_to as applier_id,
          (a.applied_at at time zone 'UTC')::date as activity_day,
          a.applied_at as activity_at
        from public.applications a
        where a.assigned_to = p_applier_id
          and a.applied_at is not null
          and a.applied_at >= p_from
          and a.applied_at < p_to
        union all
        select
          a.assigned_to,
          (a.updated_at at time zone 'UTC')::date,
          a.updated_at
        from public.applications a
        where a.assigned_to = p_applier_id
          and a.updated_at >= p_from
          and a.updated_at < p_to
          and a.updated_at is distinct from a.created_at
        union all
        select
          h.changed_by,
          (h.created_at at time zone 'UTC')::date,
          h.created_at
        from public.application_status_history h
        where h.changed_by = p_applier_id
          and h.created_at >= p_from
          and h.created_at < p_to
      ) x
      group by x.applier_id
    )
    select
      p.id,
      p.applier_name,
      p.email,
      p.profile_status,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status <> 'CANCELLED'
      )::integer as assigned_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
      )::integer as active_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status in ('ASSIGNED', 'IN_PROGRESS')
      )::integer as pending_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status = 'BLOCKED'
      )::integer as blocked_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status in (
            'APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED',
            'REJECTED', 'WITHDRAWN', 'CLOSED'
          )
      )::integer as completed_count,
      count(a.id) filter (
        where a.applied_at >= p_from
          and a.applied_at < p_to
      )::integer as applied_count,
      case
        when count(a.id) filter (
          where a.created_at >= p_from
            and a.created_at < p_to
            and a.status <> 'CANCELLED'
        ) = 0 then 0
        else round(
          100.0 * count(a.id) filter (
            where a.created_at >= p_from
              and a.created_at < p_to
              and a.status in (
                'APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED',
                'REJECTED', 'WITHDRAWN', 'CLOSED'
              )
          ) / count(a.id) filter (
            where a.created_at >= p_from
              and a.created_at < p_to
              and a.status <> 'CANCELLED'
          ),
          1
        )
      end as completion_rate,
      coalesce(act.active_days, 0) as active_days,
      act.last_activity_at,
      case
        when coalesce(act.active_days, 0) = 0 then 0
        else round(
          count(a.id) filter (
            where a.applied_at >= p_from
              and a.applied_at < p_to
          )::numeric / act.active_days,
          1
        )
      end as avg_per_day
    from actor p
    left join public.applications a on a.assigned_to = p.id
    left join activity act on act.applier_id = p.id
    group by
      p.id,
      p.applier_name,
      p.email,
      p.profile_status,
      act.active_days,
      act.last_activity_at
  ) x;

  select coalesce(
    jsonb_agg(to_jsonb(row) order by row.total_count desc, row.profile_name, row.id),
    '[]'::jsonb
  )
  into v_profile_workload
  from (
    select
      arp.resume_id as id,
      coalesce(
        nullif(btrim(r.candidate_name), ''),
        nullif(btrim(r.resume_name), ''),
        'Unnamed Profile'
      ) as profile_name,
      coalesce(nullif(btrim(r.resume_name), ''), 'Unnamed Resume') as resume_name,
      arp.applier_user_id as applier_user_id,
      coalesce(
        case
          when nullif(btrim(p.full_name), '') is not null
            and position('@' in btrim(p.full_name)) = 0
            and lower(btrim(p.full_name)) is distinct from lower(btrim(coalesce(p.email, '')))
          then btrim(p.full_name)
        end,
        nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
        'Unknown Applier'
      ) as applier_name,
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
      )::integer as blocked_count,
      count(a.id) filter (
        where a.created_at >= p_from
          and a.created_at < p_to
          and a.status = 'INTERVIEW_SCHEDULED'
      )::integer as interview_count
    from public.applier_resume_profiles arp
    join public.resumes r on r.id = arp.resume_id
    join public.profiles p on p.id = arp.applier_user_id
    left join public.resumes app_resume
      on coalesce(app_resume.parent_resume_id, app_resume.id) = arp.resume_id
    left join public.applications a
      on a.resume_id = app_resume.id
    where arp.applier_user_id = p_applier_id
    group by
      arp.resume_id,
      r.candidate_name,
      r.resume_name,
      arp.applier_user_id,
      p.full_name,
      p.email
  ) row;

  select count(*)::integer
  into v_active_count
  from public.applications a
  where a.assigned_to = p_applier_id
    and a.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED');

  select jsonb_build_object(
    'userId', p.id,
    'fullName', coalesce(nullif(p.full_name, ''), p.email),
    'email', p.email,
    'isAvailable', coalesce(s.is_available, true),
    'maxActiveApplications', coalesce(s.max_active_applications, 50),
    'usesDefaultSettings', s.user_id is null,
    'activeApplicationCount', v_active_count,
    'remainingCapacity', greatest(0, coalesce(s.max_active_applications, 50) - v_active_count),
    'updatedBy', s.updated_by,
    'createdAt', s.created_at,
    'updatedAt', s.updated_at
  )
  into v_workload_settings
  from public.profiles p
  left join public.applier_workload_settings s on s.user_id = p.id
  where p.id = p_applier_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'applierUserId', m.applier_user_id,
        'resumeId', m.resume_id,
        'resumeNumber', r.resume_number,
        'resumeName', r.resume_name,
        'candidateName', r.candidate_name,
        'status', r.status,
        'resumeType', r.resume_type,
        'createdBy', m.created_by,
        'createdAt', m.created_at
      )
      order by r.candidate_name, r.resume_name, m.resume_id
    ),
    '[]'::jsonb
  )
  into v_profiles
  from public.applier_resume_profiles m
  join public.resumes r on r.id = m.resume_id
  where m.applier_user_id = p_applier_id;

  return jsonb_build_object(
    'productivity', v_productivity,
    'profileWorkload', v_profile_workload,
    'workloadSettings', v_workload_settings,
    'profiles', v_profiles
  );
end;
$$;

revoke all on function public.get_applier_scorecard_v34(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_applier_scorecard_v34(uuid, timestamptz, timestamptz) to authenticated;

comment on function public.get_applier_scorecard_v34(uuid, timestamptz, timestamptz) is
  'Admin scorecard payload for one Applier: productivity metrics, profile workload, settings, and mapped profiles.';
