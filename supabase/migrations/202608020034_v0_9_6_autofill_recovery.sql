-- v0.9.6: non-sensitive recovery pointers and sanitized verified-field recovery.

alter table public.application_extension_sessions
  add column target_origin text,
  add column step_identifier text not null default 'NEW',
  add column last_recovered_at timestamptz,
  add constraint application_extension_sessions_target_origin_check check (
    target_origin is null or (char_length(target_origin) between 8 and 300 and target_origin ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$')
  ),
  add constraint application_extension_sessions_step_check check (step_identifier in ('NEW','DETECTED','FILLING','PARTIAL','FILLED'));

create index application_extension_sessions_recovery_idx
  on public.application_extension_sessions(user_id,updated_at desc)
  where action='AUTOFILL' and status in('CREATED','RECEIVED','TARGET_READY');

create or replace function public.update_application_autofill_recovery_v096(
  p_session_id uuid,p_target_origin text,p_step_identifier text,p_resume_updated_at_snapshot timestamptz,
  p_adapter_id text default null,p_adapter_version text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.application_extension_sessions;v_step text:=upper(btrim(coalesce(p_step_identifier,'')));v_origin text:=lower(btrim(coalesce(p_target_origin,'')));v_resume_id uuid;v_resume_updated_at timestamptz;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select * into v_session from public.application_extension_sessions where id=p_session_id and user_id=auth.uid() and action='AUTOFILL' for update;
  if not found or v_session.expires_at<=now() or v_session.status not in('CREATED','RECEIVED','TARGET_READY') then raise exception 'APPLICATION_EXTENSION_SESSION_NOT_FOUND: The active Autofill session was not found.' using errcode='P0001'; end if;
  if not public.application_actor_can_view((select assigned_to from public.applications where id=v_session.application_id)) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: You cannot recover this Autofill session.' using errcode='42501'; end if;
  select r.id,r.updated_at into v_resume_id,v_resume_updated_at from public.applications a join public.resumes r on r.id=a.resume_id where a.id=v_session.application_id and r.status='ACTIVE' and r.profile_review_status='VERIFIED';
  if v_resume_id is null or p_resume_updated_at_snapshot is null or v_resume_updated_at<>p_resume_updated_at_snapshot then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after Autofill started.' using errcode='P0001'; end if;
  if v_origin !~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' or v_step not in('NEW','DETECTED','FILLING','PARTIAL','FILLED') then raise exception 'AUTOFILL_RECOVERY_INVALID: The recovery pointer is invalid.' using errcode='P0001'; end if;
  if p_adapter_id is not null and p_adapter_id !~ '^[a-z0-9][a-z0-9-]{0,79}$' then raise exception 'AUTOFILL_RECOVERY_INVALID: The adapter is invalid.' using errcode='P0001'; end if;
  if p_adapter_version is not null and p_adapter_version !~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$' then raise exception 'AUTOFILL_RECOVERY_INVALID: The adapter version is invalid.' using errcode='P0001'; end if;
  update public.application_extension_sessions set target_origin=v_origin,step_identifier=v_step,resume_id_snapshot=v_resume_id,resume_updated_at_snapshot=p_resume_updated_at_snapshot,adapter_id=coalesce(p_adapter_id,adapter_id),adapter_version=coalesce(p_adapter_version,adapter_version),last_recovered_at=case when v_step<>'NEW' then now() else last_recovered_at end where id=p_session_id returning * into v_session;
  return jsonb_build_object('id',v_session.id,'applicationId',v_session.application_id,'targetOrigin',v_session.target_origin,'stepIdentifier',v_session.step_identifier,'resumeUpdatedAt',v_session.resume_updated_at_snapshot,'adapterId',v_session.adapter_id,'adapterVersion',v_session.adapter_version,'expiresAt',v_session.expires_at,'updatedAt',v_session.updated_at);
end;
$$;

create or replace function public.get_application_autofill_recovery_v096(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select jsonb_build_object(
    'id',s.id,'applicationId',s.application_id,'targetOrigin',s.target_origin,'stepIdentifier',s.step_identifier,
    'resumeUpdatedAt',s.resume_updated_at_snapshot,'adapterId',s.adapter_id,'adapterVersion',s.adapter_version,'expiresAt',s.expires_at,
    'fields',coalesce((select jsonb_agg(jsonb_build_object('fieldKey',f.field_key,'fieldIndex',f.field_index,'confidence',f.confidence,'outcome',f.outcome,'errorCode',f.error_code) order by f.field_key,f.field_index) from public.application_extension_session_fields f where f.session_id=s.id),'[]'::jsonb)
  ) into v_result from public.application_extension_sessions s join public.applications a on a.id=s.application_id
  where s.id=p_session_id and s.user_id=auth.uid() and s.action='AUTOFILL' and s.expires_at>now() and s.status in('CREATED','RECEIVED','TARGET_READY') and public.application_actor_can_view(a.assigned_to);
  if v_result is null then raise exception 'APPLICATION_EXTENSION_SESSION_NOT_FOUND: The active Autofill session was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.update_application_autofill_recovery_v096(uuid,text,text,timestamptz,text,text) from public,anon;
revoke all on function public.get_application_autofill_recovery_v096(uuid) from public,anon;
grant execute on function public.update_application_autofill_recovery_v096(uuid,text,text,timestamptz,text,text) to authenticated;
grant execute on function public.get_application_autofill_recovery_v096(uuid) to authenticated;
