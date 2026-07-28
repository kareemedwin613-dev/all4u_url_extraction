-- v0.8.5: authorized Application context handoff to the Chrome extension.

create table public.application_extension_sessions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null check (action in ('LOAD_RESUME','AUTOFILL')),
  status text not null default 'CREATED' check (status in ('CREATED','RECEIVED','TARGET_READY','COMPLETED','CANCELLED','FAILED','EXPIRED')),
  extension_version text check (extension_version is null or char_length(extension_version) between 1 and 40),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_extension_sessions_expiry_check check (expires_at > created_at)
);

create index application_extension_sessions_user_created_idx
  on public.application_extension_sessions (user_id, created_at desc);
create index application_extension_sessions_application_created_idx
  on public.application_extension_sessions (application_id, created_at desc);
create index application_extension_sessions_active_expiry_idx
  on public.application_extension_sessions (expires_at)
  where status in ('CREATED','RECEIVED','TARGET_READY');

create trigger application_extension_sessions_updated
before update on public.application_extension_sessions
for each row execute function public.set_updated_at();

alter table public.application_extension_sessions enable row level security;

create policy "users read own authorized extension sessions"
on public.application_extension_sessions for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.applications a
    where a.id = application_id and public.application_actor_can_view(a.assigned_to)
  )
);

revoke all on public.application_extension_sessions from public, anon;
revoke insert, update, delete on public.application_extension_sessions from authenticated;
grant select on public.application_extension_sessions to authenticated;

create or replace function public.get_application_extension_context_v085(p_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'application', jsonb_build_object(
      'id', a.id,
      'applicationNumber', a.application_number,
      'workStatus', a.work_status,
      'applicationStatus', a.application_status,
      'assignedTo', a.assigned_to
    ),
    'job', jsonb_build_object(
      'id', j.id,
      'company', j.company,
      'jobTitle', j.job_title,
      'sourceUrl', j.source_url
    ),
    'candidate', jsonb_build_object(
      'displayName', r.candidate_name,
      'profileId', null,
      'profileAvailable', false
    ),
    'resume', jsonb_build_object(
      'id', r.id,
      'resumeName', r.resume_name,
      'originalFilename', r.original_filename,
      'mimeType', r.mime_type,
      'fileSizeBytes', r.file_size_bytes,
      'status', r.status
    ),
    'permissions', jsonb_build_object(
      'canLoadResume', r.status = 'ACTIVE',
      'canAutofill', r.status = 'ACTIVE' and j.source_url ~* '^https?://'
    )
  ) into v_result
  from public.applications a
  join public.job_descriptions j on j.id = a.job_description_id
  join public.resumes r on r.id = a.resume_id
  where a.id = p_application_id
    and public.application_actor_can_view(a.assigned_to);

  if v_result is null then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function public.create_application_extension_session_v085(
  p_application_id uuid,
  p_action text,
  p_extension_version text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_context jsonb;
  v_session public.application_extension_sessions;
begin
  v_context := public.get_application_extension_context_v085(p_application_id);
  if v_action not in ('LOAD_RESUME','AUTOFILL') then
    raise exception 'APPLICATION_EXTENSION_ACTION_INVALID: Select Load Resume or Autofill.' using errcode = 'P0001';
  end if;
  if v_action = 'LOAD_RESUME' and not coalesce((v_context #>> '{permissions,canLoadResume}')::boolean, false) then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The Application Resume is not active.' using errcode = 'P0001';
  end if;
  if v_action = 'AUTOFILL' and not coalesce((v_context #>> '{permissions,canAutofill}')::boolean, false) then
    raise exception 'APPLICATION_AUTOFILL_UNAVAILABLE: The Application does not have an eligible job URL and active Resume.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_extension_version, '')) > 40 then
    raise exception 'APPLICATION_EXTENSION_VERSION_INVALID: The extension version is invalid.' using errcode = 'P0001';
  end if;

  insert into public.application_extension_sessions(application_id,user_id,action,extension_version)
  values(p_application_id,v_actor,v_action,nullif(btrim(coalesce(p_extension_version,'')),''))
  returning * into v_session;

  return jsonb_build_object(
    'id', v_session.id,
    'applicationId', v_session.application_id,
    'action', v_session.action,
    'status', v_session.status,
    'targetUrl', v_context #>> '{job,sourceUrl}',
    'expiresAt', v_session.expires_at,
    'createdAt', v_session.created_at
  );
end;
$$;

create or replace function public.update_application_extension_session_v085(
  p_session_id uuid,
  p_status text,
  p_error_code text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_session public.application_extension_sessions;
begin
  select * into v_session from public.application_extension_sessions
  where id = p_session_id and user_id = v_actor for update;
  if not found then
    raise exception 'APPLICATION_EXTENSION_SESSION_NOT_FOUND: The extension session was not found.' using errcode = 'P0001';
  end if;
  if not public.application_actor_can_view((select assigned_to from public.applications where id = v_session.application_id)) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: You cannot update this extension session.' using errcode = '42501';
  end if;
  if v_session.expires_at <= now() then
    update public.application_extension_sessions set status='EXPIRED',ended_at=coalesce(ended_at,now()) where id=v_session.id returning * into v_session;
    return jsonb_build_object('id',v_session.id,'applicationId',v_session.application_id,'action',v_session.action,'status',v_session.status,'expiresAt',v_session.expires_at,'updatedAt',v_session.updated_at);
  end if;
  if v_status not in ('RECEIVED','TARGET_READY','COMPLETED','CANCELLED','FAILED') then
    raise exception 'APPLICATION_EXTENSION_STATUS_INVALID: Select a valid extension session status.' using errcode = 'P0001';
  end if;
  if v_session.status in ('COMPLETED','CANCELLED','FAILED','EXPIRED') and v_status is distinct from v_session.status then
    raise exception 'APPLICATION_EXTENSION_SESSION_FINAL: This extension session has already ended.' using errcode = 'P0001';
  end if;
  if p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$' then
    raise exception 'APPLICATION_EXTENSION_ERROR_CODE_INVALID: The extension error code is invalid.' using errcode = 'P0001';
  end if;

  update public.application_extension_sessions set
    status=v_status,
    error_code=case when v_status='FAILED' then p_error_code else null end,
    ended_at=case when v_status in ('COMPLETED','CANCELLED','FAILED') then now() else null end
  where id=v_session.id returning * into v_session;

  return jsonb_build_object('id',v_session.id,'applicationId',v_session.application_id,'action',v_session.action,'status',v_session.status,'expiresAt',v_session.expires_at,'updatedAt',v_session.updated_at);
end;
$$;

revoke all on function public.get_application_extension_context_v085(uuid) from public, anon;
revoke all on function public.create_application_extension_session_v085(uuid,text,text) from public, anon;
revoke all on function public.update_application_extension_session_v085(uuid,text,text) from public, anon;
grant execute on function public.get_application_extension_context_v085(uuid) to authenticated;
grant execute on function public.create_application_extension_session_v085(uuid,text,text) to authenticated;
grant execute on function public.update_application_extension_session_v085(uuid,text,text) to authenticated;
