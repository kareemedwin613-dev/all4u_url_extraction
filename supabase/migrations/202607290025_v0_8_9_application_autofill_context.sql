-- v0.8.9: Application-scoped, verified Resume autofill context.
-- Values remain owned by the Resume aggregate and are released only through
-- an active AUTOFILL extension session owned by the authenticated caller.

create or replace function public.get_application_autofill_context_v089(
  p_application_id uuid,
  p_session_id uuid,
  p_expected_resume_updated_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_resume_updated_at timestamptz;
  v_review_status text;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then
    raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501';
  end if;

  select r.updated_at, r.profile_review_status,
    jsonb_build_object(
      'applicationId', a.id,
      'sessionId', s.id,
      'job', jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url),
      'resumeId', r.id,
      'resumeUpdatedAt', r.updated_at,
      'profileSchemaVersion', r.profile_schema_version,
      'reviewedAt', r.profile_reviewed_at,
      'values', jsonb_strip_nulls(jsonb_build_object(
        'candidate.firstName',r.candidate_first_name,
        'candidate.middleName',r.candidate_middle_name,
        'candidate.lastName',r.candidate_last_name,
        'candidate.fullName',r.candidate_name,
        'candidate.email',r.candidate_email,
        'candidate.phone',r.candidate_phone,
        'candidate.addressLine1',r.address_line_1,
        'candidate.addressLine2',r.address_line_2,
        'candidate.city',r.address_city,
        'candidate.state',r.address_state_region,
        'candidate.postalCode',r.address_postal_code,
        'candidate.country',r.address_country,
        'candidate.linkedInUrl',r.linkedin_url,
        'candidate.githubUrl',r.github_url,
        'candidate.portfolioUrl',r.portfolio_url
      ))
    )
  into v_resume_updated_at, v_review_status, v_result
  from public.application_extension_sessions s
  join public.applications a on a.id=s.application_id
  join public.job_descriptions j on j.id=a.job_description_id
  join public.resumes r on r.id=a.resume_id
  where s.id=p_session_id
    and s.application_id=p_application_id
    and s.user_id=auth.uid()
    and s.action='AUTOFILL'
    and s.status in ('CREATED','RECEIVED','TARGET_READY')
    and s.expires_at>now()
    and public.application_actor_can_view(a.assigned_to)
    and r.status='ACTIVE'
    and j.source_url ~* '^https?://';

  if v_result is null then
    raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001';
  end if;
  if v_review_status<>'VERIFIED' then
    raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001';
  end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then
    raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) to authenticated;

-- Replace the original combined eligibility message with actionable v0.8.9
-- errors. The Resume review requirement is now a separate condition.
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
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_context jsonb;
  v_session public.application_extension_sessions;
begin
  v_context := public.get_application_extension_context_v085(p_application_id);
  if v_action not in ('LOAD_RESUME','AUTOFILL') then
    raise exception 'APPLICATION_EXTENSION_ACTION_INVALID: Select Load Resume or Autofill.' using errcode='P0001';
  end if;
  if v_action='LOAD_RESUME' and not coalesce((v_context #>> '{permissions,canLoadResume}')::boolean,false) then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The Resume connected to this Application is not active.' using errcode='P0001';
  end if;
  if v_action='AUTOFILL' and coalesce(v_context #>> '{resume,status}','')<>'ACTIVE' then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The Resume connected to this Application is not active.' using errcode='P0001';
  end if;
  if v_action='AUTOFILL' and coalesce(v_context #>> '{job,sourceUrl}','') !~* '^https?://' then
    raise exception 'APPLICATION_JOB_URL_UNAVAILABLE: Add a valid HTTP(S) job URL before using Autofill.' using errcode='P0001';
  end if;
  if v_action='AUTOFILL' and not coalesce((v_context #>> '{candidate,profileAvailable}')::boolean,false) then
    raise exception 'PROFILE_REVIEW_REQUIRED: Verify this Resume''s Autofill Metadata before using Autofill.' using errcode='P0001';
  end if;
  if char_length(coalesce(p_extension_version,''))>40 then
    raise exception 'APPLICATION_EXTENSION_VERSION_INVALID: The extension version is invalid.' using errcode='P0001';
  end if;

  insert into public.application_extension_sessions(application_id,user_id,action,extension_version)
  values(p_application_id,v_actor,v_action,nullif(btrim(coalesce(p_extension_version,'')),''))
  returning * into v_session;
  return jsonb_build_object(
    'id',v_session.id,'applicationId',v_session.application_id,'action',v_session.action,
    'status',v_session.status,'targetUrl',v_context #>> '{job,sourceUrl}',
    'expiresAt',v_session.expires_at,'createdAt',v_session.created_at
  );
end;
$$;

revoke all on function public.create_application_extension_session_v085(uuid,text,text) from public, anon;
grant execute on function public.create_application_extension_session_v085(uuid,text,text) to authenticated;
