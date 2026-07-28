-- v0.8: capacity-aware bulk assignment. Existing individual assignment remains unchanged.

create table public.applier_workload_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_available boolean not null default true,
  max_active_applications integer not null default 50 check (max_active_applications between 1 and 10000),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.application_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) between 1 and 120),
  strategy text not null check (strategy in ('MANUAL','EVEN','CAPACITY_AWARE')),
  selected_application_count integer not null check (selected_application_count between 0 and 2000),
  requested_assignment_count integer not null check (requested_assignment_count between 0 and 2000),
  assigned_count integer not null default 0 check (assigned_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  status text not null default 'PROCESSING' check (status in ('PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_payload_hash text not null check (request_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint assignment_batch_actor_idempotency_key unique (created_by, idempotency_key_hash),
  check (assigned_count + skipped_count + failed_count <= requested_assignment_count)
);

create table public.application_assignment_batch_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.application_assignment_batches(id) on delete cascade,
  application_id uuid,
  previous_assignee_id uuid references public.profiles(id) on delete set null,
  new_assignee_id uuid references public.profiles(id) on delete set null,
  outcome text not null check (outcome in ('ASSIGNED','SKIPPED','FAILED')),
  error_code text check (error_code is null or char_length(error_code) <= 100),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint assignment_batch_one_result_per_application unique (batch_id, application_id)
);

create trigger applier_workload_settings_updated before update on public.applier_workload_settings
for each row execute function public.set_updated_at();

create index applier_workload_settings_available_idx on public.applier_workload_settings (is_available, user_id);
create index applications_active_workload_idx on public.applications (assigned_to, work_status)
  where assigned_to is not null and work_status in ('ASSIGNED','IN_PROGRESS','BLOCKED');
create index applications_unassigned_queue_idx on public.applications (priority, due_at, created_at, id)
  where assigned_to is null and work_status = 'UNASSIGNED';
create index assignment_batches_created_idx on public.application_assignment_batches (created_at desc, id desc);
create index assignment_batches_creator_idx on public.application_assignment_batches (created_by, created_at desc);
create index assignment_batches_status_strategy_idx on public.application_assignment_batches (status, strategy, created_at desc);
create index assignment_batch_results_batch_idx on public.application_assignment_batch_results (batch_id, created_at, id);
create index assignment_batch_results_outcome_idx on public.application_assignment_batch_results (batch_id, outcome, created_at, id);

create or replace function public.list_applier_workloads_v08(
  p_search text default '', p_is_available boolean default null, p_has_capacity boolean default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_limit integer := least(greatest(coalesce(p_limit,25),1),100); v_offset integer := greatest(coalesce(p_offset,0),0); v_data jsonb; v_total bigint;
begin
  perform public.assert_application_manager();
  with workloads as (
    select p.id user_id, coalesce(nullif(p.full_name,''),p.email) full_name, p.email,
      coalesce(s.is_available,true) is_available, coalesce(s.max_active_applications,50) max_active_applications,
      count(a.id) filter (where a.work_status in ('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_application_count
    from public.profiles p
    join public.user_roles ur on ur.user_id=p.id join public.roles r on r.id=ur.role_id and r.code='APPLIER' and r.active
    left join public.applier_workload_settings s on s.user_id=p.id
    left join public.applications a on a.assigned_to=p.id
    where p.status='ACTIVE' and (coalesce(trim(p_search),'')='' or p.email ilike '%'||trim(p_search)||'%' or p.full_name ilike '%'||trim(p_search)||'%')
    group by p.id,s.user_id,s.is_available,s.max_active_applications
  ), filtered as (
    select *, greatest(max_active_applications-active_application_count,0) remaining_capacity from workloads
    where (p_is_available is null or is_available=p_is_available)
  ), final as (select * from filtered where p_has_capacity is null or (remaining_capacity>0)=p_has_capacity)
  select count(*) into v_total from final;
  with workloads as (
    select p.id user_id, coalesce(nullif(p.full_name,''),p.email) full_name, p.email,
      coalesce(s.is_available,true) is_available, coalesce(s.max_active_applications,50) max_active_applications,
      count(a.id) filter (where a.work_status in ('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer active_application_count
    from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.roles r on r.id=ur.role_id and r.code='APPLIER' and r.active
    left join public.applier_workload_settings s on s.user_id=p.id left join public.applications a on a.assigned_to=p.id
    where p.status='ACTIVE' and (coalesce(trim(p_search),'')='' or p.email ilike '%'||trim(p_search)||'%' or p.full_name ilike '%'||trim(p_search)||'%')
    group by p.id,s.user_id,s.is_available,s.max_active_applications
  ), final as (
    select *,greatest(max_active_applications-active_application_count,0) remaining_capacity from workloads
    where (p_is_available is null or is_available=p_is_available)
      and (p_has_capacity is null or (greatest(max_active_applications-active_application_count,0)>0)=p_has_capacity)
    order by full_name,user_id limit v_limit offset v_offset
  ) select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'fullName',full_name,'email',email,'isAvailable',is_available,'activeApplicationCount',active_application_count,'maxActiveApplications',max_active_applications,'remainingCapacity',remaining_capacity) order by full_name,user_id),'[]'::jsonb) into v_data from final;
  return jsonb_build_object('items',v_data,'total',v_total,'offset',v_offset,'pageSize',v_limit,'hasMore',v_offset+v_limit<v_total);
end $$;

create or replace function public.get_applier_workload_settings_v08(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select jsonb_build_object('userId',p.id,'fullName',coalesce(nullif(p.full_name,''),p.email),'email',p.email,
    'isAvailable',coalesce(s.is_available,true),'maxActiveApplications',coalesce(s.max_active_applications,50),
    'usesDefaultSettings',s.user_id is null,'updatedBy',s.updated_by,'createdAt',s.created_at,'updatedAt',s.updated_at)
  into v_result from public.profiles p
  join public.user_roles ur on ur.user_id=p.id join public.roles r on r.id=ur.role_id and r.code='APPLIER' and r.active
  left join public.applier_workload_settings s on s.user_id=p.id where p.id=p_user_id and p.status='ACTIVE';
  if v_result is null then raise exception 'APPLIER_NOT_FOUND: Select an active user with the Applier role.' using errcode='P0001'; end if;
  return v_result;
end $$;

create or replace function public.update_applier_workload_settings_v08(p_user_id uuid,p_is_available boolean,p_max_active_applications integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_application_manager();
  if p_max_active_applications is null or p_max_active_applications not between 1 and 10000 then raise exception 'CAPACITY_INVALID: Capacity must be between 1 and 10,000.' using errcode='22023'; end if;
  perform 1 from public.profiles p where p.id=p_user_id and p.status='ACTIVE'
    and exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p.id and r.code='APPLIER' and r.active)
    for update;
  if not found then raise exception 'APPLIER_NOT_FOUND: Select an active user with the Applier role.' using errcode='P0001'; end if;
  insert into public.applier_workload_settings(user_id,is_available,max_active_applications,updated_by)
  values(p_user_id,coalesce(p_is_available,true),p_max_active_applications,auth.uid())
  on conflict(user_id) do update set is_available=excluded.is_available,max_active_applications=excluded.max_active_applications,updated_by=auth.uid();
  return public.get_applier_workload_settings_v08(p_user_id);
end $$;

create or replace function public.preview_bulk_assignment_v08(p_application_ids uuid[],p_applier_ids uuid[],p_strategy text,p_assignments jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_strategy text:=upper(trim(coalesce(p_strategy,''))); v_app record; v_target record; v_apps uuid[]; v_appliers uuid[]; v_selected_apps integer; v_selected_appliers integer;
begin
  perform public.assert_application_manager();
  if v_strategy not in ('MANUAL','EVEN','CAPACITY_AWARE') then raise exception 'INVALID_STRATEGY: Select a supported assignment strategy.' using errcode='22023'; end if;
  if v_strategy='MANUAL' then
    if jsonb_typeof(coalesce(p_assignments,'[]'::jsonb))<>'array' then raise exception 'VALIDATION_ERROR: assignments must be an array.' using errcode='22023'; end if;
    select coalesce(array_agg(distinct x.application_id),array[]::uuid[]),coalesce(array_agg(distinct x.assigned_to),array[]::uuid[])
      into v_apps,v_appliers from jsonb_to_recordset(coalesce(p_assignments,'[]'::jsonb)) x(application_id uuid,assigned_to uuid);
  else
    select coalesce(array_agg(distinct x),array[]::uuid[]) into v_apps from unnest(coalesce(p_application_ids,array[]::uuid[])) x where x is not null;
    select coalesce(array_agg(distinct x),array[]::uuid[]) into v_appliers from unnest(coalesce(p_applier_ids,array[]::uuid[])) x where x is not null;
  end if;
  v_selected_apps:=cardinality(v_apps); v_selected_appliers:=cardinality(v_appliers);
  if v_selected_apps=0 then raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one Application.' using errcode='22023'; end if;
  if v_selected_apps>2000 then raise exception 'APPLICATION_LIMIT_EXCEEDED: Select no more than 2,000 Applications.' using errcode='22023'; end if;
  if v_selected_appliers=0 then raise exception 'NO_ELIGIBLE_APPLIERS: Select at least one Applier.' using errcode='22023'; end if;
  if v_selected_appliers>100 then raise exception 'APPLIER_LIMIT_EXCEEDED: Select no more than 100 Appliers.' using errcode='22023'; end if;

  drop table if exists pg_temp.v08_preview_apps; drop table if exists pg_temp.v08_preview_appliers; drop table if exists pg_temp.v08_preview_proposals; drop table if exists pg_temp.v08_preview_exclusions;
  create temporary table v08_preview_apps on commit drop as
    select i.id application_id,a.priority,a.due_at,a.created_at,j.company,j.job_title,r.candidate_name,r.resume_name,
      case when a.id is null then 'APPLICATION_NOT_FOUND' when j.id is null then 'RELATED_JD_NOT_FOUND' when r.id is null then 'RELATED_RESUME_NOT_FOUND'
        when a.assigned_to is not null then 'ALREADY_ASSIGNED' when a.work_status<>'UNASSIGNED' then 'INVALID_WORK_STATUS' else null end exclusion_code
    from unnest(v_apps) i(id) left join public.applications a on a.id=i.id left join public.job_descriptions j on j.id=a.job_description_id left join public.resumes r on r.id=a.resume_id;
  create temporary table v08_preview_appliers on commit drop as
    select p.id user_id,coalesce(nullif(p.full_name,''),p.email) full_name,p.email,coalesce(s.is_available,true) is_available,
      coalesce(s.max_active_applications,50) max_capacity,count(a.id) filter(where a.work_status in('ASSIGNED','IN_PROGRESS','BLOCKED'))::integer current_workload,0::integer proposed_count,
      (p.status='ACTIVE' and coalesce(s.is_available,true) and exists(select 1 from public.user_roles ur join public.roles rr on rr.id=ur.role_id where ur.user_id=p.id and rr.code='APPLIER' and rr.active)) eligible
    from unnest(v_appliers) i(id) join public.profiles p on p.id=i.id left join public.applier_workload_settings s on s.user_id=p.id left join public.applications a on a.assigned_to=p.id group by p.id,s.user_id,s.is_available,s.max_active_applications;
  create temporary table v08_preview_proposals(application_id uuid primary key,company text,job_title text,candidate_name text,resume_name text,proposed_assignee_id uuid,proposed_assignee_name text,current_workload integer,proposed_additional_count integer,projected_final_workload integer,max_capacity integer,remaining_capacity_after integer) on commit drop;
  create temporary table v08_preview_exclusions(application_id uuid primary key,code text,message text) on commit drop;
  insert into v08_preview_exclusions select application_id,exclusion_code,case exclusion_code when 'APPLICATION_NOT_FOUND' then 'Application was not found.' when 'RELATED_JD_NOT_FOUND' then 'Related job description was not found.' when 'RELATED_RESUME_NOT_FOUND' then 'Related Resume was not found.' when 'ALREADY_ASSIGNED' then 'Application is already assigned.' else 'Application is no longer unassigned.' end from v08_preview_apps where exclusion_code is not null;

  for v_app in select * from v08_preview_apps where exclusion_code is null order by case priority when 'URGENT' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end desc,due_at asc nulls last,created_at,application_id loop
    if v_strategy='MANUAL' then
      select ap.* into v_target from v08_preview_appliers ap join jsonb_to_recordset(p_assignments) x(application_id uuid,assigned_to uuid) on x.assigned_to=ap.user_id where x.application_id=v_app.application_id limit 1;
    elsif v_strategy='EVEN' then
      select * into v_target from v08_preview_appliers where eligible and current_workload+proposed_count<max_capacity order by current_workload+proposed_count,user_id limit 1;
    else
      select * into v_target from v08_preview_appliers where eligible and current_workload+proposed_count<max_capacity order by max_capacity-current_workload-proposed_count desc,current_workload+proposed_count,user_id limit 1;
    end if;
    if not found or not v_target.eligible then insert into v08_preview_exclusions values(v_app.application_id,'NO_ELIGIBLE_APPLIER','No selected active and available Applier can receive this Application.') on conflict do nothing;
    elsif v_target.current_workload+v_target.proposed_count>=v_target.max_capacity then insert into v08_preview_exclusions values(v_app.application_id,'CAPACITY_EXCEEDED','The selected Applier has no remaining capacity.') on conflict do nothing;
    else
      update v08_preview_appliers set proposed_count=proposed_count+1 where user_id=v_target.user_id returning * into v_target;
      insert into v08_preview_proposals values(v_app.application_id,v_app.company,v_app.job_title,v_app.candidate_name,v_app.resume_name,v_target.user_id,v_target.full_name,v_target.current_workload,v_target.proposed_count,v_target.current_workload+v_target.proposed_count,v_target.max_capacity,v_target.max_capacity-v_target.current_workload-v_target.proposed_count);
    end if;
  end loop;
  return jsonb_build_object('strategy',v_strategy,'selectedApplicationCount',v_selected_apps,'eligibleApplicationCount',(select count(*) from v08_preview_proposals),'excludedApplicationCount',(select count(*) from v08_preview_exclusions),'selectedApplierCount',v_selected_appliers,
    'proposals',(select coalesce(jsonb_agg(jsonb_build_object('applicationId',application_id,'company',company,'jobTitle',job_title,'candidateName',candidate_name,'resumeName',resume_name,'proposedAssigneeId',proposed_assignee_id,'proposedAssigneeName',proposed_assignee_name,'currentApplierWorkload',current_workload,'proposedAdditionalCount',proposed_additional_count,'projectedFinalWorkload',projected_final_workload,'maxCapacity',max_capacity,'remainingCapacityAfter',remaining_capacity_after) order by application_id),'[]'::jsonb) from v08_preview_proposals),
    'applierSummaries',(select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'fullName',full_name,'currentWorkload',current_workload,'proposedCount',proposed_count,'projectedWorkload',current_workload+proposed_count,'maxCapacity',max_capacity,'remainingCapacityAfter',greatest(max_capacity-current_workload-proposed_count,0),'eligible',eligible) order by full_name,user_id),'[]'::jsonb) from v08_preview_appliers),
    'excludedApplications',(select coalesce(jsonb_agg(jsonb_build_object('applicationId',application_id,'code',code,'reason',message) order by application_id),'[]'::jsonb) from v08_preview_exclusions));
end $$;

create or replace function public.assignment_batch_response_v08(p_batch_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('batchId',b.id,'batchName',coalesce(b.name,''),'strategy',b.strategy,'requestedCount',b.requested_assignment_count,'assignedCount',b.assigned_count,'skippedCount',b.skipped_count,'failedCount',b.failed_count,'status',b.status,'replayed',false,
    'results',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'applicationId',r.application_id,'previousAssigneeId',r.previous_assignee_id,'newAssigneeId',r.new_assignee_id,'outcome',r.outcome,'errorCode',r.error_code,'message',r.message,'createdAt',r.created_at) order by r.created_at,r.id) from public.application_assignment_batch_results r where r.batch_id=b.id),'[]'::jsonb)) from public.application_assignment_batches b where b.id=p_batch_id;
