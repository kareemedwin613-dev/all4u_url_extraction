-- Add the human-reviewed Resume summary to the Application-scoped Autofill
-- snapshot. The value remains Resume-owned and is released only through a
-- valid, unexpired AUTOFILL session.

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
        'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),
        'candidate.middleName',r.candidate_middle_name,
        'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
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
        'candidate.portfolioUrl',r.portfolio_url,
        'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),'')
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
