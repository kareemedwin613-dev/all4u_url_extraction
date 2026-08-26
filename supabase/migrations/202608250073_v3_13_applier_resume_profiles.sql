-- Exclusive Applier ↔ Resume profile allowlist.
-- Strict empty mapping: Appliers with no mapped Resumes cannot receive Applications.
-- Exclusive profiles: each Resume maps to at most one Applier.

create table if not exists public.applier_resume_profiles (
  id uuid primary key default gen_random_uuid(),
  applier_user_id uuid not null references public.profiles(id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint applier_resume_profiles_resume_unique unique (resume_id),
  constraint applier_resume_profiles_applier_resume_unique unique (applier_user_id, resume_id)
);

create index if not exists applier_resume_profiles_applier_idx
  on public.applier_resume_profiles(applier_user_id);

alter table public.applier_resume_profiles enable row level security;

drop policy if exists "managers read applier resume profiles" on public.applier_resume_profiles;
create policy "managers read applier resume profiles" on public.applier_resume_profiles
for select to authenticated
using (
  (select public.application_actor_can_manage())
  or applier_user_id = auth.uid()
);

drop policy if exists "managers insert applier resume profiles" on public.applier_resume_profiles;
create policy "managers insert applier resume profiles" on public.applier_resume_profiles
for insert to authenticated
with check ((select public.application_actor_can_manage()));

drop policy if exists "managers update applier resume profiles" on public.applier_resume_profiles;
create policy "managers update applier resume profiles" on public.applier_resume_profiles
for update to authenticated
using ((select public.application_actor_can_manage()))
with check ((select public.application_actor_can_manage()));

drop policy if exists "managers delete applier resume profiles" on public.applier_resume_profiles;
create policy "managers delete applier resume profiles" on public.applier_resume_profiles
for delete to authenticated
using ((select public.application_actor_can_manage()));

comment on table public.applier_resume_profiles is
  'Exclusive Applier-to-ORIGINAL-resume allowlist. Appliers with zero rows cannot be assigned Applications.';

-- Returns null when allowed; otherwise an error code for bulk preview/assign.
create or replace function public.applier_resume_allowlist_code(p_applier uuid, p_resume uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
  if not exists (
    select 1 from public.applier_resume_profiles m
    where m.applier_user_id = p_applier and m.resume_id = p_resume
  ) then
    return 'APPLIER_RESUME_NOT_ALLOWED';
  end if;
  return null;
end;
$$;

create or replace function public.assert_applier_may_use_resume(p_applier uuid, p_resume uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if p_applier is null then
    return;
  end if;
  v_code := public.applier_resume_allowlist_code(p_applier, p_resume);
  if v_code = 'APPLIER_PROFILE_REQUIRED' then
    raise exception 'APPLIER_PROFILE_REQUIRED: This Applier cannot receive Applications until at least one Resume profile is assigned.'
      using errcode = 'P0001';
  elsif v_code = 'APPLIER_RESUME_NOT_ALLOWED' then
    raise exception 'APPLIER_RESUME_NOT_ALLOWED: Resume is not assigned to this Applier.'
      using errcode = 'P0001';
  elsif v_code is not null then
    raise exception 'APPLICATION_INVALID_ASSIGNEE: Select an active user with the Applier role.'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.list_applier_resume_profiles_v313(p_applier_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.application_actor_can_manage() and p_applier_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: You do not have access to these Applier resume profiles.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_applier_user_id
      and exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.code = 'APPLIER' and r.active
      )
  ) then
    raise exception 'APPLIER_NOT_FOUND: Applier was not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'applierUserId', m.applier_user_id,
    'resumeId', m.resume_id,
    'resumeNumber', r.resume_number,
    'resumeName', r.resume_name,
    'candidateName', r.candidate_name,
    'status', r.status,
    'resumeType', r.resume_type,
    'createdBy', m.created_by,
    'createdAt', m.created_at
  ) order by r.candidate_name, r.resume_name, m.resume_id), '[]'::jsonb)
  into v_result
  from public.applier_resume_profiles m
  join public.resumes r on r.id = m.resume_id
  where m.applier_user_id = p_applier_user_id;
  return v_result;
end;
$$;

create or replace function public.list_applier_resume_profile_options_v313()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(jsonb_build_object(
    'resumeId', r.id,
    'resumeNumber', r.resume_number,
    'resumeName', r.resume_name,
    'candidateName', r.candidate_name,
    'status', r.status,
    'ownerApplierUserId', m.applier_user_id,
    'ownerDisplayName', case when m.applier_user_id is null then null else coalesce(nullif(p.full_name, ''), p.email) end,
    'ownerEmail', p.email
  ) order by r.candidate_name, r.resume_name, r.id), '[]'::jsonb)
  into v_result
  from public.resumes r
  left join public.applier_resume_profiles m on m.resume_id = r.id
  left join public.profiles p on p.id = m.applier_user_id
  where r.resume_type = 'ORIGINAL' and r.status = 'ACTIVE';
  return v_result;
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
  v_row record;
