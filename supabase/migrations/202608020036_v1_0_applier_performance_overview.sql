-- Manager-only, privacy-minimized Applier performance aggregates for Overview.
-- Replaces Recent Resumes for managers while preserving it for Appliers.
create or replace function public.get_business_overview()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_manager boolean:=public.has_role('APPLYING_MANAGER') or public.has_role('ADMIN');
begin
  if not public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']) then
    raise exception 'BUSINESS_ACCESS_DENIED: Business data access is required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'jobCounts',jsonb_build_object('total',(select count(*) from public.job_descriptions),'active',(select count(*) from public.job_descriptions where status='ACTIVE')),
    'resumeCounts',jsonb_build_object('total',(select count(*) from public.resumes),'active',(select count(*) from public.resumes where status='ACTIVE')),
    'recentJobs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from(
      select j.id,j.company,j.job_title,j.category_id,j.status,j.created_at,jsonb_build_object('display_name',up.display_name,'email',up.email) captured_by
      from public.job_descriptions j left join public.user_profiles up on up.id=j.user_id order by j.created_at desc limit 5
    )x),
    'recentResumes',case when v_manager then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from(
      select id,candidate_name,resume_name,primary_category_id,status,updated_at from public.resumes order by created_at desc limit 5
    )x) end,
    'applierPerformance',case when not v_manager then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(x) order by x.completed_count desc,x.applied_count desc,x.applier_name),'[]'::jsonb) from(
      with appliers as(
        select distinct p.id,coalesce(nullif(btrim(p.full_name),''),p.email) applier_name,p.email
        from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.roles r on r.id=ur.role_id
        where p.status='ACTIVE' and r.active and r.code='APPLIER'
      )
      select p.id,p.applier_name,p.email,
        count(a.id) filter(where a.work_status<>'CANCELLED')::integer assigned_count,
        count(a.id) filter(where a.work_status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_count,
        count(a.id) filter(where a.work_status='COMPLETED')::integer completed_count,
        count(a.id) filter(where a.application_status<>'NOT_APPLIED')::integer applied_count,
        count(a.id) filter(where a.applied_at>=date_trunc('day',now()))::integer applied_today,
        count(a.id) filter(where a.applied_at>=now()-interval '3 days')::integer applied_last_3_days,
        count(a.id) filter(where a.applied_at>=date_trunc('week',now()))::integer applied_this_week,
        count(a.id) filter(where a.applied_at>=date_trunc('month',now()))::integer applied_this_month,
        count(a.id) filter(where a.applied_at>=now()-interval '30 days')::integer applied_last_30_days,
        case when count(a.id) filter(where a.work_status<>'CANCELLED')=0 then 0 else round(100.0*count(a.id) filter(where a.work_status='COMPLETED')/count(a.id) filter(where a.work_status<>'CANCELLED'),1) end completion_rate
      from appliers p left join public.applications a on a.assigned_to=p.id group by p.id,p.applier_name,p.email
    )x) end
  ) into v_result;
  return v_result;
end$$;
revoke all on function public.get_business_overview() from public,anon;
grant execute on function public.get_business_overview() to authenticated;
