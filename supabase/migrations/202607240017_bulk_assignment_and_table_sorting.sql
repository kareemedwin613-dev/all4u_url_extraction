-- Set-based bulk Application assignment and server-side sorting for paginated dashboard tables.

create or replace function public.bulk_assign_applications(
  p_application_ids uuid[],
  p_new_assignee_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_limit constant integer := 500;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  perform public.assert_application_manager();

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_ids
  from (select distinct id from unnest(coalesce(p_application_ids, array[]::uuid[])) ids(id) where id is not null) deduplicated;

  if cardinality(v_ids) = 0 then
    raise exception 'BULK_ASSIGN_NO_APPLICATIONS: Select at least one Application.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > v_limit then
    raise exception 'BULK_ASSIGN_LIMIT: You can assign up to 500 Applications at once.' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'BULK_ASSIGN_REASON_INVALID: Assignment reason cannot exceed 2,000 characters.' using errcode = '22023';
  end if;
  if p_new_assignee_id is not null and not exists (
    select 1 from public.profiles profiles
    join public.user_roles assignments on assignments.user_id = profiles.id
    join public.roles roles on roles.id = assignments.role_id
    where profiles.id = p_new_assignee_id and profiles.status = 'ACTIVE'
      and roles.code = 'APPLIER' and roles.active
  ) then
    raise exception 'APPLICATION_INVALID_ASSIGNEE: Select an active user with the Applier role.' using errcode = '22023';
  end if;

  with requested as (
    select id from unnest(v_ids) requested_ids(id)
  ), before_change as (
    select requested.id as requested_id, applications.id, applications.assigned_to,
      applications.work_status, applications.application_number,
      jobs.company, jobs.job_title,
      coalesce(nullif(previous_profile.full_name, ''), previous_profile.email) as previous_assignee,
      coalesce(nullif(next_profile.full_name, ''), next_profile.email) as new_assignee
    from requested
    left join public.applications applications on applications.id = requested.id
    left join public.job_descriptions jobs on jobs.id = applications.job_description_id
    left join public.profiles previous_profile on previous_profile.id = applications.assigned_to
    left join public.profiles next_profile on next_profile.id = p_new_assignee_id
  ), changed as (
    select * from before_change
    where id is not null and assigned_to is distinct from p_new_assignee_id
  ), updated as (
    update public.applications applications set
      assigned_to = p_new_assignee_id,
      assigned_by = v_actor,
      work_status = case
        when p_new_assignee_id is null then 'UNASSIGNED'
        when applications.work_status = 'UNASSIGNED' then 'ASSIGNED'
        else applications.work_status
      end,
      updated_at = clock_timestamp()
    from changed
    where applications.id = changed.id
    returning applications.id, applications.assigned_to, applications.work_status
  ), history as (
    insert into public.application_assignment_history(
      application_id, previous_assignee_id, new_assignee_id, assigned_by, reason
    )
    select changed.id, changed.assigned_to, p_new_assignee_id, v_actor, v_reason
    from changed join updated on updated.id = changed.id
    returning application_id
  ), status_history as (
    insert into public.application_status_history(
      application_id, status_type, previous_status, new_status, changed_by, notes
    )
    select changed.id, 'WORK_STATUS', changed.work_status, updated.work_status, v_actor, v_reason
    from changed join updated on updated.id = changed.id
    where changed.work_status is distinct from updated.work_status
    returning application_id
  ), outcomes as (
    select before_change.requested_id as application_id,
      before_change.application_number, before_change.company, before_change.job_title,
      before_change.previous_assignee, before_change.new_assignee,
      case
        when before_change.id is null then 'MISSING'
        when updated.id is null then 'UNCHANGED'
        else 'ASSIGNED'
      end as outcome,
      case
        when before_change.id is null then 'Application was not found.'
        when updated.id is null then 'Application already has the selected assignment.'
        when p_new_assignee_id is null then 'Application was unassigned.'
        else 'Application was assigned.'
      end as message
    from before_change
    left join updated on updated.id = before_change.id
  )
  select jsonb_build_object(
    'requestedCount', count(*),
    'changedCount', count(*) filter (where outcome = 'ASSIGNED'),
    'unchangedCount', count(*) filter (where outcome = 'UNCHANGED'),
    'missingCount', count(*) filter (where outcome = 'MISSING'),
    'assigneeId', p_new_assignee_id,
    'results', coalesce(jsonb_agg(jsonb_build_object(
      'applicationId', application_id,
      'applicationNumber', application_number,
      'company', company,
      'jobTitle', job_title,
      'previousAssignee', previous_assignee,
      'newAssignee', new_assignee,
      'outcome', outcome,
      'message', message
    ) order by application_number nulls last, application_id), '[]'::jsonb)
  ) into v_result
  from outcomes;

  return v_result;
end;
$$;

create or replace function public.list_application_batches_v2(
  p_search text default '', p_status text default '', p_sort text default 'created_desc',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := lower(coalesce(p_sort, 'created_desc'));
  v_items jsonb; v_total bigint;
begin
  perform public.assert_application_manager();
  if coalesce(p_status, '') <> '' and upper(p_status) not in ('PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED') then
    raise exception 'BULK_INVALID_STATUS: Select a valid batch status.' using errcode = '22023';
  end if;
  if v_sort not in ('name_asc','name_desc','creator_asc','creator_desc','created_asc','created_desc',
    'selected_asc','selected_desc','requested_asc','requested_desc','created_count_asc','created_count_desc',
    'duplicate_asc','duplicate_desc','skipped_asc','skipped_desc','failed_asc','failed_desc','status_asc','status_desc') then
    raise exception 'BULK_INVALID_SORT: Select a valid batch sort.' using errcode = '22023';
  end if;

  with filtered as (
    select batches.*, coalesce(nullif(profiles.full_name, ''), profiles.email) as creator_name
    from public.application_creation_batches batches
    join public.profiles profiles on profiles.id = batches.created_by
    where (coalesce(btrim(p_search), '') = '' or batches.name ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_status, '') = '' or batches.status = upper(p_status))
  ), paged as (
    select * from filtered order by
      case when v_sort='name_asc' then name end asc nulls last, case when v_sort='name_desc' then name end desc nulls last,
      case when v_sort='creator_asc' then creator_name end asc, case when v_sort='creator_desc' then creator_name end desc,
      case when v_sort='created_asc' then created_at end asc, case when v_sort='created_desc' then created_at end desc,
      case when v_sort='selected_asc' then selected_jd_count end asc, case when v_sort='selected_desc' then selected_jd_count end desc,
      case when v_sort='requested_asc' then requested_combination_count end asc, case when v_sort='requested_desc' then requested_combination_count end desc,
      case when v_sort='created_count_asc' then created_application_count end asc, case when v_sort='created_count_desc' then created_application_count end desc,
      case when v_sort='duplicate_asc' then duplicate_count end asc, case when v_sort='duplicate_desc' then duplicate_count end desc,
      case when v_sort='skipped_asc' then skipped_count end asc, case when v_sort='skipped_desc' then skipped_count end desc,
      case when v_sort='failed_asc' then failed_count end asc, case when v_sort='failed_desc' then failed_count end desc,
      case when v_sort='status_asc' then status end asc, case when v_sort='status_desc' then status end desc,
      id
    limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb), (select count(*) from filtered)
  into v_items, v_total;
  return jsonb_build_object('items',v_items,'total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset);
end;
$$;

create or replace function public.admin_list_users_v2(
  p_search text default '', p_status text default null, p_role_code text default null,
  p_sort text default 'created_desc', p_limit integer default 25, p_offset integer default 0
)
returns table(id uuid,email text,full_name text,status text,role_codes text[],created_at timestamptz,total_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := left(trim(coalesce(p_search,'')),100);
  v_status text := nullif(upper(trim(coalesce(p_status,''))), '');
  v_role_code text := nullif(upper(trim(coalesce(p_role_code,''))), '');
  v_sort text := lower(coalesce(p_sort,'created_desc'));
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  perform public.assert_active_admin();
  if v_status is not null and v_status not in ('ACTIVE','INACTIVE') then raise exception 'VALIDATION_ERROR: Invalid status.' using errcode='22023'; end if;
  if v_role_code is not null and not exists(select 1 from public.roles where code=v_role_code and active) then raise exception 'ROLE_NOT_FOUND' using errcode='22023'; end if;
  if v_sort not in ('name_asc','name_desc','email_asc','email_desc','status_asc','status_desc','roles_asc','roles_desc','created_asc','created_desc') then
    raise exception 'VALIDATION_ERROR: Invalid user sort.' using errcode='22023';
  end if;
  return query
  with users as (
    select profiles.id,profiles.email,profiles.full_name,profiles.status,profiles.created_at,
      coalesce(array_agg(distinct roles.code order by roles.code) filter(where roles.active),array[]::text[]) role_codes
    from public.profiles profiles
    left join public.user_roles assignments on assignments.user_id=profiles.id
    left join public.roles roles on roles.id=assignments.role_id
    group by profiles.id,profiles.email,profiles.full_name,profiles.status,profiles.created_at
  ), filtered as (
    select users.* from users where (v_search='' or users.email ilike '%'||v_search||'%' or users.full_name ilike '%'||v_search||'%')
      and (v_status is null or users.status=v_status) and (v_role_code is null or v_role_code=any(users.role_codes))
  )
  select filtered.id,filtered.email,filtered.full_name,filtered.status,filtered.role_codes,filtered.created_at,count(*) over()
  from filtered order by
    case when v_sort='name_asc' then filtered.full_name end asc nulls last, case when v_sort='name_desc' then filtered.full_name end desc nulls last,
    case when v_sort='email_asc' then filtered.email end asc, case when v_sort='email_desc' then filtered.email end desc,
    case when v_sort='status_asc' then filtered.status end asc, case when v_sort='status_desc' then filtered.status end desc,
    case when v_sort='roles_asc' then array_to_string(filtered.role_codes,',') end asc, case when v_sort='roles_desc' then array_to_string(filtered.role_codes,',') end desc,
    case when v_sort='created_asc' then filtered.created_at end asc, case when v_sort='created_desc' then filtered.created_at end desc,
    filtered.id
  limit v_limit offset v_offset;
end;
$$;

-- Extend the existing v0.7 Application list sort allowlist without changing its RPC signature.
create or replace function public.list_applications_v07(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
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
  v_limit:=least(greatest(coalesce(p_limit,25),1),100);v_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as (
    select a.*,jobs.company,jobs.job_title,jobs.category_id,categories.name category_name,jobs.source_url,jobs.created_at captured_at,
      resumes.resume_name,resumes.candidate_name,coalesce(nullif(profiles.full_name,''),profiles.email) assignee_name,
      profiles.email assignee_email,batches.name creation_batch_name
    from public.applications a join public.job_descriptions jobs on jobs.id=a.job_description_id join public.resumes resumes on resumes.id=a.resume_id
    left join public.categories categories on categories.id=jobs.category_id left join public.profiles profiles on profiles.id=a.assigned_to
    left join public.application_creation_batches batches on batches.id=a.creation_batch_id
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null or(p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)or a.assigned_to=p_assigned_to)
      and(coalesce(trim(p_search),'')='' or jobs.company ilike '%'||trim(p_search)||'%' or jobs.job_title ilike '%'||trim(p_search)||'%' or(v_number_search~'^[0-9]+$' and a.application_number::text=v_number_search))
      and(coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status))) and(coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and(coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority))) and(coalesce(trim(p_company),'')='' or jobs.company ilike '%'||trim(p_company)||'%')
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

revoke all on function public.bulk_assign_applications(uuid[],uuid,text) from public,anon;
revoke all on function public.list_application_batches_v2(text,text,text,integer,integer) from public,anon;
revoke all on function public.admin_list_users_v2(text,text,text,text,integer,integer) from public,anon;
grant execute on function public.bulk_assign_applications(uuid[],uuid,text) to authenticated;
grant execute on function public.list_application_batches_v2(text,text,text,integer,integer) to authenticated;
grant execute on function public.admin_list_users_v2(text,text,text,text,integer,integer) to authenticated;
