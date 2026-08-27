-- Overview JD Finder Performance: include inactive JD Finders (matches Applier chart behavior).
create or replace function public.get_business_overview_v30(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_manager boolean:=public.has_role('APPLYING_MANAGER')or public.has_role('ADMIN');v_appliers jsonb:='[]'::jsonb;v_finders jsonb:='[]'::jsonb;
begin
  if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.' using errcode='22023';
  end if;
  v_result:=public.get_business_overview_v29(p_from,p_to);
  if v_manager then
    select coalesce(jsonb_agg(to_jsonb(x)order by x.completed_count desc,x.applied_count desc,x.applier_name),'[]'::jsonb)into v_appliers from(
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
          p.email
        from public.profiles p
        join public.user_roles ur on ur.user_id=p.id
        join public.roles r on r.id=ur.role_id
        left join public.user_profiles up on up.id=p.id
        where r.active and r.code='APPLIER'
      )
      select p.id,p.applier_name,p.email,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')::integer assigned_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('ASSIGNED','IN_PROGRESS'))::integer pending_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status='BLOCKED')::integer blocked_count,
        count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))::integer completed_count,
        count(a.id)filter(where a.applied_at>=p_from and a.applied_at<p_to)::integer applied_count,
        case when count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED')=0 then 0 else round(100.0*count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED'))/count(a.id)filter(where a.created_at>=p_from and a.created_at<p_to and a.status<>'CANCELLED'),1)end completion_rate
      from actors p left join public.applications a on a.assigned_to=p.id group by p.id,p.applier_name,p.email
    )x;
    select coalesce(jsonb_agg(to_jsonb(x)order by x.approved_count desc,x.captured_count desc,x.finder_name),'[]'::jsonb)into v_finders from(
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
            'Unknown JD Finder'
          )finder_name,
          p.email
        from public.profiles p
        join public.user_roles ur on ur.user_id=p.id
        join public.roles r on r.id=ur.role_id
        left join public.user_profiles up on up.id=p.id
        where r.active and r.code='JD_FINDER'
      )
      select p.id,p.finder_name,p.email,
        count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to)::integer captured_count,
        count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to and j.review_status='APPROVED')::integer approved_count,
        count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to and j.review_status='NEEDS_REVIEW')::integer needs_review_count,
        count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to and j.review_status='NEEDS_CORRECTION')::integer needs_correction_count,
        count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to and j.review_status='DECLINED')::integer declined_count,
        case when count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to)=0 then 0 else round(100.0*count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to and j.review_status='APPROVED')/count(j.id)filter(where j.created_at>=p_from and j.created_at<p_to),1)end approval_rate
      from actors p left join public.job_descriptions j on j.user_id=p.id group by p.id,p.finder_name,p.email
    )x;
  end if;
  return jsonb_set(jsonb_set(v_result,'{applierPerformance}',v_appliers,true),'{jdFinderPerformance}',v_finders,true);
end$$;

revoke all on function public.get_business_overview_v30(timestamptz,timestamptz)from public,anon;
grant execute on function public.get_business_overview_v30(timestamptz,timestamptz)to authenticated;
comment on function public.get_business_overview_v30(timestamptz,timestamptz)is 'Manager-only date-windowed role performance plus bounded business summary data.';
