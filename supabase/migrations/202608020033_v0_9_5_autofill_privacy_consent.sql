-- v0.9.5: per-Resume consent, server-side eligibility, and bounded retention.

alter table public.resumes add column autofill_preferences jsonb not null default jsonb_build_object(
  'allowAttachment',true,'allowProfileFields',true,'allowReviewedAnswers',true,
  'requireReviewEveryField',false,'prohibitSensitiveQuestions',true
);

create or replace function public.resume_autofill_preferences_valid_v095(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select jsonb_typeof(p_value)='object'
    and (select count(*) from jsonb_object_keys(p_value))=5
    and p_value ?& array['allowAttachment','allowProfileFields','allowReviewedAnswers','requireReviewEveryField','prohibitSensitiveQuestions']
    and jsonb_typeof(p_value->'allowAttachment')='boolean'
    and jsonb_typeof(p_value->'allowProfileFields')='boolean'
    and jsonb_typeof(p_value->'allowReviewedAnswers')='boolean'
    and jsonb_typeof(p_value->'requireReviewEveryField')='boolean'
    and jsonb_typeof(p_value->'prohibitSensitiveQuestions')='boolean';
$$;

alter table public.resumes add constraint resumes_autofill_preferences_check
  check (public.resume_autofill_preferences_valid_v095(autofill_preferences));

create or replace function public.get_resume_autofill_preferences_v095(p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select jsonb_build_object('resumeId',id,'status',status,'reviewStatus',profile_review_status,'preferences',autofill_preferences,'updatedAt',updated_at)
  into v_result from public.resumes where id=p_resume_id;
  if v_result is null then raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.update_resume_autofill_preferences_v095(p_resume_id uuid,p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_application_manager();
  if not public.resume_autofill_preferences_valid_v095(p_preferences) then
    raise exception 'AUTOFILL_PREFERENCES_INVALID: Review all Autofill permission settings.' using errcode='P0001';
  end if;
  update public.resumes set autofill_preferences=p_preferences where id=p_resume_id;
  if not found then raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  return public.get_resume_autofill_preferences_v095(p_resume_id);
end;
$$;

create or replace function public.cleanup_application_extension_sessions_v095(p_retention_days integer default 30)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_expired integer:=0;v_deleted integer:=0;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) or not public.has_role('ADMIN',auth.uid()) then
    raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: Admin access is required.' using errcode='42501';
  end if;
  if p_retention_days not between 7 and 365 then raise exception 'APPLICATION_EXTENSION_RETENTION_INVALID: Retention must be between 7 and 365 days.' using errcode='P0001'; end if;
  update public.application_extension_sessions set status='EXPIRED',ended_at=coalesce(ended_at,now())
    where expires_at<=now() and status in('CREATED','RECEIVED','TARGET_READY');
  get diagnostics v_expired=row_count;
  delete from public.application_extension_sessions where coalesce(ended_at,expires_at)<now()-make_interval(days=>p_retention_days);
  get diagnostics v_deleted=row_count;
  return jsonb_build_object('expiredCount',v_expired,'deletedCount',v_deleted,'retentionDays',p_retention_days,'completedAt',now());
end;
$$;

create or replace function public.get_application_extension_context_v085(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select jsonb_build_object(
    'application',jsonb_build_object('id',a.id,'applicationNumber',a.application_number,'workStatus',a.work_status,'applicationStatus',a.application_status,'assignedTo',a.assigned_to),
    'job',jsonb_build_object('id',j.id,'company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url),
    'candidate',jsonb_build_object('displayName',r.candidate_name,'profileId',null,'profileAvailable',r.profile_review_status='VERIFIED'),
    'resume',jsonb_build_object('id',r.id,'resumeName',r.resume_name,'originalFilename',r.original_filename,'mimeType',r.mime_type,'fileSizeBytes',r.file_size_bytes,'status',r.status,'updatedAt',r.updated_at),
    'autofillPreferences',r.autofill_preferences,
    'permissions',jsonb_build_object(
      'canLoadResume',r.status='ACTIVE' and coalesce((r.autofill_preferences->>'allowAttachment')::boolean,false),
      'canAutofill',r.status='ACTIVE' and r.profile_review_status='VERIFIED' and j.source_url~*'^https?://' and (
        coalesce((r.autofill_preferences->>'allowProfileFields')::boolean,false) or coalesce((r.autofill_preferences->>'allowReviewedAnswers')::boolean,false)
      )
    )
  ) into v_result
  from public.applications a join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id
  where a.id=p_application_id and public.application_actor_can_view(a.assigned_to);
  if v_result is null then raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.get_application_autofill_context_v089(p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;v_preferences jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,r.autofill_preferences,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,
    'job',jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,'salaryPeriod',j.salary_period,'salaryText',j.salary_text),
    'resumeId',r.id,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'preferences',r.autofill_preferences,
    'values',case when coalesce((r.autofill_preferences->>'allowProfileFields')::boolean,false) then jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),'candidate.middleName',r.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',r.candidate_name,'candidate.email',r.candidate_email,'candidate.phone',r.candidate_phone,'candidate.addressLine1',r.address_line_1,'candidate.addressLine2',r.address_line_2,
      'candidate.city',r.address_city,'candidate.state',r.address_state_region,'candidate.postalCode',r.address_postal_code,'candidate.country',r.address_country,
      'candidate.currentLocation',nullif(concat_ws(', ',nullif(btrim(r.address_city),''),nullif(btrim(r.address_state_region),''),nullif(btrim(r.address_country),'')),''),
      'candidate.currentCompany',(select nullif(btrim(x.value->>'company'),'') from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') order by x.ordinality limit 1),
      'candidate.linkedInUrl',r.linkedin_url,'candidate.githubUrl',r.github_url,'candidate.portfolioUrl',r.portfolio_url,'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),''))) else '{}'::jsonb end,
    'employment',case when coalesce((r.autofill_preferences->>'allowProfileFields')::boolean,false) then coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('company',x.value->>'company','jobTitle',x.value->>'job_title','location',x.value->>'location','startDate',x.value->'start_date','endDate',x.value->'end_date','isCurrent',lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes'))) order by x.ordinality) from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where x.ordinality<=10),'[]'::jsonb) else '[]'::jsonb end,
    'education',case when coalesce((r.autofill_preferences->>'allowProfileFields')::boolean,false) then coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('institution',x.value->>'institution','degree',x.value->>'degree','fieldOfStudy',x.value->>'field_of_study','location',x.value->>'location','startDate',x.value->'start_date','endDate',x.value->'end_date','gpa',x.value->>'gpa')) order by x.ordinality) from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'education')='array' then r.structured_content->'education' else '[]'::jsonb end) with ordinality x(value,ordinality) where x.ordinality<=10),'[]'::jsonb) else '[]'::jsonb end,
    'applicationAnswers',case when coalesce((r.autofill_preferences->>'allowReviewedAnswers')::boolean,false) then coalesce((select jsonb_agg(jsonb_build_object('answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,'answerValue',x.answer_value,'reviewedAt',x.reviewed_at) order by x.answer_key) from public.resume_application_answers x where x.resume_id=r.id and x.active and x.review_status='VERIFIED' and (not coalesce((r.autofill_preferences->>'prohibitSensitiveQuestions')::boolean,true) or x.answer_key not in('gender_identity','race_ethnicity','veteran_status'))),'[]'::jsonb) else '[]'::jsonb end
  ) into v_resume_updated_at,v_review_status,v_preferences,v_result
  from public.application_extension_sessions s join public.applications a on a.id=s.application_id join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id
  where s.id=p_session_id and s.application_id=p_application_id and s.user_id=auth.uid() and s.action='AUTOFILL' and s.status in('CREATED','RECEIVED','TARGET_READY') and s.expires_at>now() and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE' and j.source_url~*'^https?://';
  if v_result is null then raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001'; end if;
  if v_review_status<>'VERIFIED' then raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001'; end if;
  if not coalesce((v_preferences->>'allowProfileFields')::boolean,false) and not coalesce((v_preferences->>'allowReviewedAnswers')::boolean,false) then raise exception 'AUTOFILL_CONSENT_REQUIRED: This Resume does not permit Autofill.' using errcode='P0001'; end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.resume_autofill_preferences_valid_v095(jsonb) from public,anon,authenticated;
revoke all on function public.get_resume_autofill_preferences_v095(uuid) from public,anon;
revoke all on function public.update_resume_autofill_preferences_v095(uuid,jsonb) from public,anon;
revoke all on function public.cleanup_application_extension_sessions_v095(integer) from public,anon;
grant execute on function public.get_resume_autofill_preferences_v095(uuid) to authenticated;
grant execute on function public.update_resume_autofill_preferences_v095(uuid,jsonb) to authenticated;
grant execute on function public.cleanup_application_extension_sessions_v095(integer) to authenticated;
grant execute on function public.resume_autofill_preferences_valid_v095(jsonb) to authenticated;
