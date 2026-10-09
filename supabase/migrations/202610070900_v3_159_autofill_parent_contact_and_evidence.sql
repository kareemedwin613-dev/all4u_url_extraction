-- v3.159: Autofill context reads identity, contact details, address, and links from the original
-- Resume (TAILORED copies kept the values they had when created, so later edits such as adding a LinkedIn
-- URL never reached them), and returns the Resume's skills for Yes/No experience questions.
-- Also accepts "evidence." field keys in Autofill session feedback. Safe to re-run.

create or replace function public.get_application_autofill_context_v3157(p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;v_preferences jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,p.autofill_preferences,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,
    'job',jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,'salaryPeriod',j.salary_period,'salaryText',j.salary_text,'workArrangement',j.work_arrangement,'locationText',j.location_text),
    'resumeId',r.id,'skills',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then nullif(btrim(coalesce(r.structured_content->>'skills',p.structured_content->>'skills','')),'') end,'resumeType',r.resume_type,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'preferences',p.autofill_preferences,
    'gender',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then p.gender end,
    'values',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(p.candidate_first_name),''),nullif(split_part(btrim(p.candidate_name),' ',1),'')),'candidate.middleName',p.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(p.candidate_last_name),''),case when btrim(p.candidate_name) like '% %' then nullif(regexp_replace(btrim(p.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',p.candidate_name,'candidate.email',p.candidate_email,'candidate.phone',p.candidate_phone,'candidate.addressLine1',p.address_line_1,'candidate.addressLine2',p.address_line_2,
      'candidate.city',p.address_city,'candidate.state',p.address_state_region,'candidate.postalCode',p.address_postal_code,'candidate.country',p.address_country,
      'candidate.currentLocation',nullif(concat_ws(', ',nullif(btrim(p.address_city),''),nullif(btrim(p.address_state_region),''),nullif(btrim(p.address_country),'')),''),
      'candidate.currentCompany',(select nullif(btrim(x.value->>'company'),'') from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') order by x.ordinality limit 1),
      'candidate.linkedInUrl',p.linkedin_url,'candidate.githubUrl',p.github_url,'candidate.portfolioUrl',p.portfolio_url,'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),''))) else '{}'::jsonb end,
    'employment',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('company',x.value->>'company','jobTitle',x.value->>'job_title','location',x.value->>'location','startDate',x.value->'start_date','endDate',x.value->'end_date','isCurrent',lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes'),'experienceDetails',nullif(btrim(coalesce(x.value->>'experience_details','')),''))) order by x.ordinality) from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where x.ordinality<=10),'[]'::jsonb) else '[]'::jsonb end,
    -- Tailoring does not change education; older TAILORED copies may predate structured education, so fall back to the parent.
    'education',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('institution',x.value->>'institution','degree',x.value->>'degree','fieldOfStudy',x.value->>'field_of_study','location',x.value->>'location','startDate',x.value->'start_date','endDate',x.value->'end_date','gpa',x.value->>'gpa')) order by x.ordinality) from jsonb_array_elements(case
        when jsonb_typeof(r.structured_content->'education')='array' and jsonb_array_length(r.structured_content->'education')>0 then r.structured_content->'education'
        when jsonb_typeof(p.structured_content->'education')='array' then p.structured_content->'education'
        else '[]'::jsonb end) with ordinality x(value,ordinality) where x.ordinality<=10),'[]'::jsonb) else '[]'::jsonb end,
    'applicationAnswers',case when coalesce((p.autofill_preferences->>'allowReviewedAnswers')::boolean,false) then coalesce((select jsonb_agg(jsonb_build_object('answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,'answerValue',x.answer_value,'reviewedAt',x.reviewed_at) order by x.answer_key) from public.resume_application_answers x where x.resume_id=p.id and x.active and x.review_status='VERIFIED' and (not coalesce((p.autofill_preferences->>'prohibitSensitiveQuestions')::boolean,true) or x.answer_key not in('gender_identity','race_ethnicity','veteran_status'))),'[]'::jsonb) else '[]'::jsonb end,
    'guideEntries',coalesce((select jsonb_agg(jsonb_build_object(
        'id',g.id,'question',g.question,'howToAnswer',g.how_to_answer,'patterns',to_jsonb(g.autofill_patterns),'sensitive',g.autofill_sensitive,
        'mode',case when g.autofill_sensitive and coalesce((p.autofill_preferences->>'prohibitSensitiveQuestions')::boolean,true) then 'NEVER' else g.autofill_mode end,
        'source',g.autofill_source,'value',g.autofill_value) order by g.sort_order,g.question)
      from public.application_guide_entries g where g.status='PUBLISHED' and g.autofill_mode<>'NONE'),'[]'::jsonb)
  ) into v_resume_updated_at,v_review_status,v_preferences,v_result
  from public.application_extension_sessions s
  join public.applications a on a.id=s.application_id
  join public.job_descriptions j on j.id=a.job_description_id
  join public.resumes r on r.id=a.resume_id
  join public.resumes p on p.id=coalesce(r.parent_resume_id,r.id)
  where s.id=p_session_id and s.application_id=p_application_id and s.user_id=auth.uid() and s.action='AUTOFILL' and s.status in('CREATED','RECEIVED','TARGET_READY') and s.expires_at>now() and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE' and j.source_url~*'^https?://';
  if v_result is null then raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001'; end if;
  if v_review_status<>'VERIFIED' then raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001'; end if;
  if not coalesce((v_preferences->>'allowProfileFields')::boolean,false) and not coalesce((v_preferences->>'allowReviewedAnswers')::boolean,false) then raise exception 'AUTOFILL_CONSENT_REQUIRED: This Resume does not permit Autofill.' using errcode='P0001'; end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.get_application_autofill_context_v3157(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_application_autofill_context_v3157(uuid,uuid,timestamptz) to authenticated;

alter table public.application_extension_session_fields drop constraint if exists application_extension_session_fields_key_check;
alter table public.application_extension_session_fields add constraint application_extension_session_fields_key_check
  check (field_key ~ '^(candidate|screening|employment|education|guide|evidence)\.[A-Za-z0-9][A-Za-z0-9_.-]{0,96}$');

do $$
declare v_def text;v_new text;
begin
  v_def:=pg_get_functiondef('public.record_application_autofill_telemetry_v094(uuid,timestamptz,text,text,text,integer,integer,integer,integer,integer,jsonb)'::regprocedure);
  if position('|guide|evidence)\.' in v_def)>0 then return; end if;
  v_new:=replace(v_def,'|education|guide)\.','|education|guide|evidence)\.');
  if v_new=v_def then raise exception 'v3.159: Autofill telemetry field-key pattern was not found.'; end if;
  execute v_new;
end
$$;

notify pgrst,'reload schema';
