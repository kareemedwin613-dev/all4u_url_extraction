-- v3.32: Admin activity log across application lifecycle events.

create or replace function public.map_activity_status_action(
  p_status_type text,
  p_previous_status text,
  p_new_status text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_status_type in ('STATUS', 'APPLICATION_STATUS') and p_new_status = 'APPLIED' then 'APPLICATION_SUBMITTED'
    when p_status_type in ('STATUS', 'APPLICATION_STATUS') and p_new_status = 'BLOCKED' then 'APPLICATION_BLOCKED'
    when p_status_type in ('WORK_STATUS', 'STATUS') and p_new_status = 'ASSIGNED' and coalesce(p_previous_status, '') <> 'ASSIGNED' then 'APPLICATION_ASSIGNED'
    when p_status_type in ('WORK_STATUS', 'STATUS') and p_new_status = 'IN_PROGRESS' then 'APPLICATION_STARTED'
    when p_status_type in ('WORK_STATUS', 'STATUS') and p_new_status = 'CANCELLED' then 'APPLICATION_CANCELLED'
    when p_status_type in ('WORK_STATUS', 'STATUS') and p_new_status = 'CLOSED' then 'APPLICATION_CLOSED'
    when p_status_type = 'WORK_STATUS' then 'WORK_STATUS_CHANGED'
    when p_status_type = 'APPLICATION_STATUS' then 'APPLICATION_STATUS_CHANGED'
    else 'STATUS_CHANGED'
  end;
$$;

create or replace function public.map_activity_status_label(
  p_status_type text,
  p_previous_status text,
  p_new_status text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case public.map_activity_status_action(p_status_type, p_previous_status, p_new_status)
    when 'APPLICATION_SUBMITTED' then 'Application submitted'
    when 'APPLICATION_BLOCKED' then 'Application blocked'
    when 'APPLICATION_ASSIGNED' then 'Application assigned'
    when 'APPLICATION_STARTED' then 'Application started'
    when 'APPLICATION_CANCELLED' then 'Application cancelled'
    when 'APPLICATION_CLOSED' then 'Application closed'
    when 'WORK_STATUS_CHANGED' then 'Work status changed to ' || replace(lower(p_new_status), '_', ' ')
    when 'APPLICATION_STATUS_CHANGED' then 'Application status changed to ' || replace(lower(p_new_status), '_', ' ')
    else 'Status changed to ' || replace(lower(p_new_status), '_', ' ')
  end;
$$;

create or replace function public.list_admin_activity_log_v32(
  p_from timestamptz,
  p_to timestamptz,
  p_applier_id uuid default null,
  p_application_id uuid default null,
  p_action text default null,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id text,
  occurred_at timestamptz,
  action text,
  action_label text,
  applier_id uuid,
  applier_name text,
  actor_id uuid,
  actor_name text,
  application_id uuid,
  application_number bigint,
  job_title text,
  company text,
  detail text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := left(trim(coalesce(p_search, '')), 100);
  v_action text := nullif(upper(trim(coalesce(p_action, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.assert_active_admin();

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'VALIDATION_ERROR: A valid activity log date range is required.' using errcode = '22023';
  end if;

  if v_action is not null and v_action not in (
    'APPLICATION_SUBMITTED', 'APPLICATION_BLOCKED', 'APPLICATION_ASSIGNED', 'APPLICATION_STARTED',
    'APPLICATION_CANCELLED', 'APPLICATION_CLOSED', 'WORK_STATUS_CHANGED', 'APPLICATION_STATUS_CHANGED',
    'STATUS_CHANGED', 'SCREENSHOT_UPLOADED', 'APPLICATION_REASSIGNED', 'APPLICATION_UNASSIGNED',
    'EXTENSION_SESSION_STARTED', 'EXTENSION_JOB_READY', 'EXTENSION_AUTOFILL_COMPLETED',
    'EXTENSION_AUTOFILL_FAILED', 'EXTENSION_SESSION_CANCELLED'
  ) then
    raise exception 'VALIDATION_ERROR: Invalid activity action.' using errcode = '22023';
  end if;

  return query
  with events as (
    select
      h.id::text as id,
      h.created_at as occurred_at,
      public.map_activity_status_action(h.status_type, h.previous_status, h.new_status) as action,
      public.map_activity_status_label(h.status_type, h.previous_status, h.new_status) as action_label,
      a.assigned_to as applier_id,
      h.changed_by as actor_id,
      h.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(left(trim(coalesce(h.notes, '')), 2000), '') as detail
    from public.application_status_history h
    join public.applications a on a.id = h.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where h.created_at >= p_from
      and h.created_at < p_to
      and (p_application_id is null or h.application_id = p_application_id)

    union all

    select
      s.id::text,
      s.created_at,
      'SCREENSHOT_UPLOADED',
      'Screenshot uploaded',
      a.assigned_to,
      s.uploaded_by,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      s.original_filename
    from public.application_screenshots s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where s.created_at >= p_from
      and s.created_at < p_to
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      ah.id::text,
      ah.created_at,
      case
        when ah.new_assignee_id is null and ah.previous_assignee_id is not null then 'APPLICATION_UNASSIGNED'
        when ah.previous_assignee_id is not null and ah.new_assignee_id is not null then 'APPLICATION_REASSIGNED'
        else 'APPLICATION_ASSIGNED'
      end,
      case
        when ah.new_assignee_id is null and ah.previous_assignee_id is not null then 'Application unassigned'
        when ah.previous_assignee_id is not null and ah.new_assignee_id is not null then 'Application reassigned'
        else 'Application assigned'
      end,
      coalesce(ah.new_assignee_id, ah.previous_assignee_id),
      ah.assigned_by,
      ah.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(left(trim(coalesce(ah.reason, '')), 2000), '')
    from public.application_assignment_history ah
    join public.applications a on a.id = ah.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where ah.created_at >= p_from
      and ah.created_at < p_to
      and (p_application_id is null or ah.application_id = p_application_id)

    union all

    select
      s.id::text || ':started',
      s.created_at,
      'EXTENSION_SESSION_STARTED',
      case s.action
        when 'LOAD_RESUME' then 'Extension resume session started'
        else 'Extension autofill session started'
      end,
      a.assigned_to,
      s.user_id,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(s.extension_version, '')
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where s.created_at >= p_from
      and s.created_at < p_to
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      s.id::text || ':ready',
      s.updated_at,
      'EXTENSION_JOB_READY',
      'Job page ready in extension',
      a.assigned_to,
      s.user_id,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(s.extension_version, '')
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where s.updated_at >= p_from
      and s.updated_at < p_to
      and s.status in ('TARGET_READY', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
      and s.updated_at > s.created_at
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      s.id::text || ':completed',
      coalesce(s.ended_at, s.updated_at),
      'EXTENSION_AUTOFILL_COMPLETED',
      'Extension autofill completed',
      a.assigned_to,
      s.user_id,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(s.extension_version, '')
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where coalesce(s.ended_at, s.updated_at) >= p_from
      and coalesce(s.ended_at, s.updated_at) < p_to
      and s.status = 'COMPLETED'
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      s.id::text || ':failed',
      coalesce(s.ended_at, s.updated_at),
      'EXTENSION_AUTOFILL_FAILED',
      'Extension autofill failed',
      a.assigned_to,
      s.user_id,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      coalesce(nullif(s.error_code, ''), nullif(s.extension_version, ''))
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where coalesce(s.ended_at, s.updated_at) >= p_from
      and coalesce(s.ended_at, s.updated_at) < p_to
      and s.status = 'FAILED'
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      s.id::text || ':cancelled',
      coalesce(s.ended_at, s.updated_at),
      'EXTENSION_SESSION_CANCELLED',
      case s.status
        when 'EXPIRED' then 'Extension session expired'
        else 'Extension session cancelled'
      end,
      a.assigned_to,
      s.user_id,
      s.application_id,
      a.application_number,
      j.job_title,
      j.company,
      nullif(s.extension_version, '')
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where coalesce(s.ended_at, s.updated_at) >= p_from
      and coalesce(s.ended_at, s.updated_at) < p_to
      and s.status in ('CANCELLED', 'EXPIRED')
      and (p_application_id is null or s.application_id = p_application_id)
  ),
  enriched as (
    select
      e.id,
      e.occurred_at,
      e.action,
      e.action_label,
      e.applier_id,
      applier.full_name as applier_name,
      e.actor_id,
      actor.full_name as actor_name,
      e.application_id,
      e.application_number,
      e.job_title,
      e.company,
      e.detail
    from events e
    left join public.profiles applier on applier.id = e.applier_id
    left join public.profiles actor on actor.id = e.actor_id
  ),
  filtered as (
    select enriched.*
    from enriched
    where (p_applier_id is null or enriched.applier_id = p_applier_id or enriched.actor_id = p_applier_id)
      and (v_action is null or enriched.action = v_action)
      and (
        v_search = ''
        or enriched.job_title ilike '%' || v_search || '%'
        or enriched.company ilike '%' || v_search || '%'
        or coalesce(enriched.applier_name, '') ilike '%' || v_search || '%'
        or coalesce(enriched.actor_name, '') ilike '%' || v_search || '%'
        or coalesce(enriched.action_label, '') ilike '%' || v_search || '%'
        or coalesce(enriched.detail, '') ilike '%' || v_search || '%'
        or enriched.application_number::text ilike '%' || v_search || '%'
      )
  )
  select
    filtered.id,
    filtered.occurred_at,
    filtered.action,
    filtered.action_label,
    filtered.applier_id,
    filtered.applier_name,
    filtered.actor_id,
    filtered.actor_name,
    filtered.application_id,
    filtered.application_number,
    filtered.job_title,
    filtered.company,
    filtered.detail,
    count(*) over()
  from filtered
  order by filtered.occurred_at desc, filtered.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_admin_activity_log_v32(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_admin_activity_log_v32(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) to authenticated;
