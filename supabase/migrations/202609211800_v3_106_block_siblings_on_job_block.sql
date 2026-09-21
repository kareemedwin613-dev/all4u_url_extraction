-- When an Application is marked BLOCKED, sibling open Applications on the same JD
-- must become BLOCKED (not CANCELLED). Also repair cascade-cancelled rows.

create or replace function public.block_sibling_applications_for_blocked_job_v3106(
  p_job_description_id uuid,
  p_source_application_id uuid,
  p_actor uuid,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sibling public.applications;
  v_updated public.applications;
  v_count integer := 0;
  v_notes text := left(coalesce(nullif(btrim(p_notes), ''), 'Blocked for all profiles.'), 2000);
  v_sibling_notes text := left('Blocked because this job was blocked for all profiles: ' || v_notes, 2000);
begin
  for v_sibling in
    select *
    from public.applications
    where job_description_id = p_job_description_id
      and id <> p_source_application_id
      and status in ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS')
    order by id
    for update
  loop
    update public.applications
    set
      status = 'BLOCKED',
      notes = case
        when nullif(btrim(coalesce(notes, '')), '') is null then v_sibling_notes
        else left(btrim(notes) || E'\n' || v_sibling_notes, 10000)
      end,
      updated_at = now()
    where id = v_sibling.id
    returning * into v_updated;

    insert into public.application_status_history(
      application_id, status_type, previous_status, new_status, changed_by, notes
    ) values (
      v_updated.id, 'STATUS', v_sibling.status, 'BLOCKED', p_actor, v_sibling_notes
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.block_sibling_applications_for_blocked_job_v3106(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- Keep the old name as a thin wrapper so any leftover callers stay correct.
create or replace function public.cancel_sibling_applications_for_blocked_job_v385(
  p_job_description_id uuid,
  p_source_application_id uuid,
  p_actor uuid,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.block_sibling_applications_for_blocked_job_v3106(
    p_job_description_id,
    p_source_application_id,
    p_actor,
    p_notes
  );
end;
$$;

create or replace function public.update_application_status_v101(
  p_application_id uuid,
  p_status text,
  p_application_url text,
  p_applied_at timestamptz,
  p_notes text,
  p_priority text,
  p_due_at timestamptz
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
  v_manager boolean;
  v_status text := upper(trim(coalesce(p_status, '')));
  v_priority text := upper(trim(coalesce(p_priority, '')));
  v_applied_at timestamptz := p_applied_at;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_siblings_blocked integer := 0;
  v_block_notes text;
begin
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (
    public.is_active_user(v_actor)
    and public.has_role('APPLIER', v_actor)
    and v_current.assigned_to = v_actor
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot update this Application.' using errcode = '42501';
  end if;
  if v_status not in (
    'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'APPLIED', 'SCREENING',
    'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'CANCELLED'
  ) then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid status.' using errcode = '22023';
  end if;
  if v_current.assigned_to is null and v_status not in ('UNASSIGNED', 'CANCELLED') then
    raise exception 'APPLICATION_UNASSIGNED: Assign an Applier before changing status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is not null and v_status = 'UNASSIGNED' then
    raise exception 'APPLICATION_ASSIGNED: Unassign the Application instead of selecting Unassigned.' using errcode = 'P0001';
  end if;
  if not v_manager and v_status in ('UNASSIGNED', 'CANCELLED') then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Appliers cannot cancel or unassign Applications.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_application_url, '')) > 4000
    or (
      nullif(trim(coalesce(p_application_url, '')), '') is not null
      and p_application_url !~* '^https?://'
    )
  then
    raise exception 'APPLICATION_INVALID_URL: Enter a valid HTTP or HTTPS URL.' using errcode = '22023';
  end if;
  if v_manager and v_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = '22023';
  end if;
  if v_status = 'BLOCKED' and v_notes is null then
    raise exception 'APPLICATION_NOTES_REQUIRED: Add a note explaining why this Application is blocked.' using errcode = '22023';
  end if;
  if v_status = 'APPLIED' and v_applied_at is null then
    v_applied_at := coalesce(v_current.applied_at, now());
  end if;
  if not v_manager and v_status = 'APPLIED' and v_current.status is distinct from v_status then
    if coalesce(nullif(trim(coalesce(p_application_url, '')), ''), v_current.application_url) is null then
      raise exception 'APPLICATION_APPLIED_REQUIRES_URL: Add an Application URL before marking this Application Applied.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.application_screenshots where application_id = p_application_id) then
      raise exception 'APPLICATION_APPLIED_REQUIRES_SCREENSHOT: Attach at least one confirmation screenshot before marking this Application Applied.' using errcode = '22023';
    end if;
  end if;

  update public.applications set
    status = v_status,
    application_url = nullif(trim(coalesce(p_application_url, '')), ''),
    applied_at = case
      when v_manager then v_applied_at
      when v_status = 'APPLIED' then coalesce(v_current.applied_at, now())
      else v_current.applied_at
    end,
    notes = case when p_notes is null and not v_manager then notes else v_notes end,
    priority = case when v_manager then v_priority else priority end,
    due_at = case when v_manager then p_due_at else due_at end,
    updated_at = now()
  where id = p_application_id
  returning * into v_updated;

  if v_current.status is distinct from v_updated.status then
    insert into public.application_status_history(
      application_id, status_type, previous_status, new_status, changed_by, notes
    ) values (
      v_updated.id, 'STATUS', v_current.status, v_updated.status, v_actor,
      nullif(left(coalesce(v_notes, ''), 2000), '')
    );
  end if;

  if v_updated.status = 'BLOCKED' and v_current.status is distinct from 'BLOCKED' then
    v_block_notes := left(coalesce(v_notes, 'Blocked for all profiles.'), 2000);
    update public.job_descriptions set
      application_blocked_at = coalesce(application_blocked_at, now()),
      application_blocked_by = coalesce(application_blocked_by, v_actor),
      application_blocked_notes = case
        when nullif(btrim(application_blocked_notes), '') is null then v_block_notes
        else application_blocked_notes
      end,
      application_blocked_from_application_id = coalesce(application_blocked_from_application_id, v_updated.id),
      updated_at = now()
    where id = v_updated.job_description_id;

    v_siblings_blocked := public.block_sibling_applications_for_blocked_job_v3106(
      v_updated.job_description_id,
      v_updated.id,
      v_actor,
      v_block_notes
    );
  end if;

  return to_jsonb(v_updated) || jsonb_build_object(
    'job_application_blocked', exists(
      select 1 from public.job_descriptions j
      where j.id = v_updated.job_description_id and j.application_blocked_at is not null
    ),
    'siblings_blocked', v_siblings_blocked,
    -- Compatibility for older clients that still read the cancelled field name.
    'siblings_cancelled', v_siblings_blocked
  );
end;
$$;

-- Repair Applications previously cascade-cancelled by the v385 behavior.
with to_repair as (
  select
    a.id,
    a.status as previous_status,
    a.notes,
    coalesce(j.application_blocked_by, a.assigned_to, a.created_by) as actor_id,
    left(
      'Blocked because this job was blocked for all profiles: '
        || coalesce(nullif(btrim(j.application_blocked_notes), ''), 'Blocked for all profiles.'),
      2000
    ) as repair_notes
  from public.applications a
  join public.job_descriptions j on j.id = a.job_description_id
  where j.application_blocked_at is not null
    and a.id is distinct from j.application_blocked_from_application_id
    and a.status = 'CANCELLED'
    and a.notes ilike '%Cancelled because this job was blocked for all profiles:%'
),
updated as (
  update public.applications a
  set
    status = 'BLOCKED',
    notes = case
      when nullif(btrim(coalesce(a.notes, '')), '') is null then t.repair_notes
      else left(btrim(a.notes) || E'\n' || t.repair_notes, 10000)
    end,
    updated_at = now()
  from to_repair t
  where a.id = t.id
  returning a.id, t.previous_status, t.actor_id, t.repair_notes
)
insert into public.application_status_history(
  application_id, status_type, previous_status, new_status, changed_by, notes
)
select id, 'STATUS', previous_status, 'BLOCKED', actor_id, repair_notes
from updated;

comment on function public.block_sibling_applications_for_blocked_job_v3106(uuid, uuid, uuid, text) is
  'When a JD is blocked for applications, set other open Applications on that JD to BLOCKED.';
