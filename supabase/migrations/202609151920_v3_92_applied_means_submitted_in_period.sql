-- Applied = submitted in period (applied_at), including apps that later moved to
-- Interview Scheduled / Offer / Rejected / etc. Tailored splits follow the same rule.
-- Activity Overview status donut keeps status_applied for the exclusive Applied slice.

create or replace function public.get_application_counts_v29(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager boolean;
  v_activity_scoped boolean := (p_to - p_from) <= interval '7 days';
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;
  v_manager := public.application_actor_can_manage();
  if not v_manager
    and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.'
      using errcode = '42501';
  end if;
  with visible as (
    select a.*, coalesce(r.resume_type, 'ORIGINAL') as resume_type
    from public.applications a
    left join public.resumes r on r.id = a.resume_id
    where (v_manager or a.assigned_to = auth.uid())
      and (
        (a.created_at >= p_from and a.created_at < p_to)
        or (
          v_activity_scoped
          and (
            (a.applied_at >= p_from and a.applied_at < p_to)
            or (a.updated_at >= p_from and a.updated_at < p_to and a.updated_at is distinct from a.created_at)
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
  ),
  submitted as (
    select
      count(*)::integer as applied_count,
      count(*) filter (
        where coalesce(r.resume_type, 'ORIGINAL') = 'TAILORED'
      )::integer as tailored_count,
      count(*) filter (
        where coalesce(r.resume_type, 'ORIGINAL') = 'ORIGINAL'
      )::integer as non_tailored_count
    from public.applications a
    left join public.resumes r on r.id = a.resume_id
    where (v_manager or a.assigned_to = auth.uid())
      and a.applied_at >= p_from
      and a.applied_at < p_to
  )
  select jsonb_build_object(
    'assigned', count(*),
    case when v_manager then 'total' else 'my_assigned' end, count(*),
    'unassigned', count(*) filter (where status = 'UNASSIGNED'),
    'pending', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS')),
    'applied', (select applied_count from submitted),
    'applied_count', (select applied_count from submitted),
    'status_applied', count(*) filter (where status = 'APPLIED'),
    'applied_status', count(*) filter (where status in ('APPLIED', 'SCREENING')),
    'screening', count(*) filter (where status = 'SCREENING'),
    'blocked', count(*) filter (where status = 'BLOCKED'),
    'interviews', count(*) filter (where status = 'INTERVIEW_SCHEDULED'),
    'closed_status', count(*) filter (
      where status in ('CLOSED', 'WITHDRAWN', 'REJECTED', 'OFFER_RECEIVED')
    ),
    'cancelled_status', count(*) filter (where status = 'CANCELLED'),
    'due_today', count(*) filter (
      where due_at >= date_trunc('day', now())
        and due_at < date_trunc('day', now()) + interval '1 day'
        and status not in ('CLOSED', 'CANCELLED')
    ),
    'in_progress', count(*) filter (where status = 'IN_PROGRESS'),
    'overdue', count(*) filter (
      where due_at < now() and status not in ('CLOSED', 'CANCELLED')
    ),
    'applied_today', (select applied_count from submitted),
    'tailored', (select tailored_count from submitted),
    'non_tailored', (select non_tailored_count from submitted),
    'interviews_tailored', count(*) filter (
      where status = 'INTERVIEW_SCHEDULED' and resume_type = 'TAILORED'
    ),
    'interviews_non_tailored', count(*) filter (
      where status = 'INTERVIEW_SCHEDULED' and resume_type = 'ORIGINAL'
    )
  )
  into v_result
  from visible;

  return v_result;
end;
$$;

revoke all on function public.get_application_counts_v29(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_application_counts_v29(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_application_counts_v29(timestamptz, timestamptz) is
  'Application summary. Applied/tailored/non-tailored use applied_at (submitted in period); status_applied is current-status Applied for Activity Overview.';

create or replace function public.get_business_overview_v31(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_manager boolean := public.has_role('APPLYING_MANAGER') or public.has_role('ADMIN');
  v_appliers jsonb := '[]'::jsonb;
  v_activity_scoped boolean := (p_to - p_from) <= interval '7 days';
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;
  v_result := public.get_business_overview_v30(p_from, p_to);
  if not v_manager then
    return v_result;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.applied_count desc, x.active_days desc, x.applier_name), '[]'::jsonb)
  into v_appliers
  from (
    with actors as (
      select distinct p.id,
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
        ) applier_name,
        p.email,
        p.status profile_status
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      join public.roles r on r.id = ur.role_id
      left join public.user_profiles up on up.id = p.id
      where r.active and r.code = 'APPLIER'
    ),
    activity as (
      select x.applier_id,
        count(distinct x.activity_day)::integer active_days,
        max(x.activity_at) last_activity_at
      from (
        select a.assigned_to applier_id, (a.applied_at at time zone 'UTC')::date activity_day, a.applied_at activity_at
        from public.applications a
        where a.assigned_to is not null and a.applied_at is not null and a.applied_at >= p_from and a.applied_at < p_to
        union all
        select a.assigned_to, (a.updated_at at time zone 'UTC')::date, a.updated_at
        from public.applications a
        where a.assigned_to is not null and a.updated_at >= p_from and a.updated_at < p_to and a.updated_at is distinct from a.created_at
        union all
        select h.changed_by, (h.created_at at time zone 'UTC')::date, h.created_at
        from public.application_status_history h
        where h.changed_by is not null and h.created_at >= p_from and h.created_at < p_to
      ) x
      inner join actors ac on ac.id = x.applier_id
      group by x.applier_id
    ),
    period_apps as (
      select a.id, a.assigned_to, a.status, a.applied_at, a.created_at,
        coalesce(r.resume_type, 'ORIGINAL') as resume_type
      from public.applications a
      left join public.resumes r on r.id = a.resume_id
      where a.assigned_to is not null
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
    )
    select p.id, p.applier_name, p.email, p.profile_status,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to and pa.status <> 'CANCELLED'
      )::integer assigned_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
      )::integer active_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status in ('ASSIGNED', 'IN_PROGRESS')
      )::integer pending_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to and pa.status = 'BLOCKED'
      )::integer blocked_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED'
      )::integer interviews_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED' and pa.resume_type = 'TAILORED'
      )::integer interviews_tailored_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status = 'INTERVIEW_SCHEDULED' and pa.resume_type = 'ORIGINAL'
      )::integer interviews_non_tailored_count,
      count(pa.id) filter (
        where pa.created_at >= p_from and pa.created_at < p_to
          and pa.status in ('APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED', 'REJECTED', 'WITHDRAWN', 'CLOSED')
      )::integer completed_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from and pa.applied_at < p_to
      )::integer applied_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from and pa.applied_at < p_to and pa.resume_type = 'TAILORED'
      )::integer tailored_count,
      count(pa.id) filter (
        where pa.applied_at >= p_from and pa.applied_at < p_to and pa.resume_type = 'ORIGINAL'
      )::integer non_tailored_count,
      case
        when count(pa.id) filter (
          where pa.created_at >= p_from and pa.created_at < p_to and pa.status <> 'CANCELLED'
        ) = 0 then 0
        else round(
          100.0 * count(pa.id) filter (
            where pa.created_at >= p_from and pa.created_at < p_to
              and pa.status in ('APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED', 'REJECTED', 'WITHDRAWN', 'CLOSED')
          ) / count(pa.id) filter (
            where pa.created_at >= p_from and pa.created_at < p_to and pa.status <> 'CANCELLED'
          ),
          1
        )
      end completion_rate,
      coalesce(act.active_days, 0) active_days,
      act.last_activity_at,
      case
        when coalesce(act.active_days, 0) = 0 then 0
        else round(
          count(pa.id) filter (
            where pa.applied_at >= p_from and pa.applied_at < p_to
          )::numeric / act.active_days,
          1
        )
      end avg_per_day
    from actors p
    left join period_apps pa on pa.assigned_to = p.id
    left join activity act on act.applier_id = p.id
    group by p.id, p.applier_name, p.email, p.profile_status, act.active_days, act.last_activity_at
  ) x;
  return jsonb_set(v_result, '{applierPerformance}', v_appliers, true);
end;
$$;

revoke all on function public.get_business_overview_v31(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_business_overview_v31(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_business_overview_v31(timestamptz, timestamptz) is
  'Business overview Applier productivity. Applied/tailored/non-tailored count submissions by applied_at, including later Interview/Offer/etc. statuses.';

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
    group by
      pa.profile_id,
      root.candidate_name,
      root.resume_name,
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
  'Profile workload by resume root. Applied/tailored/non-tailored use applied_at submissions, including later Interview/Offer/etc. statuses.';
