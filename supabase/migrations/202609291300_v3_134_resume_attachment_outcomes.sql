-- v3.134: privacy-safe Resume attachment outcomes for Attach Resume and Autofill sessions.
-- Records only the outcome, a reason code, the ATS adapter, host names, and whether the form was
-- embedded in an iframe. No Resume bytes, filename, signed URL, page URL, or field value is stored.

alter table public.application_extension_sessions
  add column resume_attach_status text,
  add column resume_attach_code text,
  add column resume_attach_adapter_id text,
  add column resume_attach_frame_domain text,
  add column resume_attach_embedded boolean,
  add column resume_attach_attempts integer not null default 0,
  add column resume_attach_recorded_at timestamptz,
  add constraint application_extension_sessions_resume_attach_status_check
    check (resume_attach_status is null or resume_attach_status in ('ATTACHED','MANUAL_REQUIRED','UNSUPPORTED','FAILED')),
  add constraint application_extension_sessions_resume_attach_code_check
    check (resume_attach_code is null or resume_attach_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  add constraint application_extension_sessions_resume_attach_adapter_check
    check (resume_attach_adapter_id is null or resume_attach_adapter_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  add constraint application_extension_sessions_resume_attach_frame_domain_check
    check (resume_attach_frame_domain is null or (char_length(resume_attach_frame_domain) between 1 and 253 and resume_attach_frame_domain ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')),
  add constraint application_extension_sessions_resume_attach_attempts_check
    check (resume_attach_attempts between 0 and 50);

create index application_extension_sessions_resume_attach_created_idx
  on public.application_extension_sessions (created_at desc)
  where resume_attach_status is not null;

create or replace function public.record_application_resume_attachment_v134(
  p_session_id uuid,
  p_status text,
  p_code text,
  p_adapter_id text,
  p_target_domain text,
  p_frame_domain text,
  p_embedded boolean
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.application_extension_sessions;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_adapter_id text := nullif(lower(btrim(coalesce(p_adapter_id, ''))), '');
  v_target_domain text := lower(btrim(coalesce(p_target_domain, '')));
  v_frame_domain text := nullif(lower(btrim(coalesce(p_frame_domain, ''))), '');
begin
  if v_actor is null or not coalesce(public.is_active_user(v_actor), false) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501';
  end if;

  select * into v_session
  from public.application_extension_sessions
  where id = p_session_id and user_id = v_actor
  for update;
  if not found or v_session.action not in ('LOAD_RESUME','AUTOFILL') then
    raise exception 'APPLICATION_EXTENSION_SESSION_NOT_FOUND: The extension session was not found.' using errcode = 'P0001';
  end if;
  if v_session.expires_at <= now() or v_session.status in ('CANCELLED','FAILED','EXPIRED') then
    raise exception 'APPLICATION_EXTENSION_SESSION_FINAL: This extension session is no longer active.' using errcode = 'P0001';
  end if;
  if not coalesce(public.application_actor_can_view((select assigned_to from public.applications where id = v_session.application_id)), false) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: You cannot record this extension session.' using errcode = '42501';
  end if;
  if v_session.resume_attach_attempts >= 50 then
    raise exception 'RESUME_ATTACHMENT_TELEMETRY_LIMIT: Too many attachment attempts were recorded for this session.' using errcode = 'P0001';
  end if;

  if v_status not in ('ATTACHED','MANUAL_REQUIRED','UNSUPPORTED','FAILED')
    or v_code !~ '^[A-Z][A-Z0-9_]{0,79}$'
    or (v_adapter_id is not null and v_adapter_id !~ '^[a-z0-9][a-z0-9-]{0,79}$')
    or char_length(v_target_domain) not between 1 and 253
    or v_target_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    or (v_frame_domain is not null and (char_length(v_frame_domain) > 253 or v_frame_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')) then
    raise exception 'RESUME_ATTACHMENT_TELEMETRY_INVALID: Resume attachment outcome metadata is invalid.' using errcode = 'P0001';
  end if;

  -- The latest attempt wins; the attempt count shows how often Appliers had to retry.
  update public.application_extension_sessions set
    resume_attach_status = v_status,
    resume_attach_code = v_code,
    resume_attach_adapter_id = v_adapter_id,
    resume_attach_frame_domain = v_frame_domain,
    resume_attach_embedded = coalesce(p_embedded, false),
    resume_attach_attempts = resume_attach_attempts + 1,
    resume_attach_recorded_at = now(),
    target_domain = coalesce(target_domain, v_target_domain),
    updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'status', v_session.resume_attach_status,
    'code', v_session.resume_attach_code,
    'attempts', v_session.resume_attach_attempts
  );
end;
$$;

-- Aggregate report for Applying Managers and Admins: where does attachment fail, and why?
create or replace function public.get_resume_attachment_report_v134(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_days integer := greatest(1, least(coalesce(p_days, 30), 90));
  v_result jsonb;
begin
  -- coalesce: a NULL role check must deny, never fall through.
  if v_actor is null or not coalesce(public.is_active_user(v_actor), false)
    or not coalesce(public.has_role('APPLYING_MANAGER', v_actor) or public.has_role('ADMIN', v_actor), false) then
    raise exception 'RESUME_ATTACHMENT_REPORT_ACCESS_DENIED: Applying Manager or Admin access is required.' using errcode = '42501';
  end if;
  select jsonb_build_object('days', v_days, 'generatedAt', now(), 'items',
    coalesce(jsonb_agg(to_jsonb(x) order by x.not_attached desc, x.sessions desc, x.target_domain), '[]'::jsonb))
  into v_result
  from (
    select
      coalesce(s.target_domain, 'unknown') target_domain,
      coalesce(s.resume_attach_frame_domain, 'unknown') frame_domain,
      coalesce(s.resume_attach_adapter_id, 'unknown') adapter_id,
      bool_or(coalesce(s.resume_attach_embedded, false)) embedded,
      count(*)::integer sessions,
      count(*) filter (where s.resume_attach_status = 'ATTACHED')::integer attached,
      count(*) filter (where s.resume_attach_status <> 'ATTACHED')::integer not_attached,
      count(*) filter (where s.resume_attach_status = 'MANUAL_REQUIRED')::integer manual_required,
      count(*) filter (where s.resume_attach_status = 'UNSUPPORTED')::integer unsupported,
      count(*) filter (where s.resume_attach_status = 'FAILED')::integer failed,
      coalesce(sum(s.resume_attach_attempts), 0)::integer attempts,
      round(100.0 * count(*) filter (where s.resume_attach_status = 'ATTACHED') / count(*), 1) attach_rate,
      (select jsonb_object_agg(code, n) from (
         select c.resume_attach_code code, count(*)::integer n
         from public.application_extension_sessions c
         where c.resume_attach_status is not null and c.resume_attach_status <> 'ATTACHED'
           and c.created_at >= now() - make_interval(days => v_days)
           and coalesce(c.target_domain, 'unknown') = coalesce(s.target_domain, 'unknown')
           and coalesce(c.resume_attach_frame_domain, 'unknown') = coalesce(s.resume_attach_frame_domain, 'unknown')
           and coalesce(c.resume_attach_adapter_id, 'unknown') = coalesce(s.resume_attach_adapter_id, 'unknown')
         group by c.resume_attach_code
       ) codes) failure_codes
    from public.application_extension_sessions s
    where s.resume_attach_status is not null
      and s.created_at >= now() - make_interval(days => v_days)
    group by s.target_domain, s.resume_attach_frame_domain, s.resume_attach_adapter_id
  ) x;
  return v_result;
end;
$$;

revoke all on function public.record_application_resume_attachment_v134(uuid,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.record_application_resume_attachment_v134(uuid,text,text,text,text,text,boolean) to authenticated;
revoke all on function public.get_resume_attachment_report_v134(integer) from public, anon;
grant execute on function public.get_resume_attachment_report_v134(integer) to authenticated;

comment on column public.application_extension_sessions.resume_attach_status is 'Latest in-page Resume attachment outcome for this session (no file data is stored).';
comment on column public.application_extension_sessions.resume_attach_frame_domain is 'Host of the frame that held the Resume input, e.g. job-boards.greenhouse.io when embedded.';
