-- PROFILE bulk assign ignores Applier capacity and availability (profile mapping only).

create or replace function public.preview_bulk_assignment_v08(
  p_application_ids uuid[],
  p_applier_ids uuid[],
  p_strategy text,
  p_assignments jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_strategy text := upper(trim(coalesce(p_strategy, '')));
  v_app record;
  v_target record;
  v_apps uuid[];
  v_selected_apps integer;
  v_profile_applier uuid;
begin
  perform public.assert_application_manager();
  if v_strategy <> 'PROFILE' then
    raise exception 'INVALID_STRATEGY: Select PROFILE assignment strategy.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_apps
  from unnest(coalesce(p_application_ids, array[]::uuid[])) x where x is not null;
  v_selected_apps := cardinality(v_apps);
  if v_selected_apps = 0 then
    raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one Application.' using errcode = '22023';
  end if;
  if v_selected_apps > 5000 then
    raise exception 'APPLICATION_LIMIT_EXCEEDED: Select no more than 5,000 Applications.' using errcode = '22023';
  end if;

  drop table if exists pg_temp.v08_preview_apps;
  drop table if exists pg_temp.v08_preview_appliers;
  drop table if exists pg_temp.v08_preview_proposals;
  drop table if exists pg_temp.v08_preview_exclusions;

  create temporary table v08_preview_apps on commit drop as
    select i.id application_id, a.assigned_to, a.resume_id, a.priority, a.due_at, a.created_at,
      j.company, j.job_title, r.candidate_name, r.resume_name,
      case
        when a.id is null then 'APPLICATION_NOT_FOUND'
        when j.id is null then 'RELATED_JD_NOT_FOUND'
        when r.id is null then 'RELATED_RESUME_NOT_FOUND'
        when a.work_status in ('COMPLETED', 'CANCELLED') then 'INVALID_WORK_STATUS'
        else null
      end exclusion_code
    from unnest(v_apps) i(id)
    left join public.applications a on a.id = i.id
    left join public.job_descriptions j on j.id = a.job_description_id
    left join public.resumes r on r.id = a.resume_id;

  create temporary table v08_preview_appliers (
    user_id uuid primary key,
    full_name text,
    email text,
    is_available boolean,
    max_capacity integer,
    current_workload integer,
    proposed_count integer,
    eligible boolean,
    status text,
    has_role boolean
  ) on commit drop;

  create temporary table v08_preview_proposals (
    application_id uuid primary key,
    current_assignee_id uuid,
    company text,
    job_title text,
    candidate_name text,
    resume_name text,
    proposed_assignee_id uuid,
    proposed_assignee_name text,
    current_workload integer,
    proposed_additional_count integer,
    projected_final_workload integer,
    max_capacity integer,
    remaining_capacity_after integer
  ) on commit drop;

  create temporary table v08_preview_exclusions (
    application_id uuid primary key,
    code text,
    message text
  ) on commit drop;

  insert into v08_preview_exclusions
  select application_id, exclusion_code,
    case exclusion_code
      when 'APPLICATION_NOT_FOUND' then 'Application was not found.'
      when 'RELATED_JD_NOT_FOUND' then 'Related job description was not found.'
      when 'RELATED_RESUME_NOT_FOUND' then 'Related Resume was not found.'
      else 'Application is completed or cancelled and cannot be reassigned.'
    end
  from v08_preview_apps
  where exclusion_code is not null;

  for v_app in
    select * from v08_preview_apps
    where exclusion_code is null
    order by
      case priority when 'URGENT' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end desc,
      due_at asc nulls last,
      created_at,
      application_id
  loop
    select m.applier_user_id into v_profile_applier
    from public.applier_resume_profiles m
    where m.resume_id = v_app.resume_id
    limit 1;

    if v_profile_applier is null then
      insert into v08_preview_exclusions values (
        v_app.application_id,
        'RESUME_PROFILE_MISSING',
        'This Resume is not assigned to any Applier profile.'
      ) on conflict do nothing;
      continue;
    end if;

    if not exists (select 1 from v08_preview_appliers where user_id = v_profile_applier) then
      insert into v08_preview_appliers
      select p.id, coalesce(nullif(p.full_name, ''), p.email), p.email,
        coalesce(s.is_available, true),
        coalesce(s.max_active_applications, 50),
        (
          select count(*)::integer
          from public.applications a
          where a.assigned_to = p.id
            and a.work_status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
            and not (a.id = any (v_apps))
        ),
        0,
        (
          p.status = 'ACTIVE'
          and exists (
            select 1 from public.user_roles ur
            join public.roles rr on rr.id = ur.role_id
            where ur.user_id = p.id and rr.code = 'APPLIER' and rr.active
          )
        ),
        p.status,
        exists (
          select 1 from public.user_roles ur
          join public.roles rr on rr.id = ur.role_id
          where ur.user_id = p.id and rr.code = 'APPLIER' and rr.active
        )
      from public.profiles p
      left join public.applier_workload_settings s on s.user_id = p.id
      where p.id = v_profile_applier;
    end if;

    select * into v_target from v08_preview_appliers where user_id = v_profile_applier;

    if not found then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'APPLIER_NOT_FOUND', 'Applier was not found.'
      ) on conflict do nothing;
    elsif v_target.status <> 'ACTIVE' then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'APPLIER_INACTIVE', 'Applier is inactive.'
      ) on conflict do nothing;
    elsif not v_target.has_role then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'APPLIER_ROLE_REQUIRED', 'Selected user does not have the Applier role.'
      ) on conflict do nothing;
    elsif v_app.assigned_to is not distinct from v_target.user_id then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'SAME_ASSIGNEE', 'Application is already assigned to this Applier.'
      ) on conflict do nothing;
    else
      update v08_preview_appliers
      set proposed_count = proposed_count + 1
      where user_id = v_target.user_id
      returning * into v_target;
      insert into v08_preview_proposals values (
        v_app.application_id, v_app.assigned_to, v_app.company, v_app.job_title, v_app.candidate_name, v_app.resume_name,
        v_target.user_id, v_target.full_name, v_target.current_workload, v_target.proposed_count,
        v_target.current_workload + v_target.proposed_count, v_target.max_capacity,
        v_target.max_capacity - v_target.current_workload - v_target.proposed_count
      );
    end if;
  end loop;

  return jsonb_build_object(
    'strategy', v_strategy,
    'selectedApplicationCount', v_selected_apps,
    'eligibleApplicationCount', (select count(*) from v08_preview_proposals),
    'excludedApplicationCount', (select count(*) from v08_preview_exclusions),
    'selectedApplierCount', (select count(*) from v08_preview_appliers),
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'applicationId', application_id,
        'currentAssigneeId', current_assignee_id,
        'company', company,
        'jobTitle', job_title,
        'candidateName', candidate_name,
        'resumeName', resume_name,
        'proposedAssigneeId', proposed_assignee_id,
        'proposedAssigneeName', proposed_assignee_name,
        'currentApplierWorkload', current_workload,
        'proposedAdditionalCount', proposed_additional_count,
        'projectedFinalWorkload', projected_final_workload,
        'maxCapacity', max_capacity,
        'remainingCapacityAfter', remaining_capacity_after
      ) order by application_id), '[]'::jsonb)
      from v08_preview_proposals
    ),
    'applierSummaries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', user_id,
        'fullName', full_name,
        'currentWorkload', current_workload,
        'proposedCount', proposed_count,
        'projectedWorkload', current_workload + proposed_count,
        'maxCapacity', max_capacity,
        'remainingCapacityAfter', greatest(max_capacity - current_workload - proposed_count, 0),
        'eligible', eligible
      ) order by full_name, user_id), '[]'::jsonb)
      from v08_preview_appliers
    ),
    'excludedApplications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'applicationId', application_id,
        'code', code,
        'reason', message
      ) order by application_id), '[]'::jsonb)
      from v08_preview_exclusions
    )
  );