begin
  if not public.resume_actor_can_view(p_resume_id) then
    raise exception 'FORBIDDEN: You do not have access to this Resume.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.resumes where id = p_resume_id) then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode = 'P0001';
  end if;
  select m.id, m.applier_user_id, m.resume_id, m.created_by, m.created_at,
    coalesce(nullif(p.full_name, ''), p.email) display_name, p.email
  into v_row
  from public.applier_resume_profiles m
  join public.profiles p on p.id = m.applier_user_id
  where m.resume_id = p_resume_id;
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

create or replace function public.set_applier_resume_profiles_v313(p_applier_user_id uuid, p_resume_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_resume_id uuid;
  v_resume public.resumes;
  v_owner uuid;
  v_owner_name text;
begin
  perform public.assert_application_manager();
  if not exists (
    select 1 from public.profiles p
    where p.id = p_applier_user_id and p.status = 'ACTIVE'
      and exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.code = 'APPLIER' and r.active
      )
  ) then
    raise exception 'APPLIER_NOT_FOUND: Select an active user with the Applier role.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[])
  into v_ids
  from unnest(coalesce(p_resume_ids, array[]::uuid[])) x
  where x is not null;

  if cardinality(v_ids) > 200 then
    raise exception 'VALIDATION_ERROR: Assign no more than 200 Resume profiles to one Applier.' using errcode = '22023';
  end if;

  foreach v_resume_id in array v_ids loop
    select * into v_resume from public.resumes where id = v_resume_id;
    if not found then
      raise exception 'RESUME_NOT_FOUND: One or more selected Resumes were not found.' using errcode = 'P0001';
    end if;
    if v_resume.resume_type <> 'ORIGINAL' then
      raise exception 'RESUME_TYPE_INVALID: Only original Resumes can be assigned as Applier profiles.' using errcode = '22023';
    end if;
    if v_resume.status <> 'ACTIVE' then
      raise exception 'RESUME_INACTIVE: Only active Resumes can be assigned as Applier profiles.' using errcode = '22023';
    end if;
    select m.applier_user_id, coalesce(nullif(p.full_name, ''), p.email)
    into v_owner, v_owner_name
    from public.applier_resume_profiles m
    join public.profiles p on p.id = m.applier_user_id
    where m.resume_id = v_resume_id;
    if found and v_owner is distinct from p_applier_user_id then
      raise exception 'RESUME_PROFILE_TAKEN: Resume "%" is already assigned to %.',
        coalesce(nullif(v_resume.resume_name, ''), v_resume.candidate_name, v_resume.id::text),
        coalesce(v_owner_name, 'another Applier')
        using errcode = '23505';
    end if;
  end loop;

  delete from public.applier_resume_profiles
  where applier_user_id = p_applier_user_id
    and not (resume_id = any (v_ids));

  insert into public.applier_resume_profiles (applier_user_id, resume_id, created_by)
  select p_applier_user_id, x, auth.uid()
  from unnest(v_ids) x
  on conflict (resume_id) do nothing;

  return public.list_applier_resume_profiles_v313(p_applier_user_id);
end;
$$;

-- Enrich Applier directory with assigned profile summary.
create or replace function public.list_active_appliers(p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name, x.email), '[]'::jsonb) into v_result
  from (
    select p.id, p.email, coalesce(nullif(p.full_name, ''), p.email) display_name,
      count(a.id) filter (where a.work_status not in ('COMPLETED', 'CANCELLED'))::integer active_application_count,
      coalesce((
        select count(*)::integer from public.applier_resume_profiles m where m.applier_user_id = p.id
      ), 0) assigned_profile_count,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'resumeId', r.id,
          'resumeName', r.resume_name,
          'candidateName', r.candidate_name
        ) order by r.candidate_name, r.resume_name, r.id)
        from public.applier_resume_profiles m
        join public.resumes r on r.id = m.resume_id
        where m.applier_user_id = p.id
      ), '[]'::jsonb) assigned_profiles
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    join public.roles r on r.id = ur.role_id and r.code = 'APPLIER' and r.active
    left join public.applications a on a.assigned_to = p.id
    where p.status = 'ACTIVE' and (
      coalesce(trim(p_search), '') = ''
      or p.email ilike '%' || trim(p_search) || '%'
      or p.full_name ilike '%' || trim(p_search) || '%'
    )
    group by p.id
    order by coalesce(nullif(p.full_name, ''), p.email), p.email
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) x;
  return v_result;
