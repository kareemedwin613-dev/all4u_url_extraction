-- Surface all Resume tech stacks on Application lists and bulk preview.

create or replace function public.resume_primary_category_names(p_resume_id uuid)
returns text[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select c.name
    from public.resume_tech_stacks s
    join public.categories c on c.id = s.primary_category_id
    where s.resume_id = coalesce(
      (select parent_resume_id from public.resumes where id = p_resume_id),
      p_resume_id
    )
    order by s.sort_order, s.id
  ), array[]::text[]);
$$;

create or replace function public.resume_primary_category_ids(p_resume_id uuid)
returns uuid[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select s.primary_category_id
    from public.resume_tech_stacks s
    where s.resume_id = coalesce(
      (select parent_resume_id from public.resumes where id = p_resume_id),
      p_resume_id
    )
    order by s.sort_order, s.id
  ), array[]::uuid[]);
$$;

revoke all on function public.resume_primary_category_names(uuid) from public, anon;
grant execute on function public.resume_primary_category_names(uuid) to authenticated;
revoke all on function public.resume_primary_category_ids(uuid) from public, anon;
grant execute on function public.resume_primary_category_ids(uuid) to authenticated;

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
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count,
      public.resume_primary_category_ids(resumes.id) resume_category_ids,
      public.resume_primary_category_names(resumes.id) resume_category_names,
      coalesce((public.resume_primary_category_names(resumes.id))[1], categories.name) resume_category_sort
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
      and(
        p_category_id is null
        or jobs.category_id=p_category_id
        or public.resume_has_primary_category(coalesce(resumes.parent_resume_id, resumes.id), p_category_id)
      )
      and(p_creation_batch_id is null or a.creation_batch_id=p_creation_batch_id)
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
      case when v_sort='category_asc' then resume_category_sort end asc,case when v_sort='category_desc' then resume_category_sort end desc,
      case when v_sort='batch_asc' then creation_batch_name end asc nulls last,case when v_sort='batch_desc' then creation_batch_name end desc nulls last,id
    limit v_limit offset v_offset)
  select coalesce((select jsonb_agg(to_jsonb(paged)-'resume_category_sort')from paged),'[]'::jsonb),coalesce((select total from counted),0) into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

create or replace function public.list_my_applications_v20(
  p_status text default '',
  p_sort text default 'updated_desc',
  p_limit integer default 100,
  p_resume_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_sort text := lower(btrim(coalesce(p_sort, 'updated_desc')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_items jsonb;
  v_resumes jsonb;
  v_total bigint;
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Active Applier access is required.' using errcode = '42501';
  end if;
  if v_status <> '' and v_status not in ('ASSIGNED', 'APPLIED', 'BLOCKED') then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid Application status.' using errcode = '22023';
  end if;
  if v_sort not in (
    'updated_desc', 'updated_asc', 'company_asc', 'company_desc',
    'title_asc', 'title_desc', 'captured_asc', 'captured_desc'
  ) then
    raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode = '22023';
  end if;

  with visible as (
    select
      a.id,
      a.application_number,
      a.resume_id,
      coalesce(r.parent_resume_id, r.id) profile_resume_id,
      a.status,
      a.priority,
      a.due_at,
      a.application_url,
      a.notes,
      a.created_at,
      a.updated_at,
      j.company,
      j.job_title,
      j.source_url,
      j.created_at captured_at,
      c.name category_name,
      public.resume_primary_category_ids(r.id) resume_category_ids,
      public.resume_primary_category_names(r.id) resume_category_names,
      r.resume_name,
      r.candidate_name,
      r.resume_number,
      r.resume_type,
      r.original_filename,
      r.mime_type,
      profile_r.resume_name profile_resume_name,
      profile_r.candidate_name profile_candidate_name,
      profile_r.resume_number profile_resume_number,
      (
        select count(*)
        from public.application_screenshots s
        where s.application_id = a.id
      )::integer screenshot_count
    from public.applications a
    join public.job_descriptions j on j.id = a.job_description_id
    join public.resumes r on r.id = a.resume_id
    join public.resumes profile_r on profile_r.id = coalesce(r.parent_resume_id, r.id)
    left join public.categories c on c.id = j.category_id
    where a.assigned_to = auth.uid()
      and a.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'APPLIED')
      and (
        v_status = ''
        or (v_status = 'ASSIGNED' and a.status in ('ASSIGNED', 'IN_PROGRESS'))
        or (v_status = 'APPLIED' and a.status = 'APPLIED')
        or (v_status = 'BLOCKED' and a.status = 'BLOCKED')
      )
  ),
  resume_options as (
    select
      profile_resume_id resume_id,
      profile_resume_name resume_name,
      profile_resume_number resume_number,
      profile_candidate_name candidate_name,
      count(*)::integer application_count
    from visible
    where profile_resume_id is not null
      and nullif(btrim(profile_resume_name), '') is not null
    group by profile_resume_id, profile_resume_name, profile_resume_number, profile_candidate_name
    order by profile_candidate_name, profile_resume_name, profile_resume_number, profile_resume_id
  ),
  filtered as (
    select *
    from visible
    where p_resume_id is null
      or profile_resume_id = p_resume_id
      or resume_id = p_resume_id
  ),
  counted as (
    select count(*)::bigint total from filtered
  ),
  paged as (
    select *
    from filtered
    order by
      case when v_sort = 'updated_desc' then updated_at end desc,
      case when v_sort = 'updated_asc' then updated_at end asc,
      case when v_sort = 'company_asc' then company end asc,
      case when v_sort = 'company_desc' then company end desc,
      case when v_sort = 'title_asc' then job_title end asc,
      case when v_sort = 'title_desc' then job_title end desc,
      case when v_sort = 'captured_asc' then captured_at end asc,
      case when v_sort = 'captured_desc' then captured_at end desc,
      id
    limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resume_id,
          'resumeName', resume_name,
          'resumeNumber', resume_number,
          'candidateName', candidate_name,
          'applicationCount', application_count
        )
        order by candidate_name, resume_name, resume_number, resume_id
      )
      from resume_options
    ), '[]'::jsonb),
    coalesce((select total from counted), 0)
  into v_items, v_resumes, v_total;

  return jsonb_build_object(
    'items', v_items,
    'resumes', v_resumes,
    'total', v_total,
    'limit', v_limit
  );