end;
$$;

create or replace function public.assign_applications_bulk_v08(
  p_assignments jsonb,
  p_batch_name text,
  p_strategy text,
  p_idempotency_key_hash text,
  p_request_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_strategy text := upper(trim(coalesce(p_strategy, '')));
  v_batch public.application_assignment_batches;
  v_existing public.application_assignment_batches;
  v_request record;
  v_app record;
  v_setting record;
  v_current integer;
  v_added integer;
  v_outcome text;
  v_code text;
  v_message text;
  v_previous uuid;
  v_previous_work text;
  v_new_work text := 'ASSIGNED';
  v_allow text;
begin
  perform public.assert_application_manager();
  -- PROFILE for new runs; legacy values kept for idempotent replay of historical batches.
  if v_strategy not in ('PROFILE', 'MANUAL', 'EVEN', 'CAPACITY_AWARE') then
    raise exception 'INVALID_STRATEGY: Select a supported assignment strategy.' using errcode = '22023';
  end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_request_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: Invalid idempotency metadata.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_idempotency_key_hash, 0));
  select * into v_existing
  from public.application_assignment_batches
  where created_by = v_actor and idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.request_payload_hash <> p_request_payload_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: This key was already used with a different request.' using errcode = '23505';
    end if;
    return jsonb_set(public.assignment_batch_response_v08(v_existing.id), '{replayed}', 'true'::jsonb);
  end if;
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_assignments, '[]'::jsonb)) = 0 then
    raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one assignment.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_assignments) > 5000 then
    raise exception 'APPLICATION_LIMIT_EXCEEDED: Assign no more than 5,000 Applications.' using errcode = '22023';
  end if;
  drop table if exists pg_temp.v08_commit_requests;
  drop table if exists pg_temp.v08_commit_added;
  create temporary table v08_commit_requests on commit drop as
    select distinct on (application_id) application_id, assigned_to, ordinality
    from jsonb_array_elements(p_assignments) with ordinality e(value, ordinality)
    cross join lateral jsonb_to_record(e.value) x(application_id uuid, assigned_to uuid)
    where application_id is not null and assigned_to is not null
    order by application_id, ordinality;
  if not exists (select 1 from v08_commit_requests) then
    raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one valid assignment.' using errcode = '22023';
  end if;
  insert into public.application_assignment_batches (
    name, strategy, selected_application_count, requested_assignment_count,
    created_by, idempotency_key_hash, request_payload_hash
  ) values (
    nullif(trim(coalesce(p_batch_name, '')), ''), v_strategy,
    (select count(*) from v08_commit_requests), (select count(*) from v08_commit_requests),
    v_actor, p_idempotency_key_hash, p_request_payload_hash
  ) returning * into v_batch;
  perform 1 from public.profiles where id in (select assigned_to from v08_commit_requests) order by id for update;
  perform 1 from public.user_roles where user_id in (select assigned_to from v08_commit_requests) order by user_id, role_id for update;
  perform 1 from public.applications where id in (select application_id from v08_commit_requests) order by id for update;
  create temporary table v08_commit_added (user_id uuid primary key, added integer not null default 0) on commit drop;
  insert into v08_commit_added select distinct assigned_to, 0 from v08_commit_requests;
  for v_request in select * from v08_commit_requests order by ordinality, application_id loop
    v_outcome := 'SKIPPED';
    v_code := null;
    v_message := 'Application was skipped.';
    v_previous := null;
    v_previous_work := null;
    select a.*, j.id related_jd_id, r.id related_resume_id
    into v_app
    from public.applications a
    left join public.job_descriptions j on j.id = a.job_description_id
    left join public.resumes r on r.id = a.resume_id
    where a.id = v_request.application_id;
    if not found then
      v_code := 'APPLICATION_NOT_FOUND';
      v_message := 'Application was not found.';
    elsif v_app.related_jd_id is null then
      v_code := 'RELATED_JD_NOT_FOUND';
      v_message := 'Related job description was not found.';
    elsif v_app.related_resume_id is null then
      v_code := 'RELATED_RESUME_NOT_FOUND';
      v_message := 'Related Resume was not found.';
    elsif v_app.work_status in ('COMPLETED', 'CANCELLED') then
      v_code := 'INVALID_WORK_STATUS';
      v_message := 'Application is completed or cancelled and cannot be reassigned.';
    elsif v_app.assigned_to is not distinct from v_request.assigned_to then
      v_code := 'SAME_ASSIGNEE';
      v_message := 'Application is already assigned to this Applier.';
    else
      v_previous := v_app.assigned_to;
      v_previous_work := v_app.work_status;
      select p.status, coalesce(s.is_available, true) is_available,
        coalesce(s.max_active_applications, 50) max_capacity,
        exists (
          select 1 from public.user_roles ur
          join public.roles rr on rr.id = ur.role_id
          where ur.user_id = p.id and rr.code = 'APPLIER' and rr.active
        ) has_role
      into v_setting
      from public.profiles p
      left join public.applier_workload_settings s on s.user_id = p.id
      where p.id = v_request.assigned_to;
      if not found then
        v_code := 'APPLIER_NOT_FOUND';
        v_message := 'Applier was not found.';
      elsif v_setting.status <> 'ACTIVE' then
        v_code := 'APPLIER_INACTIVE';
        v_message := 'Applier is inactive.';
      elsif not v_setting.has_role then
        v_code := 'APPLIER_ROLE_REQUIRED';
        v_message := 'Selected user does not have the Applier role.';
      else
        v_allow := public.applier_resume_allowlist_code(v_request.assigned_to, v_app.resume_id);
        if v_allow = 'APPLIER_PROFILE_REQUIRED' then
          v_code := 'APPLIER_PROFILE_REQUIRED';
          v_message := 'Applier has no profiles.';
        elsif v_allow = 'APPLIER_RESUME_NOT_ALLOWED' then
          v_code := 'APPLIER_RESUME_NOT_ALLOWED';
          v_message := 'Resume not assigned to this Applier.';
        elsif v_allow is not null then
          v_code := 'APPLIER_ROLE_REQUIRED';
          v_message := 'Selected user does not have the Applier role.';
        else
          -- PROFILE (and commit) ignores capacity/availability; assign by profile mapping.
          update public.applications
            set assigned_to = v_request.assigned_to,
              assigned_by = v_actor,
              work_status = v_new_work,
              updated_at = clock_timestamp()
            where id = v_request.application_id
              and work_status not in ('COMPLETED', 'CANCELLED')
              and assigned_to is distinct from v_request.assigned_to;
            if found then
              insert into public.application_assignment_history (
                application_id, previous_assignee_id, new_assignee_id, assigned_by, reason
              ) values (
                v_request.application_id, v_previous, v_request.assigned_to, v_actor,
                case when v_previous is null then 'Bulk assignment batch ' else 'Bulk reassignment batch ' end || v_batch.id
              );
              if v_previous_work is distinct from v_new_work then
                insert into public.application_status_history (
                  application_id, status_type, previous_status, new_status, changed_by, notes
                ) values (
                  v_request.application_id, 'WORK_STATUS', v_previous_work, v_new_work, v_actor,
                  case when v_previous is null then 'Bulk assignment batch ' else 'Bulk reassignment batch ' end || v_batch.id
                );
              end if;
              update v08_commit_added set added = added + 1 where user_id = v_request.assigned_to;
              v_outcome := 'ASSIGNED';
              v_code := null;
              v_message := case when v_previous is null then 'Application was assigned.' else 'Application was reassigned.' end;
            else
              v_code := 'APPLICATION_CHANGED';
              v_message := 'Application changed before assignment.';
            end if;
        end if;
      end if;
    end if;
    insert into public.application_assignment_batch_results (
      batch_id, application_id, previous_assignee_id, new_assignee_id, outcome, error_code, message
    ) values (
      v_batch.id, v_request.application_id, v_previous, v_request.assigned_to, v_outcome, v_code, v_message
    );
  end loop;
  update public.application_assignment_batches set
    assigned_count = (
      select count(*) from public.application_assignment_batch_results
      where batch_id = v_batch.id and outcome = 'ASSIGNED'
    ),
    skipped_count = (
      select count(*) from public.application_assignment_batch_results
      where batch_id = v_batch.id and outcome = 'SKIPPED'
    ),
    failed_count = (
      select count(*) from public.application_assignment_batch_results
      where batch_id = v_batch.id and outcome = 'FAILED'
    ),
    status = case
      when not exists (
        select 1 from public.application_assignment_batch_results
        where batch_id = v_batch.id and outcome = 'ASSIGNED'
      ) then 'FAILED'
      when exists (
        select 1 from public.application_assignment_batch_results
        where batch_id = v_batch.id and outcome <> 'ASSIGNED'
      ) then 'COMPLETED_WITH_WARNINGS'
      else 'COMPLETED'
    end,
    completed_at = clock_timestamp()
  where id = v_batch.id;
  return public.assignment_batch_response_v08(v_batch.id);
end;
$$;
