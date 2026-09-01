-- Overview short windows (Today / This Week): count Applications with activity in the period,
-- not only rows created in the period.

create or replace function public.get_business_overview_v31(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_result jsonb;
  v_manager boolean:=public.has_role('APPLYING_MANAGER')or public.has_role('ADMIN');
  v_appliers jsonb:='[]'::jsonb;
  v_activity_scoped boolean := (p_to - p_from) <= interval '7 days';
begin
  if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.' using errcode='22023';
  end if;
  v_result:=public.get_business_overview_v30(p_from,p_to);
  if not v_manager then
    return v_result;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.applied_count desc,x.active_days desc,x.applier_name),'[]'::jsonb)into v_appliers from(
    with actors as(
      select distinct p.id,
        coalesce(
          case
            when nullif(btrim(p.full_name),'') is not null
              and position('@' in btrim(p.full_name))=0
              and lower(btrim(p.full_name)) is distinct from lower(btrim(coalesce(p.email,'')))
            then btrim(p.full_name)
          end,
          case
            when nullif(btrim(up.display_name),'') is not null
              and position('@' in btrim(up.display_name))=0
              and lower(btrim(up.display_name)) is distinct from lower(btrim(coalesce(p.email,'')))
            then btrim(up.display_name)
          end,
          nullif(split_part(coalesce(p.email,''),'@',1),''),
          'Unknown Applier'
        )applier_name,
        p.email,
        p.status profile_status
      from public.profiles p
      join public.user_roles ur on ur.user_id=p.id
      join public.roles r on r.id=ur.role_id
      left join public.user_profiles up on up.id=p.id
      where r.active and r.code='APPLIER'
    ),
    activity as(
      select x.applier_id,
        count(distinct x.activity_day)::integer active_days,
        max(x.activity_at) last_activity_at
      from(
        select a.assigned_to applier_id,(a.applied_at at time zone 'UTC')::date activity_day,a.applied_at activity_at
        from public.applications a
        where a.assigned_to is not null and a.applied_at is not null and a.applied_at>=p_from and a.applied_at<p_to
        union all
        select a.assigned_to,(a.updated_at at time zone 'UTC')::date,a.updated_at
        from public.applications a
        where a.assigned_to is not null and a.updated_at>=p_from and a.updated_at<p_to and a.updated_at is distinct from a.created_at
        union all
        select h.changed_by,(h.created_at at time zone 'UTC')::date,h.created_at
        from public.application_status_history h
        where h.changed_by is not null and h.created_at>=p_from and h.created_at<p_to
      )x
      inner join actors ac on ac.id=x.applier_id
      group by x.applier_id
    ),
    period_apps as(
      select a.id,a.assigned_to,a.status,a.applied_at,a.created_at
      from public.applications a
      where a.assigned_to is not null
        and (
          (a.created_at>=p_from and a.created_at<p_to)
          or (
            v_activity_scoped
            and (
              (a.applied_at>=p_from and a.applied_at<p_to)
              or (a.updated_at>=p_from and a.updated_at<p_to and a.updated_at is distinct from a.created_at)
              or exists(
                select 1
                from public.application_status_history h
                where h.application_id=a.id
                  and h.created_at>=p_from
                  and h.created_at<p_to
              )
            )
          )
        )
    )
    select p.id,p.applier_name,p.email,p.profile_status,
      count(pa.id)filter(where pa.status<>'CANCELLED')::integer assigned_count,
      count(pa.id)filter(where pa.status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_count,
      count(pa.id)filter(where pa.status in('ASSIGNED','IN_PROGRESS'))::integer pending_count,
      count(pa.id)filter(where pa.status='BLOCKED')::integer blocked_count,
      count(pa.id)filter(where pa.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))::integer completed_count,
      count(pa.id)filter(
        where case
          when v_activity_scoped then pa.applied_at>=p_from and pa.applied_at<p_to
          else pa.created_at>=p_from and pa.created_at<p_to and pa.status='APPLIED'
        end
      )::integer applied_count,
      case when count(pa.id)filter(where pa.status<>'CANCELLED')=0 then 0 else round(100.0*count(pa.id)filter(where pa.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))/count(pa.id)filter(where pa.status<>'CANCELLED'),1)end completion_rate,
      coalesce(act.active_days,0) active_days,
      act.last_activity_at,
      case when coalesce(act.active_days,0)=0 then 0 else round(count(pa.id)filter(
        where case
          when v_activity_scoped then pa.applied_at>=p_from and pa.applied_at<p_to
          else pa.created_at>=p_from and pa.created_at<p_to and pa.status='APPLIED'
        end
      )::numeric/act.active_days,1)end avg_per_day
    from actors p
    left join period_apps pa on pa.assigned_to=p.id
    left join activity act on act.applier_id=p.id
    group by p.id,p.applier_name,p.email,p.profile_status,act.active_days,act.last_activity_at
  )x;
  return jsonb_set(v_result,'{applierPerformance}',v_appliers,true);
end$$;

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
    select *
    from public.applications
    where (v_manager or assigned_to = auth.uid())
      and (
        (created_at >= p_from and created_at < p_to)
        or (
          v_activity_scoped
          and (
            (applied_at >= p_from and applied_at < p_to)
            or (updated_at >= p_from and updated_at < p_to and updated_at is distinct from created_at)
            or exists (
              select 1
              from public.application_status_history h
              where h.application_id = applications.id
                and h.created_at >= p_from
                and h.created_at < p_to
            )
          )
        )
      )
  ),
  applied as (
    select count(*)::integer as value
    from public.applications
    where (v_manager or assigned_to = auth.uid())
      and applied_at >= p_from
      and applied_at < p_to
  )
  select jsonb_build_object(
    'assigned', count(*),
    case when v_manager then 'total' else 'my_assigned' end, count(*),
    'unassigned', count(*) filter (where status = 'UNASSIGNED'),
    'pending', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS')),
    'applied', case
      when v_activity_scoped then (select value from applied)
      else count(*) filter (where status = 'APPLIED')
    end,
    'applied_status', count(*) filter (where status in ('APPLIED', 'SCREENING')),
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
    'applied_today', (select value from applied)
  )
  into v_result
  from visible;

  return v_result;
end;
$$;

revoke all on function public.get_business_overview_v31(timestamptz,timestamptz)from public,anon;
grant execute on function public.get_business_overview_v31(timestamptz,timestamptz)to authenticated;
comment on function public.get_business_overview_v31(timestamptz,timestamptz)is
  'Date-windowed business overview with Applier productivity metrics. Short windows count activity in the period.';

revoke all on function public.get_application_counts_v29(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_application_counts_v29(timestamptz, timestamptz)
  to authenticated;
comment on function public.get_application_counts_v29(timestamptz, timestamptz) is
  'RLS-compatible Application summary for a bounded reporting window. Short windows include Applications with activity in the period.';