end;
$$;

-- Enforce allowlist when creating an Application with an assignee.
create or replace function public.create_application(
  p_job_description_id uuid,
  p_resume_id uuid,
  p_assigned_to uuid,
  p_priority text,
  p_due_at timestamptz,
  p_notes text
)
returns jsonb
language plpgsql
security definer
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
  if v_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = 'P0001';
  end if;
  perform public.assert_active_applier(p_assigned_to);
  perform public.assert_applier_may_use_resume(p_assigned_to, p_resume_id);

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

create or replace function public.reassign_application(
  p_application_id uuid,
  p_new_assignee_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
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
  perform public.assert_applier_may_use_resume(p_new_assignee_id, v_current.resume_id);
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
    application_id, previous_assignee_id, new_assignee_id, assigned_by, reason
  ) values (v_updated.id, v_current.assigned_to, p_new_assignee_id, v_actor, nullif(trim(coalesce(p_reason, '')), ''));
  if v_current.work_status is distinct from v_new_work then
    insert into public.application_status_history(application_id, status_type, previous_status, new_status, changed_by, notes)
    values (v_updated.id, 'WORK_STATUS', v_current.work_status, v_new_work, v_actor, nullif(left(coalesce(p_reason, ''), 2000), ''));
  end if;
  return to_jsonb(v_updated);
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
  v_appliers uuid[];
  v_selected_apps integer;
  v_selected_appliers integer;
  v_code text;
