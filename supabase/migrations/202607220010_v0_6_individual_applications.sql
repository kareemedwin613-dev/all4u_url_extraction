-- v0.6: individual application Workflow. No data is deleted or backfilled.

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null references public.job_descriptions(id) on delete restrict,
  resume_id uuid not null references public.resumes(id) on delete restrict,
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  work_status text not null default 'UNASSIGNED'
    check (work_status in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),
  application_status text not null default 'NOT_APPLIED'
    check (application_status in ('NOT_APPLIED','APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED')),
  priority text not null default 'NORMAL'
    check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  due_at timestamptz,
  applied_at timestamptz,
  application_url text check (application_url is null or (char_length(application_url) <= 4000 and application_url ~* '^https?://')),
  notes text check (notes is null or char_length(notes) <= 10000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_job_resume_key unique (job_description_id, resume_id)
);

create table public.application_assignment_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  previous_assignee_id uuid references public.profiles(id) on delete set null,
  new_assignee_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 2000),
  created_at timestamptz not null default now(),
  check (previous_assignee_id is distinct from new_assignee_id)
);

create table public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  status_type text not null check (status_type in ('WORK_STATUS','APPLICATION_STATUS')),
  previous_status text,
  new_status text not null,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  check (previous_status is distinct from new_status)
);

create index applications_assigned_to_idx on public.applications (assigned_to);
create index applications_work_status_idx on public.applications (work_status);
create index applications_application_status_idx on public.applications (application_status);
create index applications_priority_idx on public.applications (priority);
create index applications_due_at_idx on public.applications (due_at);
create index applications_created_at_idx on public.applications (created_at desc);
create index applications_updated_at_idx on public.applications (updated_at desc);
create index applications_job_description_idx on public.applications (job_description_id);
create index applications_resume_idx on public.applications (resume_id);
create index application_assignment_history_application_idx on public.application_assignment_history (application_id, created_at desc);
create index application_assignment_history_created_idx on public.application_assignment_history (created_at desc);
create index application_status_history_application_idx on public.application_status_history (application_id, created_at desc);
create index application_status_history_created_idx on public.application_status_history (created_at desc);

create trigger applications_updated before update on public.applications
for each row execute function public.set_updated_at();

create or replace function public.application_actor_can_manage()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_active_user(auth.uid())
    and public.has_any_role(array['APPLYING_MANAGER','ADMIN'], auth.uid());
$$;

create or replace function public.application_actor_can_view(p_assigned_to uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.application_actor_can_manage()
    or (
      auth.uid() is not null
      and p_assigned_to = auth.uid()
      and public.is_active_user(auth.uid())
      and public.has_role('APPLIER', auth.uid())
    );
$$;

create or replace function public.assert_application_manager()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.application_actor_can_manage() then
    raise exception 'APPLICATION_ACCESS_DENIED: Applying Manager or Admin access is required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_active_applier(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then return; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.status = 'ACTIVE'
      and exists (
        select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.code = 'APPLIER' and r.active
      )
  ) then
    raise exception 'APPLICATION_INVALID_ASSIGNEE: Select an active user with the Applier role.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.create_application(
  p_job_description_id uuid,
  p_resume_id uuid,
  p_assigned_to uuid,
  p_priority text,
  p_due_at timestamptz,
  p_notes text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications;
  v_priority text := upper(coalesce(nullif(trim(p_priority), ''), 'NORMAL'));
