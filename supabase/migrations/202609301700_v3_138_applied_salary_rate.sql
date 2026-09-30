-- Per-user Applied salary rate, plus Searched URL credit on Overview salary.
-- Salary = rate × Applied + $1.00 × Interviews − $0.50 × Mistakes + $0.05 × Searched URLs.
-- Searched URLs are Job Descriptions captured by that user during the reporting period.

alter table public.profiles
  add column if not exists applied_salary_rate numeric(4,2) not null default 0.06;

alter table public.profiles
  drop constraint if exists profiles_applied_salary_rate_range;

alter table public.profiles
  add constraint profiles_applied_salary_rate_range
  check (applied_salary_rate >= 0 and applied_salary_rate <= 99.99);

comment on column public.profiles.applied_salary_rate is
  'Dollars paid per Applied application in Overview salary. Default 0.06.';

create or replace function public.admin_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_roles text[];
begin
  perform public.assert_active_admin();
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[])
  into v_roles
  from public.user_roles as assignments
  join public.roles as roles on roles.id = assignments.role_id
  where assignments.user_id = p_user_id;
  return jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'status', v_profile.status,
    'roles', to_jsonb(v_roles),
    'createdAt', v_profile.created_at,
    'updatedAt', v_profile.updated_at,
    'hasAvatar', v_profile.avatar_storage_path is not null,
    'avatarUpdatedAt', v_profile.avatar_updated_at,
    'appliedSalaryRate', v_profile.applied_salary_rate
  );
end;
$$;

create or replace function public.admin_set_applied_salary_rate(p_user_id uuid, p_rate numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
begin
  perform public.assert_active_admin();
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 99.99 or p_rate <> round(p_rate, 2) then
    raise exception 'VALIDATION_ERROR: Salary per Applied application must be from 0.00 to 99.99.' using errcode = '22023';
  end if;
  update public.profiles
  set applied_salary_rate = round(p_rate, 2)
  where id = p_user_id
  returning * into v_profile;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_profile.id,
    'appliedSalaryRate', v_profile.applied_salary_rate
  );
end;
$$;

revoke all on function public.admin_set_applied_salary_rate(uuid, numeric) from public, anon;
grant execute on function public.admin_set_applied_salary_rate(uuid, numeric) to authenticated;

comment on function public.admin_set_applied_salary_rate(uuid, numeric) is
  'Admin-only update of the per-user Applied salary rate used by Overview.';

-- Applier Productivity salary inputs, including the per-user Applied rate and Searched URLs.

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
        p.status profile_status,
        coalesce(p.applied_salary_rate, 0.06) applied_salary_rate
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
    ),
    mistakes as (
      select a.assigned_to as applier_id,
        count(*)::integer as mistakes_count
      from public.applications a
      inner join actors ac on ac.id = a.assigned_to
      where nullif(btrim(a.screenshot_feedback), '') is not null
        and a.screenshot_feedback_at is not null
        and a.screenshot_feedback_at >= p_from
        and a.screenshot_feedback_at < p_to
      group by a.assigned_to
    ),
    searched as (
      select j.user_id as applier_id,
        count(*)::integer as searched_urls_count
      from public.job_descriptions j
      inner join actors ac on ac.id = j.user_id
      where j.created_at >= p_from
        and j.created_at < p_to
      group by j.user_id
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
      coalesce(mk.mistakes_count, 0)::integer mistakes_count,
      coalesce(p.applied_salary_rate, 0.06) applied_salary_rate,
      coalesce(su.searched_urls_count, 0)::integer searched_urls_count,
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
    left join mistakes mk on mk.applier_id = p.id
    left join searched su on su.applier_id = p.id
    group by p.id, p.applier_name, p.email, p.profile_status, p.applied_salary_rate, act.active_days, act.last_activity_at, mk.mistakes_count, su.searched_urls_count
  ) x;
  return jsonb_set(v_result, '{applierPerformance}', v_appliers, true);
end;
$$;

revoke all on function public.get_business_overview_v31(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_business_overview_v31(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_business_overview_v31(timestamptz, timestamptz) is
  'Business overview Applier productivity salary: per-user Applied rate, interviews, screenshot mistakes, and searched URLs.';
