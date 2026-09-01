-- Align Applier Productivity Applied counts with Applications KPI (created in period, status APPLIED)
-- and include an Unassigned bucket so table totals reconcile with get_application_counts_v29.applied.

create or replace function public.get_business_overview_v31(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_manager boolean:=public.has_role('APPLYING_MANAGER')or public.has_role('ADMIN');v_appliers jsonb:='[]'::jsonb;
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
    applier_rows as(
      select p.id,p.applier_name,p.email,p.profile_status,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')::integer assigned_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS'))::integer pending_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='BLOCKED')::integer blocked_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))::integer completed_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='APPLIED')::integer applied_count,
        case when count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')=0 then 0 else round(100.0*count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))/count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED'),1)end completion_rate,
        coalesce(act.active_days,0) active_days,
        act.last_activity_at,
        case when coalesce(act.active_days,0)=0 then 0 else round(count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='APPLIED')::numeric/act.active_days,1)end avg_per_day
      from actors p
      left join public.applications a on a.assigned_to=p.id
      left join activity act on act.applier_id=p.id
      group by p.id,p.applier_name,p.email,p.profile_status,act.active_days,act.last_activity_at
    ),
    unassigned_row as(
      select
        '00000000-0000-4000-8000-000000000000'::uuid id,
        'Unassigned'::text applier_name,
        null::text email,
        'ACTIVE'::text profile_status,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')::integer assigned_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS'))::integer pending_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='BLOCKED')::integer blocked_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))::integer completed_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='APPLIED')::integer applied_count,
        case when count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')=0 then 0 else round(100.0*count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))/count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED'),1)end completion_rate,
        0::integer active_days,
        null::timestamptz last_activity_at,
        0::numeric avg_per_day
      from public.applications a
      where a.assigned_to is null
      having count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')>0
    )
    select * from applier_rows
    union all
    select * from unassigned_row
  )x;
  return jsonb_set(v_result,'{applierPerformance}',v_appliers,true);
end$$;

revoke all on function public.get_business_overview_v31(timestamptz,timestamptz)from public,anon;
grant execute on function public.get_business_overview_v31(timestamptz,timestamptz)to authenticated;
comment on function public.get_business_overview_v31(timestamptz,timestamptz)is 'Date-windowed business overview with Applier productivity metrics aligned to Applications KPI Applied counts.';