$$;

create or replace function public.assign_applications_bulk_v08(p_assignments jsonb,p_batch_name text,p_strategy text,p_idempotency_key_hash text,p_request_payload_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_strategy text:=upper(trim(coalesce(p_strategy,''))); v_batch public.application_assignment_batches; v_existing public.application_assignment_batches; v_request record; v_app record; v_setting record; v_current integer; v_added integer; v_outcome text; v_code text; v_message text;
begin
  perform public.assert_application_manager();
  if v_strategy not in('MANUAL','EVEN','CAPACITY_AWARE') then raise exception 'INVALID_STRATEGY: Select a supported assignment strategy.' using errcode='22023'; end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_request_payload_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR: Invalid idempotency metadata.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_idempotency_key_hash,0));
  select * into v_existing from public.application_assignment_batches where created_by=v_actor and idempotency_key_hash=p_idempotency_key_hash;
  if found then
    if v_existing.request_payload_hash<>p_request_payload_hash then raise exception 'IDEMPOTENCY_CONFLICT: This key was already used with a different request.' using errcode='23505'; end if;
    return jsonb_set(public.assignment_batch_response_v08(v_existing.id),'{replayed}','true'::jsonb);
  end if;
  if jsonb_typeof(coalesce(p_assignments,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_assignments,'[]'::jsonb))=0 then raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one assignment.' using errcode='22023'; end if;
  if jsonb_array_length(p_assignments)>2000 then raise exception 'APPLICATION_LIMIT_EXCEEDED: Assign no more than 2,000 Applications.' using errcode='22023'; end if;
  drop table if exists pg_temp.v08_commit_requests; drop table if exists pg_temp.v08_commit_added;
  create temporary table v08_commit_requests on commit drop as select distinct on (application_id) application_id,assigned_to,ordinality from jsonb_array_elements(p_assignments) with ordinality e(value,ordinality) cross join lateral jsonb_to_record(e.value) x(application_id uuid,assigned_to uuid) where application_id is not null and assigned_to is not null order by application_id,ordinality;
  if not exists(select 1 from v08_commit_requests) then raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one valid assignment.' using errcode='22023'; end if;
  insert into public.application_assignment_batches(name,strategy,selected_application_count,requested_assignment_count,created_by,idempotency_key_hash,request_payload_hash)
    values(nullif(trim(coalesce(p_batch_name,'')),''),v_strategy,(select count(*) from v08_commit_requests),(select count(*) from v08_commit_requests),v_actor,p_idempotency_key_hash,p_request_payload_hash) returning * into v_batch;
  perform 1 from public.profiles where id in(select assigned_to from v08_commit_requests) order by id for update;
  perform 1 from public.user_roles where user_id in(select assigned_to from v08_commit_requests) order by user_id,role_id for update;
  perform 1 from public.applications where id in(select application_id from v08_commit_requests) order by id for update;
  create temporary table v08_commit_added(user_id uuid primary key,added integer not null default 0) on commit drop;
  insert into v08_commit_added select distinct assigned_to,0 from v08_commit_requests;
  for v_request in select * from v08_commit_requests order by ordinality,application_id loop
    v_outcome:='SKIPPED'; v_code:=null; v_message:='Application was skipped.';
    select a.*,j.id related_jd_id,r.id related_resume_id into v_app from public.applications a left join public.job_descriptions j on j.id=a.job_description_id left join public.resumes r on r.id=a.resume_id where a.id=v_request.application_id;
    if not found then v_code:='APPLICATION_NOT_FOUND';v_message:='Application was not found.';
    elsif v_app.related_jd_id is null then v_code:='RELATED_JD_NOT_FOUND';v_message:='Related job description was not found.';
    elsif v_app.related_resume_id is null then v_code:='RELATED_RESUME_NOT_FOUND';v_message:='Related Resume was not found.';
    elsif v_app.assigned_to is not null then v_code:='APPLICATION_NO_LONGER_UNASSIGNED';v_message:='Application is already assigned.';
    elsif v_app.work_status<>'UNASSIGNED' then v_code:='INVALID_WORK_STATUS';v_message:='Application is no longer in the unassigned queue.';
    else
      select p.status,coalesce(s.is_available,true) is_available,coalesce(s.max_active_applications,50) max_capacity,
        exists(select 1 from public.user_roles ur join public.roles rr on rr.id=ur.role_id where ur.user_id=p.id and rr.code='APPLIER' and rr.active) has_role
      into v_setting from public.profiles p left join public.applier_workload_settings s on s.user_id=p.id where p.id=v_request.assigned_to;
      if not found then v_code:='APPLIER_NOT_FOUND';v_message:='Applier was not found.';
      elsif v_setting.status<>'ACTIVE' then v_code:='APPLIER_INACTIVE';v_message:='Applier is inactive.';
      elsif not v_setting.has_role then v_code:='APPLIER_ROLE_REQUIRED';v_message:='Selected user does not have the Applier role.';
      elsif not v_setting.is_available then v_code:='APPLIER_UNAVAILABLE';v_message:='Applier is unavailable for assignment.';
      else
        select count(*) into v_current from public.applications where assigned_to=v_request.assigned_to and work_status in('ASSIGNED','IN_PROGRESS','BLOCKED');
        select added into v_added from v08_commit_added where user_id=v_request.assigned_to;
        if v_current>=v_setting.max_capacity then v_code:='CAPACITY_EXCEEDED';v_message:='Applier capacity has been reached.';
        else
          update public.applications set assigned_to=v_request.assigned_to,assigned_by=v_actor,work_status='ASSIGNED',updated_at=clock_timestamp() where id=v_request.application_id and assigned_to is null and work_status='UNASSIGNED';
          if found then
            insert into public.application_assignment_history(application_id,previous_assignee_id,new_assignee_id,assigned_by,reason) values(v_request.application_id,null,v_request.assigned_to,v_actor,'Bulk assignment batch '||v_batch.id);
            insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes) values(v_request.application_id,'WORK_STATUS','UNASSIGNED','ASSIGNED',v_actor,'Bulk assignment batch '||v_batch.id);
            update v08_commit_added set added=added+1 where user_id=v_request.assigned_to;
            v_outcome:='ASSIGNED';v_code:=null;v_message:='Application was assigned.';
          else v_code:='APPLICATION_NO_LONGER_UNASSIGNED';v_message:='Application changed before assignment.'; end if;
        end if;
      end if;
    end if;
    insert into public.application_assignment_batch_results(batch_id,application_id,previous_assignee_id,new_assignee_id,outcome,error_code,message) values(v_batch.id,v_request.application_id,null,v_request.assigned_to,v_outcome,v_code,v_message);
  end loop;
  update public.application_assignment_batches set assigned_count=(select count(*) from public.application_assignment_batch_results where batch_id=v_batch.id and outcome='ASSIGNED'),skipped_count=(select count(*) from public.application_assignment_batch_results where batch_id=v_batch.id and outcome='SKIPPED'),failed_count=(select count(*) from public.application_assignment_batch_results where batch_id=v_batch.id and outcome='FAILED'),status=case when not exists(select 1 from public.application_assignment_batch_results where batch_id=v_batch.id and outcome='ASSIGNED') then 'FAILED' when exists(select 1 from public.application_assignment_batch_results where batch_id=v_batch.id and outcome<>'ASSIGNED') then 'COMPLETED_WITH_WARNINGS' else 'COMPLETED' end,completed_at=clock_timestamp() where id=v_batch.id;
  return public.assignment_batch_response_v08(v_batch.id);
