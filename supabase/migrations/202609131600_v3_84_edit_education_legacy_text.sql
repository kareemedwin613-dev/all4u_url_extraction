-- Allow managers to edit/clear resumes.structured_content.education_legacy_text
-- via the atomic structured Resume save path.

create or replace function public.update_resume_structured_content_v384(
  p_resume_id uuid,
  p_summary text,
  p_skills text,
  p_employment jsonb,
  p_education jsonb,
  p_certifications jsonb,
  p_education_legacy_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employment jsonb;
  v_education jsonb;
  v_certifications jsonb;
  v_legacy text := left(btrim(coalesce(p_education_legacy_text, '')), 30000);
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_employment) <> 'array' or jsonb_typeof(p_education) <> 'array' or jsonb_typeof(p_certifications) <> 'array' then
    raise exception 'STRUCTURED_RESUME_INVALID: Structured sections must be arrays.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_employment) > 50 or jsonb_array_length(p_education) > 30 or jsonb_array_length(p_certifications) > 50 then
    raise exception 'STRUCTURED_RESUME_INVALID: Too many structured records.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_summary, '')) > 30000 or char_length(coalesce(p_skills, '')) > 30000 or char_length(v_legacy) > 30000 then
    raise exception 'STRUCTURED_RESUME_INVALID: Summary, skills, or legacy education text are too long.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_employment) x where btrim(coalesce(x->>'company', '')) = '' or btrim(coalesce(x->>'jobTitle', '')) = '') then
    raise exception 'STRUCTURED_RESUME_INVALID: Every employment record needs a company and job title.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_employment) x where char_length(coalesce(x->>'company', '')) > 200 or char_length(coalesce(x->>'jobTitle', '')) > 200 or char_length(coalesce(x->>'location', '')) > 200 or char_length(coalesce(x->>'experienceDetails', '')) > 30000) then
    raise exception 'STRUCTURED_RESUME_INVALID: An employment field is too long.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_education) x where btrim(coalesce(x->>'institution', '')) = '') then
    raise exception 'STRUCTURED_RESUME_INVALID: Every education record needs an institution.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_education) x where char_length(coalesce(x->>'institution', '')) > 240 or char_length(coalesce(x->>'degree', '')) > 200 or char_length(coalesce(x->>'fieldOfStudy', '')) > 200 or char_length(coalesce(x->>'location', '')) > 200 or char_length(coalesce(x->>'gpa', '')) > 40 or char_length(coalesce(x->>'details', '')) > 10000) then
    raise exception 'STRUCTURED_RESUME_INVALID: An education field is too long.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_certifications) x where btrim(coalesce(x->>'name', '')) = '') then
    raise exception 'STRUCTURED_RESUME_INVALID: Every certification needs a name.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_certifications) x where char_length(coalesce(x->>'name', '')) > 240 or char_length(coalesce(x->>'issuer', '')) > 240 or char_length(coalesce(x->>'credentialId', '')) > 240 or char_length(coalesce(x->>'credentialUrl', '')) > 2000) then
    raise exception 'STRUCTURED_RESUME_INVALID: A certification field is too long.' using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_certifications) x where coalesce(x->>'credentialUrl', '') <> '' and x->>'credentialUrl' !~* '^https://[^[:space:]]+$') then
    raise exception 'STRUCTURED_RESUME_INVALID: Credential URLs must use HTTPS.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(nullif(btrim(x.value->>'id'), ''), gen_random_uuid()::text),
    'company', btrim(x.value->>'company'),
    'job_title', btrim(x.value->>'jobTitle'),
    'location', btrim(coalesce(x.value->>'location', '')),
    'start_date', public.candidate_date_json_v088(nullif(x.value->>'startDate', '')::date),
    'end_date', case when coalesce((x.value->>'isCurrent')::boolean, false) then null else public.candidate_date_json_v088(nullif(x.value->>'endDate', '')::date) end,
    'is_current', coalesce((x.value->>'isCurrent')::boolean, false),
    'experience_details', btrim(coalesce(x.value->>'experienceDetails', ''))
  ) order by x.ordinality), '[]'::jsonb)
  into v_employment
  from jsonb_array_elements(p_employment) with ordinality x(value, ordinality);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(nullif(btrim(x.value->>'id'), ''), gen_random_uuid()::text),
    'institution', btrim(x.value->>'institution'),
    'degree', btrim(coalesce(x.value->>'degree', '')),
    'field_of_study', btrim(coalesce(x.value->>'fieldOfStudy', '')),
    'location', btrim(coalesce(x.value->>'location', '')),
    'start_date', public.candidate_date_json_v088(nullif(x.value->>'startDate', '')::date),
    'end_date', public.candidate_date_json_v088(nullif(x.value->>'endDate', '')::date),
    'gpa', btrim(coalesce(x.value->>'gpa', '')),
    'details', btrim(coalesce(x.value->>'details', ''))
  ) order by x.ordinality), '[]'::jsonb)
  into v_education
  from jsonb_array_elements(p_education) with ordinality x(value, ordinality);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(nullif(btrim(x.value->>'id'), ''), gen_random_uuid()::text),
    'name', btrim(x.value->>'name'),
    'issuer', btrim(coalesce(x.value->>'issuer', '')),
    'issued_date', nullif(x.value->>'issuedDate', ''),
    'expiration_date', nullif(x.value->>'expirationDate', ''),
    'credential_id', btrim(coalesce(x.value->>'credentialId', '')),
    'credential_url', btrim(coalesce(x.value->>'credentialUrl', ''))
  ) order by x.ordinality), '[]'::jsonb)
  into v_certifications
  from jsonb_array_elements(p_certifications) with ordinality x(value, ordinality);

  update public.resumes set
    structured_content = coalesce(structured_content, '{}'::jsonb) || jsonb_build_object(
      'summary', btrim(coalesce(p_summary, '')),
      'skills', btrim(coalesce(p_skills, '')),
      'professional_experience', v_employment,
      'education', v_education,
      'certifications', v_certifications,
      'education_legacy_text', v_legacy
    ),
    structured_schema_version = greatest(structured_schema_version, 3),
    profile_review_status = 'VERIFIED',
    profile_reviewed_by = auth.uid(),
    profile_reviewed_at = now()
  where id = p_resume_id;
  if not found then
    raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode = 'P0001';
  end if;
  return public.get_candidate_autofill_profile_v088(p_resume_id);
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'STRUCTURED_RESUME_INVALID: Review the structured Resume dates.' using errcode = 'P0001';
end;
$$;

-- Keep the older RPC callable; preserve existing legacy text when callers omit the new field.
create or replace function public.update_resume_structured_content_v091(
  p_resume_id uuid,
  p_summary text,
  p_skills text,
  p_employment jsonb,
  p_education jsonb,
  p_certifications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_legacy text;
begin
  select coalesce(structured_content->>'education_legacy_text', '')
  into v_legacy
  from public.resumes
  where id = p_resume_id;
  return public.update_resume_structured_content_v384(
    p_resume_id,
    p_summary,
    p_skills,
    p_employment,
    p_education,
    p_certifications,
    coalesce(v_legacy, '')
  );
end;
$$;

revoke all on function public.update_resume_structured_content_v384(uuid, text, text, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.update_resume_structured_content_v384(uuid, text, text, jsonb, jsonb, jsonb, text) to authenticated;
revoke all on function public.update_resume_structured_content_v091(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_resume_structured_content_v091(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

comment on function public.update_resume_structured_content_v384(uuid, text, text, jsonb, jsonb, jsonb, text) is
  'Atomically replace structured Resume sections, including editable education_legacy_text.';
