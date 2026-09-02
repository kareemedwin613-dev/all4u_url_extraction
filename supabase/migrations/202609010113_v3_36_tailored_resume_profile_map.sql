-- v3.36: an ORIGINAL Resume and every TAILORED child share one Profile Map identity.

create or replace function public.resume_profile_root_id_v336(p_resume_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(r.parent_resume_id, r.id)
  from public.resumes r
  where r.id = p_resume_id
$$;

-- Returns null when allowed; otherwise an error code for assignment preview/commit.
create or replace function public.applier_resume_allowlist_code(p_applier uuid, p_resume uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_resume uuid := public.resume_profile_root_id_v336(p_resume);
begin
  if p_applier is null then
    return null;
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_applier and p.status = 'ACTIVE'
      and exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.code = 'APPLIER' and r.active
      )
  ) then
    return 'APPLIER_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.applier_resume_profiles m where m.applier_user_id = p_applier
  ) then
    return 'APPLIER_PROFILE_REQUIRED';
  end if;
  if v_profile_resume is null or not exists (
    select 1 from public.applier_resume_profiles m
    where m.applier_user_id = p_applier and m.resume_id = v_profile_resume
  ) then
    return 'APPLIER_RESUME_NOT_ALLOWED';
  end if;
  return null;
end;
$$;

create or replace function public.get_resume_applier_profile_v313(p_resume_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_resume uuid;
  v_row record;
begin
  if not public.resume_actor_can_view(p_resume_id) then
    raise exception 'FORBIDDEN: You do not have access to this Resume.' using errcode = '42501';
  end if;
  v_profile_resume := public.resume_profile_root_id_v336(p_resume_id);
  if v_profile_resume is null then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode = 'P0001';
  end if;
  select m.id, m.applier_user_id, m.resume_id, m.created_by, m.created_at,
    coalesce(nullif(p.full_name, ''), p.email) display_name, p.email
  into v_row
  from public.applier_resume_profiles m
  join public.profiles p on p.id = m.applier_user_id
  where m.resume_id = v_profile_resume;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'applierUserId', v_row.applier_user_id,
    'resumeId', v_row.resume_id,
    'displayName', v_row.display_name,
    'email', v_row.email,
    'createdBy', v_row.created_by,
    'createdAt', v_row.created_at
  );
end;
$$;

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
    where m.resume_id = public.resume_profile_root_id_v336(v_app.resume_id)
    limit 1;

    if v_profile_applier is null then
      insert into v08_preview_exclusions values (
        v_app.application_id,
        'RESUME_PROFILE_MISSING',
        'This Resume and its original profile are not assigned to any Applier.'
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

revoke all on function public.resume_profile_root_id_v336(uuid) from public, anon, authenticated;
revoke all on function public.applier_resume_allowlist_code(uuid, uuid) from public, anon;
revoke all on function public.get_resume_applier_profile_v313(uuid) from public, anon;
revoke all on function public.preview_bulk_assignment_v08(uuid[], uuid[], text, jsonb) from public, anon;
grant execute on function public.applier_resume_allowlist_code(uuid, uuid) to authenticated;
grant execute on function public.get_resume_applier_profile_v313(uuid) to authenticated;
grant execute on function public.preview_bulk_assignment_v08(uuid[], uuid[], text, jsonb) to authenticated;

comment on function public.resume_profile_root_id_v336(uuid) is
  'Resolves an ORIGINAL Resume or any TAILORED child to the canonical ORIGINAL Resume used by Profile Map.';
comment on function public.applier_resume_allowlist_code(uuid, uuid) is
  'Checks Profile Map ownership using the canonical ORIGINAL Resume for original and tailored artifacts.';