end $$;

create or replace function public.list_assignment_batches_v08(p_search text default '',p_status text default '',p_strategy text default '',p_created_by uuid default null,p_created_from timestamptz default null,p_created_to timestamptz default null,p_limit integer default 25,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_limit integer:=least(greatest(coalesce(p_limit,25),1),100);v_offset integer:=greatest(coalesce(p_offset,0),0);
begin perform public.assert_application_manager();
  with f as(select b.*,coalesce(nullif(p.full_name,''),p.email) creator_name from public.application_assignment_batches b join public.profiles p on p.id=b.created_by where(coalesce(trim(p_search),'')='' or b.name ilike '%'||trim(p_search)||'%' or p.email ilike '%'||trim(p_search)||'%') and(coalesce(trim(p_status),'')='' or b.status=upper(trim(p_status))) and(coalesce(trim(p_strategy),'')='' or b.strategy=upper(trim(p_strategy))) and(p_created_by is null or b.created_by=p_created_by) and(p_created_from is null or b.created_at>=p_created_from) and(p_created_to is null or b.created_at<=p_created_to)) select count(*) into v_total from f;
  with f as(select b.*,coalesce(nullif(p.full_name,''),p.email) creator_name from public.application_assignment_batches b join public.profiles p on p.id=b.created_by where(coalesce(trim(p_search),'')='' or b.name ilike '%'||trim(p_search)||'%' or p.email ilike '%'||trim(p_search)||'%') and(coalesce(trim(p_status),'')='' or b.status=upper(trim(p_status))) and(coalesce(trim(p_strategy),'')='' or b.strategy=upper(trim(p_strategy))) and(p_created_by is null or b.created_by=p_created_by) and(p_created_from is null or b.created_at>=p_created_from) and(p_created_to is null or b.created_at<=p_created_to) order by b.created_at desc,b.id desc limit v_limit offset v_offset) select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(name,''),'strategy',strategy,'selectedApplicationCount',selected_application_count,'requestedCount',requested_assignment_count,'assignedCount',assigned_count,'skippedCount',skipped_count,'failedCount',failed_count,'status',status,'createdBy',created_by,'creatorName',creator_name,'createdAt',created_at,'completedAt',completed_at) order by created_at desc,id desc),'[]'::jsonb) into v_items from f;
  return jsonb_build_object('items',v_items,'total',v_total,'offset',v_offset,'pageSize',v_limit,'hasMore',v_offset+v_limit<v_total);