begin
  perform public.assert_application_manager();
  if not exists (select 1 from public.job_descriptions where id = p_job_description_id) then
    raise exception 'APPLICATION_INVALID_JOB: The selected job description does not exist.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.resumes where id = p_resume_id and status = 'ACTIVE') then
    raise exception 'APPLICATION_INVALID_RESUME: Select an active resume.' using errcode = 'P0001';
  end if;
  if v_priority not in ('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = 'P0001';
  end if;
  perform public.assert_active_applier(p_assigned_to);

  insert into public.applications (
    job_description_id, resume_id, assigned_to, assigned_by, work_status,
    priority, due_at, notes, created_by
  ) values (
    p_job_description_id, p_resume_id, p_assigned_to,
    case when p_assigned_to is null then null else v_actor end,
    case when p_assigned_to is null then 'UNASSIGNED' else 'ASSIGNED' end,
    v_priority, p_due_at, nullif(trim(coalesce(p_notes, '')), ''), v_actor
  ) returning * into v_application;

  if p_assigned_to is not null then
    insert into public.application_assignment_history (
      application_id, previous_assignee_id, new_assignee_id, assigned_by, reason
    ) values (v_application.id, null, p_assigned_to, v_actor, 'Initial assignment');
  end if;
  return to_jsonb(v_application);
exception
  when unique_violation then
    raise exception 'APPLICATION_DUPLICATE: An Application already exists for this job description and resume.' using errcode = 'P0001';
end;
$$;

create or replace function public.update_application_progress(
  p_application_id uuid,
  p_work_status text,
  p_application_status text,
  p_application_url text,
  p_applied_at timestamptz,
  p_notes text,
  p_priority text,
  p_due_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.applications;
  v_updated public.applications;
  v_manager boolean;
  v_work text := upper(trim(coalesce(p_work_status, '')));
  v_application_status text := upper(trim(coalesce(p_application_status, '')));
  v_priority text := upper(trim(coalesce(p_priority, '')));
  v_applied_at timestamptz := p_applied_at;
begin
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (
    v_current.assigned_to = v_actor and public.is_active_user(v_actor) and public.has_role('APPLIER', v_actor)
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot update this Application.' using errcode = '42501';
  end if;
  if v_work not in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED') then
    raise exception 'APPLICATION_INVALID_WORK_STATUS: Select a valid work status.' using errcode = 'P0001';
  end if;
  if v_application_status not in ('NOT_APPLIED','APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED') then
    raise exception 'APPLICATION_INVALID_APPLICATION_STATUS: Select a valid application status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is null and v_work not in ('UNASSIGNED','CANCELLED') then
    raise exception 'APPLICATION_UNASSIGNED: Assign an Applier before changing work status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is not null and v_work = 'UNASSIGNED' then
    raise exception 'APPLICATION_PROTECTED_ASSIGNMENT: Use the reassignment action to unassign.' using errcode = 'P0001';
  end if;
  if p_application_url is not null and (char_length(p_application_url) > 4000 or p_application_url !~* '^https?://') then
    raise exception 'APPLICATION_INVALID_URL: Enter a valid http or https URL.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = 'P0001';
  end if;
  if not v_manager and (v_priority is distinct from v_current.priority or p_due_at is distinct from v_current.due_at) then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Appliers cannot change priority or due date.' using errcode = '42501';
  end if;
  if not v_manager and v_work = 'CANCELLED' then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Only Applying Managers and Admins can cancel Applications.' using errcode = '42501';
  end if;
  if v_manager and v_priority not in ('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = 'P0001';
  end if;
  if v_application_status = 'APPLIED' and v_applied_at is null then
    v_applied_at := coalesce(v_current.applied_at, now());
  end if;

  update public.applications set
    work_status = v_work,
    application_status = v_application_status,
    application_url = nullif(trim(coalesce(p_application_url, '')), ''),
    applied_at = v_applied_at,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    priority = case when v_manager then v_priority else priority end,
    due_at = case when v_manager then p_due_at else due_at end
  where id = p_application_id returning * into v_updated;

  if v_current.work_status is distinct from v_updated.work_status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'WORK_STATUS',v_current.work_status,v_updated.work_status,v_actor,nullif(left(coalesce(p_notes,''),2000),''));
  end if;
  if v_current.application_status is distinct from v_updated.application_status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'APPLICATION_STATUS',v_current.application_status,v_updated.application_status,v_actor,nullif(left(coalesce(p_notes,''),2000),''));
  end if;
  return to_jsonb(v_updated);
end;
$$;

create or replace function public.reassign_application(
  p_application_id uuid,
  p_new_assignee_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.applications;
  v_updated public.applications;
  v_new_work text;
begin
  perform public.assert_application_manager();
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_reason, '')) > 2000 then
    raise exception 'APPLICATION_INVALID_REASON: The reason cannot exceed 2000 characters.' using errcode = 'P0001';
  end if;
  perform public.assert_active_applier(p_new_assignee_id);
  if v_current.assigned_to is not distinct from p_new_assignee_id then
    return to_jsonb(v_current);
  end if;
  v_new_work := case when p_new_assignee_id is null then 'UNASSIGNED' else 'ASSIGNED' end;
  update public.applications set
    assigned_to = p_new_assignee_id,
    assigned_by = v_actor,
    work_status = v_new_work
  where id = p_application_id returning * into v_updated;

  insert into public.application_assignment_history(
    application_id,previous_assignee_id,new_assignee_id,assigned_by,reason
  ) values(v_updated.id,v_current.assigned_to,p_new_assignee_id,v_actor,nullif(trim(coalesce(p_reason,'')),''));
  if v_current.work_status is distinct from v_new_work then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'WORK_STATUS',v_current.work_status,v_new_work,v_actor,nullif(left(coalesce(p_reason,''),2000),''));
  end if;
  return to_jsonb(v_updated);
