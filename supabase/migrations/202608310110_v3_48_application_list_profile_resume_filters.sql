-- Applications list: filter by profile (candidate) name and resume name.

create or replace function public.list_applications_v07(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_profile_name text default '', p_resume_name text default '',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_manager boolean;v_limit integer;v_offset integer;v_items jsonb;v_total bigint;v_sort text:=lower(coalesce(p_sort,'updated_desc'));v_number_search text:=regexp_replace(upper(trim(coalesce(p_search,''))),'^(APP[- ]?|#)','');
begin
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';end if;
  if coalesce(p_creation_mode,'')<>'' and upper(p_creation_mode) not in('BULK','INDIVIDUAL') then raise exception 'APPLICATION_INVALID_CREATION_MODE: Select a valid creation mode.' using errcode='22023';end if;
  if v_sort not in ('number_asc','number_desc','company_asc','company_desc','title_asc','title_desc','resume_asc','resume_desc','candidate_asc','candidate_desc','assignee_asc','assignee_desc','link_asc','link_desc','work_asc','work_desc','application_status_asc','application_status_desc','priority_asc','priority_desc','due_asc','due_desc','updated_asc','updated_desc','created_asc','created_desc','captured_asc','captured_desc','category_asc','category_desc','batch_asc','batch_desc') then raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode='22023';end if;
  v_limit:=least(greatest(coalesce(p_limit,25),1),5000);v_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as (
    select a.id,a.job_description_id,a.resume_id,a.assigned_to,a.assigned_by,a.work_status,a.application_status,a.priority,a.due_at,a.applied_at,a.application_url,a.created_by,a.created_at,a.updated_at,a.application_number,a.creation_batch_id,
      jobs.company,jobs.job_title,jobs.category_id,categories.name category_name,jobs.source_url,jobs.created_at captured_at,
      resumes.resume_name,resumes.candidate_name,coalesce(nullif(profiles.full_name,''),profiles.email) assignee_name,
      profiles.email assignee_email,batches.name creation_batch_name,
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count
    from public.applications a join public.job_descriptions jobs on jobs.id=a.job_description_id join public.resumes resumes on resumes.id=a.resume_id
    left join public.categories categories on categories.id=jobs.category_id left join public.profiles profiles on profiles.id=a.assigned_to
    left join public.application_creation_batches batches on batches.id=a.creation_batch_id
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null or(p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)or a.assigned_to=p_assigned_to)
      and(coalesce(trim(p_search),'')='' or jobs.search_vector @@ websearch_to_tsquery('english',trim(p_search)) or(v_number_search~'^[0-9]+$' and a.application_number::text=v_number_search))
      and(coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status))) and(coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and(coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority))) and(coalesce(trim(p_company),'')='' or jobs.company ilike '%'||trim(p_company)||'%')
      and(coalesce(trim(p_profile_name),'')='' or resumes.candidate_name ilike '%'||trim(p_profile_name)||'%')
      and(coalesce(trim(p_resume_name),'')='' or resumes.resume_name ilike '%'||trim(p_resume_name)||'%')
      and(p_category_id is null or jobs.category_id=p_category_id) and(p_creation_batch_id is null or a.creation_batch_id=p_creation_batch_id)
      and(coalesce(p_creation_mode,'')='' or(upper(p_creation_mode)='BULK' and a.creation_batch_id is not null)or(upper(p_creation_mode)='INDIVIDUAL' and a.creation_batch_id is null))
      and(coalesce(trim(p_due_filter),'')='' or(upper(trim(p_due_filter))='OVERDUE' and a.due_at<now() and a.work_status not in('COMPLETED','CANCELLED'))or(upper(trim(p_due_filter))='DUE_TODAY' and a.due_at>=date_trunc('day',now()) and a.due_at<date_trunc('day',now())+interval'1 day')or(upper(trim(p_due_filter))='NO_DUE_DATE' and a.due_at is null))
  ), counted as(select count(*) total from filtered), paged as(
    select * from filtered order by
      case when v_sort='number_asc' then application_number end asc,case when v_sort='number_desc' then application_number end desc,
      case when v_sort='company_asc' then company end asc,case when v_sort='company_desc' then company end desc,
      case when v_sort='title_asc' then job_title end asc,case when v_sort='title_desc' then job_title end desc,
      case when v_sort='resume_asc' then resume_name end asc,case when v_sort='resume_desc' then resume_name end desc,
      case when v_sort='candidate_asc' then candidate_name end asc,case when v_sort='candidate_desc' then candidate_name end desc,
      case when v_sort='assignee_asc' then assignee_name end asc nulls last,case when v_sort='assignee_desc' then assignee_name end desc nulls last,
      case when v_sort='link_asc' then coalesce(application_url,source_url) end asc nulls last,case when v_sort='link_desc' then coalesce(application_url,source_url) end desc nulls last,
      case when v_sort='work_asc' then work_status end asc,case when v_sort='work_desc' then work_status end desc,
      case when v_sort='application_status_asc' then application_status end asc,case when v_sort='application_status_desc' then application_status end desc,
      case when v_sort='priority_asc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end asc,case when v_sort='priority_desc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end desc,
      case when v_sort='due_asc' then due_at end asc nulls last,case when v_sort='due_desc' then due_at end desc nulls last,
      case when v_sort='updated_asc' then updated_at end asc,case when v_sort='updated_desc' then updated_at end desc,
      case when v_sort='created_asc' then created_at end asc,case when v_sort='created_desc' then created_at end desc,
      case when v_sort='captured_asc' then captured_at end asc,case when v_sort='captured_desc' then captured_at end desc,
      case when v_sort='category_asc' then category_name end asc,case when v_sort='category_desc' then category_name end desc,
      case when v_sort='batch_asc' then creation_batch_name end asc nulls last,case when v_sort='batch_desc' then creation_batch_name end desc nulls last,id
    limit v_limit offset v_offset)
  select coalesce((select jsonb_agg(to_jsonb(paged))from paged),'[]'::jsonb),coalesce((select total from counted),0) into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

revoke all on function public.list_applications_v07(text, uuid, text, text, text, text, uuid, text, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.list_applications_v07(text, uuid, text, text, text, text, uuid, text, text, uuid, text, text, text, integer, integer) to authenticated;