end $$;

create or replace function public.get_assignment_batch_v08(p_batch_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;begin perform public.assert_application_manager();select jsonb_build_object('id',b.id,'name',coalesce(b.name,''),'strategy',b.strategy,'selectedApplicationCount',b.selected_application_count,'requestedCount',b.requested_assignment_count,'assignedCount',b.assigned_count,'skippedCount',b.skipped_count,'failedCount',b.failed_count,'status',b.status,'createdBy',b.created_by,'creatorName',coalesce(nullif(p.full_name,''),p.email),'createdAt',b.created_at,'completedAt',b.completed_at) into v from public.application_assignment_batches b join public.profiles p on p.id=b.created_by where b.id=p_batch_id;if v is null then raise exception 'ASSIGNMENT_BATCH_NOT_FOUND: Assignment batch was not found.' using errcode='P0001';end if;return v;end $$;

create or replace function public.list_assignment_batch_results_v08(p_batch_id uuid,p_outcome text default '',p_limit integer default 25,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;v_total bigint;v_limit integer:=least(greatest(coalesce(p_limit,25),1),100);v_offset integer:=greatest(coalesce(p_offset,0),0);begin perform public.assert_application_manager();if not exists(select 1 from public.application_assignment_batches where id=p_batch_id) then raise exception 'ASSIGNMENT_BATCH_NOT_FOUND: Assignment batch was not found.' using errcode='P0001';end if;select count(*) into v_total from public.application_assignment_batch_results where batch_id=p_batch_id and(coalesce(trim(p_outcome),'')='' or outcome=upper(trim(p_outcome)));select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'applicationId',x.application_id,'applicationNumber',x.application_number,'company',x.company,'jobTitle',x.job_title,'previousAssigneeId',x.previous_assignee_id,'newAssigneeId',x.new_assignee_id,'newAssigneeName',x.new_assignee_name,'outcome',x.outcome,'errorCode',x.error_code,'message',x.message,'createdAt',x.created_at) order by x.created_at,x.id),'[]'::jsonb) into v_items from(select r.*,a.application_number,j.company,j.job_title,coalesce(nullif(p.full_name,''),p.email) new_assignee_name from public.application_assignment_batch_results r left join public.applications a on a.id=r.application_id left join public.job_descriptions j on j.id=a.job_description_id left join public.profiles p on p.id=r.new_assignee_id where r.batch_id=p_batch_id and(coalesce(trim(p_outcome),'')='' or r.outcome=upper(trim(p_outcome))) order by r.created_at,r.id limit v_limit offset v_offset)x;return jsonb_build_object('items',v_items,'total',v_total,'offset',v_offset,'pageSize',v_limit,'hasMore',v_offset+v_limit<v_total);end $$;