end;
$$;

create or replace function public.list_active_appliers(p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name, x.email), '[]'::jsonb) into v_result
  from (
    select p.id, p.email, coalesce(nullif(p.full_name,''),p.email) display_name,
      count(a.id) filter (where a.work_status not in ('COMPLETED','CANCELLED'))::integer active_application_count
    from public.profiles p
    join public.user_roles ur on ur.user_id=p.id
    join public.roles r on r.id=ur.role_id and r.code='APPLIER' and r.active
    left join public.applications a on a.assigned_to=p.id
    where p.status='ACTIVE' and (
      coalesce(trim(p_search),'')='' or p.email ilike '%'||trim(p_search)||'%' or p.full_name ilike '%'||trim(p_search)||'%'
    )
    group by p.id
    order by coalesce(nullif(p.full_name,''),p.email), p.email
    limit least(greatest(coalesce(p_limit,100),1),200)
  ) x;
  return v_result;
end;
$$;

create or replace function public.list_application_jobs(p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.company,x.job_title), '[]'::jsonb) into v_result
  from (
    select j.id,j.company,j.job_title,j.category_id,j.status
    from public.job_descriptions j
    where (coalesce(trim(p_search),'')='' or j.company ilike '%'||trim(p_search)||'%' or j.job_title ilike '%'||trim(p_search)||'%')
    order by j.company,j.job_title limit least(greatest(coalesce(p_limit,100),1),200)
  ) x;
  return v_result;
end;
$$;

create or replace function public.list_application_resumes(p_job_description_id uuid, p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_category uuid; v_result jsonb;
begin
  perform public.assert_application_manager();
  select category_id into v_category from public.job_descriptions where id=p_job_description_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.same_category desc,x.candidate_name,x.resume_name), '[]'::jsonb) into v_result
  from (
    select r.id,r.candidate_name,r.resume_name,r.primary_category_id,r.seniority,
      (r.primary_category_id=v_category) same_category
    from public.resumes r
    where r.status='ACTIVE' and (
      coalesce(trim(p_search),'')='' or r.candidate_name ilike '%'||trim(p_search)||'%' or r.resume_name ilike '%'||trim(p_search)||'%'
    )
    order by (r.primary_category_id=v_category) desc,r.candidate_name,r.resume_name
    limit least(greatest(coalesce(p_limit,100),1),200)
  ) x;
  return v_result;
end;
$$;

create or replace function public.list_applications(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_manager boolean; v_limit integer; v_offset integer; v_items jsonb; v_total bigint;
begin
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit,25),1),100); v_offset := greatest(coalesce(p_offset,0),0);
  with filtered as (
    select a.*,j.company,j.job_title,j.category_id,c.name category_name,
      coalesce(nullif(p.full_name,''),p.email) assignee_name,p.email assignee_email
    from public.applications a
    join public.job_descriptions j on j.id=a.job_description_id
    left join public.categories c on c.id=j.category_id
    left join public.profiles p on p.id=a.assigned_to
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null
        or (p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)
        or a.assigned_to=p_assigned_to)
      and (coalesce(trim(p_search),'')='' or j.company ilike '%'||trim(p_search)||'%' or j.job_title ilike '%'||trim(p_search)||'%')
      and (coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status)))
      and (coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and (coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority)))
      and (coalesce(trim(p_company),'')='' or j.company ilike '%'||trim(p_company)||'%')
      and (p_category_id is null or j.category_id=p_category_id)
      and (coalesce(trim(p_due_filter),'')='' or
        (upper(trim(p_due_filter))='OVERDUE' and a.due_at<now() and a.work_status not in ('COMPLETED','CANCELLED')) or
        (upper(trim(p_due_filter))='DUE_TODAY' and a.due_at>=date_trunc('day',now()) and a.due_at<date_trunc('day',now())+interval '1 day') or
        (upper(trim(p_due_filter))='NO_DUE_DATE' and a.due_at is null))
  ), counted as (select count(*) total from filtered), paged as (
    select * from filtered order by
      case when p_sort='created_asc' then created_at end asc,
      case when p_sort='created_desc' then created_at end desc,
      case when p_sort='updated_asc' then updated_at end asc,
      case when p_sort='due_asc' then due_at end asc nulls last,
      case when p_sort='priority_desc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end desc,
      case when p_sort='company_asc' then company end asc,
      case when p_sort='title_asc' then job_title end asc,
      updated_at desc,id
    limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),coalesce((select total from counted),0)
  into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

