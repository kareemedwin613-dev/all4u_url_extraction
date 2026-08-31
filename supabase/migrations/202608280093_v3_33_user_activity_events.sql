-- v3.33: User login activity events with IP addresses for the admin activity log.

create table public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('USER_LOGIN')),
  client_type text not null check (client_type in ('DASHBOARD', 'EXTENSION')),
  ip_address inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  occurred_at timestamptz not null default now()
);

create index user_activity_events_occurred_idx
  on public.user_activity_events (occurred_at desc);
create index user_activity_events_user_occurred_idx
  on public.user_activity_events (user_id, occurred_at desc);

alter table public.user_activity_events enable row level security;
revoke all on public.user_activity_events from public, anon, authenticated;

create or replace function public.record_user_activity_event_v33(
  p_event_type text,
  p_client_type text,
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_ip inet;
begin
  if v_user_id is null or not public.is_active_user(v_user_id) then
    raise exception 'AUTH_REQUIRED: Sign in again.' using errcode = '42501';
  end if;

  if nullif(upper(trim(coalesce(p_event_type, ''))), '') <> 'USER_LOGIN' then
    raise exception 'VALIDATION_ERROR: Invalid activity event type.' using errcode = '22023';
  end if;

  if nullif(upper(trim(coalesce(p_client_type, ''))), '') not in ('DASHBOARD', 'EXTENSION') then
    raise exception 'VALIDATION_ERROR: Invalid client type.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_ip_address, '')), '') is not null then
    begin
      v_ip := trim(p_ip_address)::inet;
    exception
      when others then
        raise exception 'VALIDATION_ERROR: Invalid IP address.' using errcode = '22023';
    end;
  end if;

  if exists (
    select 1
    from public.user_activity_events
    where user_id = v_user_id
      and event_type = 'USER_LOGIN'
      and client_type = upper(trim(p_client_type))
      and occurred_at > now() - interval '5 minutes'
  ) then
    select e.id
    into v_event_id
    from public.user_activity_events e
    where e.user_id = v_user_id
      and e.event_type = 'USER_LOGIN'
      and e.client_type = upper(trim(p_client_type))
    order by e.occurred_at desc
    limit 1;
    return v_event_id;
  end if;

  insert into public.user_activity_events (
    user_id,
    event_type,
    client_type,
    ip_address,
    user_agent
  )
  values (
    v_user_id,
    'USER_LOGIN',
    upper(trim(p_client_type)),
    v_ip,
    nullif(left(trim(coalesce(p_user_agent, '')), 500), '')
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_user_activity_event_v33(text, text, text, text) from public, anon;
grant execute on function public.record_user_activity_event_v33(text, text, text, text) to authenticated;

create or replace function public.list_admin_activity_log_v33(
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
  ip_address text,
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
    'EXTENSION_AUTOFILL_FAILED', 'EXTENSION_SESSION_CANCELLED', 'USER_LOGIN'
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
      nullif(left(trim(coalesce(h.notes, '')), 2000), '') as detail,
      null::text as ip_address
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
      s.original_filename,
      null::text
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
      nullif(left(trim(coalesce(ah.reason, '')), 2000), ''),
      null::text
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
      nullif(s.extension_version, ''),
      null::text
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
      nullif(s.extension_version, ''),
      null::text
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
      nullif(s.extension_version, ''),
      null::text
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
      coalesce(nullif(s.error_code, ''), nullif(s.extension_version, '')),
      null::text
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
      nullif(s.extension_version, ''),
      null::text
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    join public.job_descriptions j on j.id = a.job_description_id
    where coalesce(s.ended_at, s.updated_at) >= p_from
      and coalesce(s.ended_at, s.updated_at) < p_to
      and s.status in ('CANCELLED', 'EXPIRED')
      and (p_application_id is null or s.application_id = p_application_id)

    union all

    select
      e.id::text,
      e.occurred_at,
      'USER_LOGIN',
      case e.client_type
        when 'EXTENSION' then 'Extension login'
        else 'Dashboard login'
      end,
      null::uuid,
      e.user_id,
      null::uuid,
      null::bigint,
      null::text,
      null::text,
      trim(both ' · ' from coalesce(e.client_type, '') || coalesce(' · ' || nullif(left(coalesce(e.user_agent, ''), 200), ''), '')),
      host(e.ip_address)::text
    from public.user_activity_events e
    where e.event_type = 'USER_LOGIN'
      and e.occurred_at >= p_from
      and e.occurred_at < p_to
      and p_application_id is null
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
      e.detail,
      e.ip_address
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
        or coalesce(enriched.ip_address, '') ilike '%' || v_search || '%'
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
    filtered.ip_address,
    count(*) over()
  from filtered
  order by filtered.occurred_at desc, filtered.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_admin_activity_log_v33(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_admin_activity_log_v33(timestamptz, timestamptz, uuid, uuid, text, text, integer, integer) to authenticated;