end;
$$;

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ids uuid[];v_limit constant integer:=1000;v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids from(select distinct id from unnest(coalesce(p_selected_jd_ids,array[]::uuid[])) ids(id) where id is not null)x;
  if cardinality(v_ids)=0 then raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode='22023';end if;
  if cardinality(v_ids)>v_limit then raise exception 'BULK_JD_LIMIT: You can select up to 1000 job descriptions in one bulk operation.' using errcode='22023';end if;
  with requested as(select id from unnest(v_ids) requested_ids(id)),loaded as(
    select requested.id requested_id,jobs.id,jobs.company,jobs.job_title,jobs.category_id,jobs.status,jobs.review_status,categories.name category_name
    from requested left join public.job_descriptions jobs on jobs.id=requested.id
    left join public.categories categories on categories.id=jobs.category_id and categories.active
  ),combinations as(
    select concat(loaded.id,':',resumes.id) key,loaded.id job_description_id,resumes.id resume_id,loaded.company,loaded.job_title,
      loaded.category_id job_category_id,loaded.category_name job_category_name,resumes.resume_number,resumes.resume_type,
      resumes.candidate_name,resumes.resume_name,loaded.category_id resume_category_id,
      array_to_string(public.resume_primary_category_names(resumes.id), ', ') resume_category_name,
      applications.id existing_application_id,
      exists(
        select 1 from public.resume_banned_companies banned
        where banned.resume_id = resumes.id
          and banned.normalized_company = public.normalize_company_name(loaded.company)
      ) as banned_company,
      applications.id is null
        and not exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) as eligible,
      case
        when applications.id is not null then 'EXISTING_APPLICATION'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'BANNED_COMPANY'
      end as exclusion_code,
      case
        when applications.id is not null then 'Application already exists'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'This Resume bans applications to this company'
      end as exclusion_reason
    from loaded join public.resumes resumes
      on resumes.status='ACTIVE' and resumes.resume_type='ORIGINAL'
      and public.resume_has_primary_category(resumes.id, loaded.category_id)
    left join public.applications applications on applications.job_description_id=loaded.id
      and coalesce((select parent_resume_id from public.resumes where id=applications.resume_id),applications.resume_id)=resumes.id
    where loaded.id is not null and loaded.status='ACTIVE' and loaded.review_status='APPROVED'
      and loaded.category_id is not null and loaded.category_name is not null
  ),invalid_jds as(
    select loaded.requested_id job_description_id,coalesce(loaded.company,'Unavailable job description') company,coalesce(loaded.job_title,'Unavailable') job_title,
      case when loaded.id is null then 'MISSING_JD' when loaded.status<>'ACTIVE' then 'INACTIVE_JD'
        when loaded.review_status<>'APPROVED' then 'UNAPPROVED_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY' else 'NO_MATCHING_ACTIVE_RESUMES' end code,
      case when loaded.id is null then 'The job description does not exist or is unavailable.' when loaded.status<>'ACTIVE' then 'The job description is archived.'
        when loaded.review_status<>'APPROVED' then 'The job description has not been approved.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.' else 'No active original Resumes have the same primary category.' end reason
    from loaded where loaded.id is null or loaded.status<>'ACTIVE' or loaded.review_status<>'APPROVED' or loaded.category_id is null or loaded.category_name is null
      or not exists(select 1 from combinations where combinations.job_description_id=loaded.id)
  ) select jsonb_build_object('selectedJdCount',cardinality(v_ids),'validJdCount',cardinality(v_ids)-(select count(*) from invalid_jds),
    'invalidJdCount',(select count(*) from invalid_jds),'activeResumeCount',(select count(distinct resume_id) from combinations),
    'proposedCount',(select count(*) from combinations),'eligibleCount',(select count(*) from combinations where eligible),
    'duplicateCount',(select count(*) from combinations where not eligible and exclusion_code='EXISTING_APPLICATION'),
    'excludedCount',(select count(*) from combinations where not eligible)+(select count(*) from invalid_jds),
    'combinations',coalesce((select jsonb_agg(jsonb_build_object('key',key,'jobDescriptionId',job_description_id,'resumeId',resume_id,'resumeNumber',resume_number,'resumeType',resume_type,
      'company',company,'jobTitle',job_title,'jobCategoryId',job_category_id,'jobCategoryName',job_category_name,'candidateName',candidate_name,'resumeName',resume_name,
      'resumeCategoryId',resume_category_id,'resumeCategoryName',resume_category_name,'eligible',eligible,'existingApplicationId',existing_application_id,
      'exclusionCode',exclusion_code,'exclusionReason',exclusion_reason)order by company,job_title,candidate_name,resume_name)from combinations),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',job_description_id,'company',company,'jobTitle',job_title,'code',code,'reason',reason)order by company,job_title)from invalid_jds),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