create or replace function public.get_application_detail(p_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_app public.applications; v_result jsonb;
begin
  select * into v_app from public.applications where id=p_application_id;
  if not found or not public.application_actor_can_view(v_app.assigned_to) then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode='P0001';
  end if;
  select jsonb_build_object(
    'application',to_jsonb(v_app),
    'job',jsonb_build_object('id',j.id,'company',j.company,'job_title',j.job_title,'category_id',j.category_id,'description_text',j.description_text,'source_url',j.source_url,'location_text',j.location_text,'work_arrangement',j.work_arrangement),
    'resume',jsonb_build_object('id',r.id,'candidate_name',r.candidate_name,'resume_name',r.resume_name,'primary_category_id',r.primary_category_id,'seniority',r.seniority,'skills',r.skills,'original_filename',r.original_filename),
    'assignee',case when ap.id is null then null else jsonb_build_object('id',ap.id,'email',ap.email,'display_name',coalesce(nullif(ap.full_name,''),ap.email)) end,
    'creator',jsonb_build_object('id',cp.id,'email',cp.email,'display_name',coalesce(nullif(cp.full_name,''),cp.email)),
    'assignment_history',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'previous_assignee_id',h.previous_assignee_id,'previous_assignee',coalesce(nullif(pp.full_name,''),pp.email),'new_assignee_id',h.new_assignee_id,'new_assignee',coalesce(nullif(np.full_name,''),np.email),'assigned_by',coalesce(nullif(bp.full_name,''),bp.email),'reason',h.reason,'created_at',h.created_at) order by h.created_at desc),'[]'::jsonb) from public.application_assignment_history h left join public.profiles pp on pp.id=h.previous_assignee_id left join public.profiles np on np.id=h.new_assignee_id left join public.profiles bp on bp.id=h.assigned_by where h.application_id=v_app.id),
    'status_history',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'status_type',h.status_type,'previous_status',h.previous_status,'new_status',h.new_status,'changed_by',coalesce(nullif(p.full_name,''),p.email),'notes',h.notes,'created_at',h.created_at) order by h.created_at desc),'[]'::jsonb) from public.application_status_history h left join public.profiles p on p.id=h.changed_by where h.application_id=v_app.id)
  ) into v_result
  from public.job_descriptions j join public.resumes r on r.id=v_app.resume_id
  left join public.profiles ap on ap.id=v_app.assigned_to
  join public.profiles cp on cp.id=v_app.created_by
  where j.id=v_app.job_description_id;
  return v_result;
end;
$$;

create or replace function public.get_application_counts()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_manager boolean; v_result jsonb;
begin
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    case when v_manager then 'total' else 'my_assigned' end,count(*),
    'unassigned',count(*) filter(where assigned_to is null),
    'due_today',count(*) filter(where due_at>=date_trunc('day',now()) and due_at<date_trunc('day',now())+interval '1 day' and work_status not in('COMPLETED','CANCELLED')),
    'in_progress',count(*) filter(where work_status='IN_PROGRESS'),
    'blocked',count(*) filter(where work_status='BLOCKED'),
    'overdue',count(*) filter(where due_at<now() and work_status not in('COMPLETED','CANCELLED')),
    'applied_today',count(*) filter(where applied_at>=date_trunc('day',now()) and applied_at<date_trunc('day',now())+interval '1 day'),
    'interviews',count(*) filter(where application_status='INTERVIEW_SCHEDULED')
  ) into v_result from public.applications where v_manager or assigned_to=auth.uid();
  return v_result;
