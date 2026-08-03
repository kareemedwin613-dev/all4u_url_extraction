-- v0.9.4: privacy-safe Autofill session measurement and field outcomes.

alter table public.application_extension_sessions
  add column resume_id_snapshot uuid references public.resumes(id) on delete set null,
  add column resume_updated_at_snapshot timestamptz,
  add column adapter_id text,
  add column adapter_version text,
  add column target_domain text,
  add column detected_count integer not null default 0,
  add column selected_count integer not null default 0,
  add column succeeded_count integer not null default 0,
  add column failed_count integer not null default 0,
  add column unresolved_count integer not null default 0,
  add constraint application_extension_sessions_adapter_id_check
    check (adapter_id is null or adapter_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  add constraint application_extension_sessions_adapter_version_check
    check (adapter_version is null or adapter_version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'),
  add constraint application_extension_sessions_target_domain_check
    check (target_domain is null or (char_length(target_domain) between 1 and 253 and target_domain = lower(target_domain) and target_domain ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')),
  add constraint application_extension_sessions_counts_check
    check (
      detected_count between 0 and 100 and selected_count between 0 and 100
      and succeeded_count between 0 and 100 and failed_count between 0 and 100
      and unresolved_count between 0 and 100
      and selected_count <= detected_count
      and succeeded_count + failed_count <= selected_count
    );

create index application_extension_sessions_adapter_created_idx
  on public.application_extension_sessions (adapter_id, created_at desc)
  where action = 'AUTOFILL';
create index application_extension_sessions_target_domain_created_idx
  on public.application_extension_sessions (target_domain, created_at desc)
  where action = 'AUTOFILL';

create table public.application_extension_session_fields (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.application_extension_sessions(id) on delete cascade,
  field_key text not null,
  field_index smallint not null default 0,
  confidence smallint not null,
  outcome text not null,
  adapter_id text not null,
  adapter_version text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_extension_session_fields_key_check
    check (field_key ~ '^(candidate|screening|employment|education)\.[A-Za-z0-9][A-Za-z0-9_.-]{0,96}$'),
  constraint application_extension_session_fields_index_check check (field_index between 0 and 99),
  constraint application_extension_session_fields_confidence_check check (confidence between 0 and 100),
  constraint application_extension_session_fields_outcome_check check (outcome in ('DETECTED','VERIFIED','FAILED','SKIPPED')),
  constraint application_extension_session_fields_adapter_id_check check (adapter_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  constraint application_extension_session_fields_adapter_version_check check (adapter_version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'),
  constraint application_extension_session_fields_error_code_check check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  constraint application_extension_session_fields_session_key_unique unique (session_id, field_key, field_index)
);

create index application_extension_session_fields_session_idx
  on public.application_extension_session_fields (session_id, created_at);
create index application_extension_session_fields_outcome_idx
  on public.application_extension_session_fields (outcome, created_at desc);

create trigger application_extension_session_fields_updated
before update on public.application_extension_session_fields
for each row execute function public.set_updated_at();

alter table public.application_extension_session_fields enable row level security;

create policy "users read own authorized extension session fields"
on public.application_extension_session_fields for select to authenticated
using (
  exists (
    select 1
    from public.application_extension_sessions s
    join public.applications a on a.id = s.application_id
    where s.id = session_id
      and s.user_id = (select auth.uid())
      and public.application_actor_can_view(a.assigned_to)
  )
);

revoke all on public.application_extension_session_fields from public, anon;
revoke insert, update, delete on public.application_extension_session_fields from authenticated;
grant select on public.application_extension_session_fields to authenticated;

create or replace function public.record_application_autofill_telemetry_v094(
  p_session_id uuid,
  p_resume_updated_at_snapshot timestamptz,
  p_adapter_id text,
  p_adapter_version text,
  p_target_domain text,
  p_detected_count integer,
  p_selected_count integer,
  p_succeeded_count integer,
  p_failed_count integer,
  p_unresolved_count integer,
  p_fields jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.application_extension_sessions;
  v_resume_id uuid;
  v_resume_updated_at timestamptz;
  v_adapter_id text := lower(btrim(coalesce(p_adapter_id, '')));
  v_adapter_version text := btrim(coalesce(p_adapter_version, ''));
  v_target_domain text := lower(btrim(coalesce(p_target_domain, '')));
  v_field jsonb;
  v_field_key text;
  v_outcome text;
  v_error_code text;
  v_field_index integer;
  v_calculated_detected integer := 0;
  v_calculated_selected integer := 0;
  v_calculated_succeeded integer := 0;
  v_calculated_failed integer := 0;
begin
  if v_actor is null or not public.is_active_user(v_actor) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501';
  end if;

  select * into v_session
  from public.application_extension_sessions
  where id = p_session_id and user_id = v_actor
  for update;
  if not found or v_session.action <> 'AUTOFILL' then
    raise exception 'APPLICATION_EXTENSION_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  if v_session.expires_at <= now() or v_session.status in ('CANCELLED','FAILED','EXPIRED') then
    raise exception 'APPLICATION_EXTENSION_SESSION_FINAL: This Autofill session is no longer active.' using errcode = 'P0001';
  end if;
  if not public.application_actor_can_view((select assigned_to from public.applications where id = v_session.application_id)) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: You cannot record this Autofill session.' using errcode = '42501';
  end if;

  select r.id, r.updated_at into v_resume_id, v_resume_updated_at
  from public.applications a join public.resumes r on r.id = a.resume_id
  where a.id = v_session.application_id;
  if v_resume_id is null or p_resume_updated_at_snapshot is null or v_resume_updated_at is distinct from p_resume_updated_at_snapshot then
    raise exception 'AUTOFILL_CONTEXT_STALE: The Resume changed after Autofill started.' using errcode = 'P0001';
  end if;

  if v_adapter_id !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or v_adapter_version !~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'
    or char_length(v_target_domain) not between 1 and 253
    or v_target_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' then
    raise exception 'AUTOFILL_TELEMETRY_INVALID: Adapter or target-domain metadata is invalid.' using errcode = 'P0001';
  end if;
  if p_detected_count is null or p_selected_count is null or p_succeeded_count is null or p_failed_count is null or p_unresolved_count is null
    or p_detected_count not between 0 and 100 or p_selected_count not between 0 and 100
    or p_succeeded_count not between 0 and 100 or p_failed_count not between 0 and 100
    or p_unresolved_count not between 0 and 100 or p_selected_count > p_detected_count
    or p_succeeded_count + p_failed_count > p_selected_count then
    raise exception 'AUTOFILL_TELEMETRY_INVALID: Autofill counts are invalid.' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) > 100 then
    raise exception 'AUTOFILL_TELEMETRY_INVALID: Autofill field outcomes are invalid.' using errcode = 'P0001';
  end if;

  for v_field in select value from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    if jsonb_typeof(v_field) <> 'object' then
      raise exception 'AUTOFILL_TELEMETRY_INVALID: An Autofill field outcome is invalid.' using errcode = 'P0001';
    end if;
    if (select count(*) from jsonb_object_keys(v_field)) > 5
      or v_field ?| array['value','label','question','questionText','resumeText','signedUrl','token'] then
      raise exception 'AUTOFILL_TELEMETRY_SENSITIVE_DATA: Autofill telemetry cannot contain field values or sensitive text.' using errcode = 'P0001';
    end if;
    v_field_key := btrim(coalesce(v_field->>'fieldKey', ''));
    v_field_index := case when coalesce(v_field->>'fieldIndex','') ~ '^[0-9]{1,2}$' then (v_field->>'fieldIndex')::integer else -1 end;
    v_outcome := upper(btrim(coalesce(v_field->>'outcome', '')));
    v_error_code := nullif(upper(btrim(coalesce(v_field->>'errorCode', ''))), '');
    if v_field_key !~ '^(candidate|screening|employment|education)\.[A-Za-z0-9][A-Za-z0-9_.-]{0,96}$' or v_field_index not between 0 and 99
      or v_outcome not in ('DETECTED','VERIFIED','FAILED','SKIPPED')
      or coalesce(v_field->>'confidence','') !~ '^[0-9]{1,3}$'
      or (v_field->>'confidence')::integer not between 0 and 100
      or (v_error_code is not null and v_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$') then
      raise exception 'AUTOFILL_TELEMETRY_INVALID: An Autofill field outcome is invalid.' using errcode = 'P0001';
    end if;
    v_calculated_detected := v_calculated_detected + 1;
    if v_outcome <> 'DETECTED' then v_calculated_selected := v_calculated_selected + 1; end if;
    if v_outcome = 'VERIFIED' then v_calculated_succeeded := v_calculated_succeeded + 1; end if;
    if v_outcome in ('FAILED','SKIPPED') then v_calculated_failed := v_calculated_failed + 1; end if;
    insert into public.application_extension_session_fields(
      session_id,field_key,field_index,confidence,outcome,adapter_id,adapter_version,error_code
    ) values (
      v_session.id,v_field_key,v_field_index,(v_field->>'confidence')::smallint,v_outcome,v_adapter_id,v_adapter_version,v_error_code
    )
    on conflict (session_id,field_key,field_index) do update set
      confidence=excluded.confidence,outcome=excluded.outcome,adapter_id=excluded.adapter_id,
      adapter_version=excluded.adapter_version,error_code=excluded.error_code;
  end loop;

  if v_calculated_detected <> p_detected_count or v_calculated_selected <> p_selected_count
    or v_calculated_succeeded <> p_succeeded_count or v_calculated_failed <> p_failed_count then
    raise exception 'AUTOFILL_TELEMETRY_INVALID: Autofill counts do not match field outcomes.' using errcode = 'P0001';
  end if;

  update public.application_extension_sessions set
    resume_id_snapshot=v_resume_id,
    resume_updated_at_snapshot=p_resume_updated_at_snapshot,
    adapter_id=v_adapter_id,
    adapter_version=v_adapter_version,
    target_domain=v_target_domain,
    detected_count=p_detected_count,
    selected_count=p_selected_count,
    succeeded_count=p_succeeded_count,
    failed_count=p_failed_count,
    unresolved_count=p_unresolved_count
  where id=v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'id',v_session.id,'applicationId',v_session.application_id,'adapterId',v_session.adapter_id,
    'adapterVersion',v_session.adapter_version,'targetDomain',v_session.target_domain,
    'detectedCount',v_session.detected_count,'selectedCount',v_session.selected_count,
    'succeededCount',v_session.succeeded_count,'failedCount',v_session.failed_count,
    'unresolvedCount',v_session.unresolved_count,'updatedAt',v_session.updated_at
  );
end;
$$;

revoke all on function public.record_application_autofill_telemetry_v094(uuid,timestamptz,text,text,text,integer,integer,integer,integer,integer,jsonb) from public, anon;
grant execute on function public.record_application_autofill_telemetry_v094(uuid,timestamptz,text,text,text,integer,integer,integer,integer,integer,jsonb) to authenticated;