alter table public.applier_workload_settings enable row level security;
alter table public.application_assignment_batches enable row level security;
alter table public.application_assignment_batch_results enable row level security;
create policy "managers read workload settings" on public.applier_workload_settings for select to authenticated using(public.application_actor_can_manage());
create policy "managers read assignment batches" on public.application_assignment_batches for select to authenticated using(public.application_actor_can_manage());
create policy "managers read assignment batch results" on public.application_assignment_batch_results for select to authenticated using(public.application_actor_can_manage());
revoke all on public.applier_workload_settings,public.application_assignment_batches,public.application_assignment_batch_results from anon;
revoke insert,update,delete on public.applier_workload_settings,public.application_assignment_batches,public.application_assignment_batch_results from authenticated;
grant select on public.applier_workload_settings,public.application_assignment_batches,public.application_assignment_batch_results to authenticated;
revoke execute on function public.bulk_assign_applications(uuid[],uuid,text) from authenticated;
revoke all on function public.list_applier_workloads_v08(text,boolean,boolean,integer,integer),public.get_applier_workload_settings_v08(uuid),public.update_applier_workload_settings_v08(uuid,boolean,integer),public.preview_bulk_assignment_v08(uuid[],uuid[],text,jsonb),public.assignment_batch_response_v08(uuid),public.assign_applications_bulk_v08(jsonb,text,text,text,text),public.list_assignment_batches_v08(text,text,text,uuid,timestamptz,timestamptz,integer,integer),public.get_assignment_batch_v08(uuid),public.list_assignment_batch_results_v08(uuid,text,integer,integer) from public,anon;
revoke execute on function public.assignment_batch_response_v08(uuid) from authenticated;
grant execute on function public.list_applier_workloads_v08(text,boolean,boolean,integer,integer),public.get_applier_workload_settings_v08(uuid),public.update_applier_workload_settings_v08(uuid,boolean,integer),public.preview_bulk_assignment_v08(uuid[],uuid[],text,jsonb),public.assign_applications_bulk_v08(jsonb,text,text,text,text),public.list_assignment_batches_v08(text,text,text,uuid,timestamptz,timestamptz,integer,integer),public.get_assignment_batch_v08(uuid),public.list_assignment_batch_results_v08(uuid,text,integer,integer) to authenticated;