end;
$$;

create or replace function public.get_application_resume_file(p_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_assigned uuid; v_result jsonb;
begin
  select a.assigned_to,jsonb_build_object('bucket',r.storage_bucket,'path',r.storage_path,'filename',r.original_filename)
  into v_assigned,v_result from public.applications a join public.resumes r on r.id=a.resume_id where a.id=p_application_id;
  if not found or not public.application_actor_can_view(v_assigned) then
    raise exception 'APPLICATION_RESUME_ACCESS_DENIED: The Resume is not available for this Application.' using errcode='42501';
  end if;
  return v_result;
end;
$$;

alter table public.applications enable row level security;
alter table public.application_assignment_history enable row level security;
alter table public.application_status_history enable row level security;

create policy "role scoped read applications" on public.applications for select to authenticated
using (public.application_actor_can_view(assigned_to));
create policy "role scoped read assignment history" on public.application_assignment_history for select to authenticated
using (exists(select 1 from public.applications a where a.id=application_id and public.application_actor_can_view(a.assigned_to)));
create policy "role scoped read status history" on public.application_status_history for select to authenticated
using (exists(select 1 from public.applications a where a.id=application_id and public.application_actor_can_view(a.assigned_to)));

drop policy if exists "business roles read original resumes" on storage.objects;
create policy "application scoped or manager read original resumes" on storage.objects for select to authenticated
using (
  bucket_id='original-resumes' and public.is_active_user(auth.uid()) and (
    public.has_any_role(array['APPLYING_MANAGER','ADMIN'],auth.uid()) or
    (public.has_role('APPLIER',auth.uid()) and exists(
      select 1 from public.resumes r join public.applications a on a.resume_id=r.id
      where r.storage_bucket=bucket_id and r.storage_path=name and a.assigned_to=auth.uid()
    ))
  )
);

revoke all on public.applications,public.application_assignment_history,public.application_status_history from anon;
revoke insert,update,delete on public.applications,public.application_assignment_history,public.application_status_history from authenticated;
grant select on public.applications,public.application_assignment_history,public.application_status_history to authenticated;

revoke all on function public.application_actor_can_manage() from public,anon;
revoke all on function public.application_actor_can_view(uuid) from public,anon;
revoke all on function public.assert_application_manager() from public,anon,authenticated;
revoke all on function public.assert_active_applier(uuid) from public,anon,authenticated;
revoke all on function public.create_application(uuid,uuid,uuid,text,timestamptz,text) from public,anon;
revoke all on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) from public,anon;
revoke all on function public.reassign_application(uuid,uuid,text) from public,anon;
revoke all on function public.list_active_appliers(text,integer) from public,anon;
revoke all on function public.list_application_jobs(text,integer) from public,anon;
revoke all on function public.list_application_resumes(uuid,text,integer) from public,anon;
revoke all on function public.list_applications(text,uuid,text,text,text,text,uuid,text,text,integer,integer) from public,anon;
revoke all on function public.get_application_detail(uuid) from public,anon;
revoke all on function public.get_application_counts() from public,anon;
revoke all on function public.get_application_resume_file(uuid) from public,anon;

grant execute on function public.application_actor_can_manage() to authenticated;
grant execute on function public.application_actor_can_view(uuid) to authenticated;
grant execute on function public.create_application(uuid,uuid,uuid,text,timestamptz,text) to authenticated;
grant execute on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) to authenticated;
grant execute on function public.reassign_application(uuid,uuid,text) to authenticated;
grant execute on function public.list_active_appliers(text,integer) to authenticated;
grant execute on function public.list_application_jobs(text,integer) to authenticated;
grant execute on function public.list_application_resumes(uuid,text,integer) to authenticated;
grant execute on function public.list_applications(text,uuid,text,text,text,text,uuid,text,text,integer,integer) to authenticated;
grant execute on function public.get_application_detail(uuid) to authenticated;
grant execute on function public.get_application_counts() to authenticated;
grant execute on function public.get_application_resume_file(uuid) to authenticated;