begin
  perform public.assert_application_manager();
  if v_strategy not in ('MANUAL', 'EVEN', 'CAPACITY_AWARE') then
    raise exception 'INVALID_STRATEGY: Select a supported assignment strategy.' using errcode = '22023';
  end if;
  if v_strategy = 'MANUAL' then
    if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
      raise exception 'VALIDATION_ERROR: assignments must be an array.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x.application_id), array[]::uuid[]),
      coalesce(array_agg(distinct x.assigned_to), array[]::uuid[])
    into v_apps, v_appliers
    from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb)) x(application_id uuid, assigned_to uuid);
  else
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_apps
    from unnest(coalesce(p_application_ids, array[]::uuid[])) x where x is not null;
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_appliers
    from unnest(coalesce(p_applier_ids, array[]::uuid[])) x where x is not null;
  end if;
  v_selected_apps := cardinality(v_apps);
  v_selected_appliers := cardinality(v_appliers);
  if v_selected_apps = 0 then
    raise exception 'NO_ELIGIBLE_APPLICATIONS: Select at least one Application.' using errcode = '22023';
  end if;
  if v_selected_apps > 2000 then
    raise exception 'APPLICATION_LIMIT_EXCEEDED: Select no more than 2,000 Applications.' using errcode = '22023';
  end if;
  if v_selected_appliers = 0 then
    raise exception 'NO_ELIGIBLE_APPLIERS: Select at least one Applier.' using errcode = '22023';
  end if;
  if v_selected_appliers > 100 then
    raise exception 'APPLIER_LIMIT_EXCEEDED: Select no more than 100 Appliers.' using errcode = '22023';
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
  create temporary table v08_preview_appliers on commit drop as
    select p.id user_id, coalesce(nullif(p.full_name, ''), p.email) full_name, p.email,
      coalesce(s.is_available, true) is_available,
      coalesce(s.max_active_applications, 50) max_capacity,
      count(a.id) filter (
        where a.work_status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') and not (a.id = any (v_apps))
      )::integer current_workload,
      0::integer proposed_count,
      (p.status = 'ACTIVE' and coalesce(s.is_available, true) and exists (
        select 1 from public.user_roles ur
        join public.roles rr on rr.id = ur.role_id
        where ur.user_id = p.id and rr.code = 'APPLIER' and rr.active
      )) eligible,
      exists (
        select 1 from public.applier_resume_profiles m where m.applier_user_id = p.id
      ) has_profiles
    from unnest(v_appliers) i(id)
    join public.profiles p on p.id = i.id
    left join public.applier_workload_settings s on s.user_id = p.id
    left join public.applications a on a.assigned_to = p.id
    group by p.id, s.user_id, s.is_available, s.max_active_applications;
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
    if v_strategy = 'MANUAL' then
      select ap.* into v_target
      from v08_preview_appliers ap
      join jsonb_to_recordset(p_assignments) x(application_id uuid, assigned_to uuid)
        on x.assigned_to = ap.user_id
      where x.application_id = v_app.application_id
      limit 1;
      if found then
        v_code := public.applier_resume_allowlist_code(v_target.user_id, v_app.resume_id);
        if v_code is not null then
          insert into v08_preview_exclusions values (
            v_app.application_id,
            v_code,
            case v_code
              when 'APPLIER_PROFILE_REQUIRED' then 'Applier has no profiles.'
              when 'APPLIER_RESUME_NOT_ALLOWED' then 'Resume not assigned to this Applier.'
              else 'No selected active and available Applier can receive this Application.'
            end
          ) on conflict do nothing;
          continue;
        end if;
      end if;
    elsif v_strategy = 'EVEN' then
      select * into v_target
      from v08_preview_appliers
      where eligible
        and current_workload + proposed_count < max_capacity
        and public.applier_resume_allowlist_code(user_id, v_app.resume_id) is null
      order by current_workload + proposed_count, user_id
      limit 1;
    else
      select * into v_target
      from v08_preview_appliers
      where eligible
        and current_workload + proposed_count < max_capacity
        and public.applier_resume_allowlist_code(user_id, v_app.resume_id) is null
      order by max_capacity - current_workload - proposed_count desc, current_workload + proposed_count, user_id
      limit 1;
    end if;

    if not found or not v_target.eligible then
      if v_strategy <> 'MANUAL'
        and exists (select 1 from v08_preview_appliers where eligible and not has_profiles)
        and not exists (
          select 1 from v08_preview_appliers
          where eligible and has_profiles
            and public.applier_resume_allowlist_code(user_id, v_app.resume_id) is null
        ) then
        insert into v08_preview_exclusions values (
          v_app.application_id,
          'APPLIER_PROFILE_REQUIRED',
          'Applier has no profiles.'
        ) on conflict do nothing;
      elsif v_strategy <> 'MANUAL'
        and exists (select 1 from v08_preview_appliers where eligible and has_profiles) then
        insert into v08_preview_exclusions values (
          v_app.application_id,
          'APPLIER_RESUME_NOT_ALLOWED',
          'Resume not assigned to this Applier.'
        ) on conflict do nothing;
      else
        insert into v08_preview_exclusions values (
          v_app.application_id,
          'NO_ELIGIBLE_APPLIER',
          'No selected active and available Applier can receive this Application.'
        ) on conflict do nothing;
      end if;
    elsif v_app.assigned_to is not distinct from v_target.user_id then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'SAME_ASSIGNEE', 'Application is already assigned to this Applier.'
      ) on conflict do nothing;
    elsif v_target.current_workload + v_target.proposed_count >= v_target.max_capacity then
      insert into v08_preview_exclusions values (
        v_app.application_id, 'CAPACITY_EXCEEDED', 'The selected Applier has no remaining capacity.'
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
    'selectedApplierCount', v_selected_appliers,
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
  if v_strategy not in ('MANUAL', 'EVEN', 'CAPACITY_AWARE') then
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
  if jsonb_array_length(p_assignments) > 2000 then
    raise exception 'APPLICATION_LIMIT_EXCEEDED: Assign no more than 2,000 Applications.' using errcode = '22023';
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
      elsif not v_setting.is_available then
        v_code := 'APPLIER_UNAVAILABLE';
        v_message := 'Applier is unavailable for assignment.';
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
          select count(*) into v_current
          from public.applications a
          where a.assigned_to = v_request.assigned_to
            and a.work_status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
            and not exists (select 1 from v08_commit_requests r where r.application_id = a.id);
          select added into v_added from v08_commit_added where user_id = v_request.assigned_to;
          if v_current + coalesce(v_added, 0) >= v_setting.max_capacity then
            v_code := 'CAPACITY_EXCEEDED';
            v_message := 'Applier capacity has been reached.';
          else
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

revoke all on function public.applier_resume_allowlist_code(uuid, uuid) from public, anon;
revoke all on function public.assert_applier_may_use_resume(uuid, uuid) from public, anon;
revoke all on function public.list_applier_resume_profiles_v313(uuid) from public, anon;
revoke all on function public.list_applier_resume_profile_options_v313() from public, anon;
revoke all on function public.get_resume_applier_profile_v313(uuid) from public, anon;
revoke all on function public.set_applier_resume_profiles_v313(uuid, uuid[]) from public, anon;

grant execute on function public.applier_resume_allowlist_code(uuid, uuid) to authenticated;
grant execute on function public.assert_applier_may_use_resume(uuid, uuid) to authenticated;
grant execute on function public.list_applier_resume_profiles_v313(uuid) to authenticated;
grant execute on function public.list_applier_resume_profile_options_v313() to authenticated;
grant execute on function public.get_resume_applier_profile_v313(uuid) to authenticated;
grant execute on function public.set_applier_resume_profiles_v313(uuid, uuid[]) to authenticated;
