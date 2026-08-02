-- v0.9.1: one-call manual Answer Library setup and JD salary context.
-- No Candidate values are inferred and all writes remain manager-authorized.

create or replace function public.save_resume_application_answers_v091(p_resume_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb;v_key text;v_id uuid;v_patterns text[];
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers) not between 1 and 7 then
    raise exception 'RESUME_ANSWERS_INVALID: Configure between one and seven answers.' using errcode='P0001';
  end if;
  if (select count(*) from jsonb_array_elements(p_answers)) <>
     (select count(distinct lower(btrim(value->>'answerKey'))) from jsonb_array_elements(p_answers)) then
    raise exception 'RESUME_ANSWERS_DUPLICATE: Each answer key may appear only once.' using errcode='P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_answers)
  loop
    v_key:=lower(btrim(coalesce(v_item->>'answerKey','')));
    select id into v_id from public.resume_application_answers where resume_id=p_resume_id and answer_key=v_key;
    select coalesce(array_agg(value),'{}'::text[]) into v_patterns
    from jsonb_array_elements_text(coalesce(v_item->'questionPatterns','[]'::jsonb));
    perform public.save_resume_application_answer_v090(
      p_resume_id,v_id,v_key,v_patterns,v_item->>'answerType',v_item->'answerValue',
      coalesce(v_item->>'reviewStatus','NEEDS_REVIEW'),coalesce((v_item->>'active')::boolean,true)
    );
  end loop;
  return public.list_resume_application_answers_v090(p_resume_id);
exception
  when invalid_text_representation then
    raise exception 'RESUME_ANSWERS_INVALID: Review the configured answer values.' using errcode='P0001';
end;
$$;

revoke all on function public.save_resume_application_answers_v091(uuid,jsonb) from public,anon;
grant execute on function public.save_resume_application_answers_v091(uuid,jsonb) to authenticated;

create or replace function public.get_application_autofill_context_v089(
  p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,
    'job',jsonb_build_object(
      'company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url,
      'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,
      'salaryPeriod',j.salary_period,'salaryText',j.salary_text
    ),
    'resumeId',r.id,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'values',jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),
      'candidate.middleName',r.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',r.candidate_name,'candidate.email',r.candidate_email,'candidate.phone',r.candidate_phone,
      'candidate.addressLine1',r.address_line_1,'candidate.addressLine2',r.address_line_2,'candidate.city',r.address_city,
      'candidate.state',r.address_state_region,'candidate.postalCode',r.address_postal_code,'candidate.country',r.address_country,
      'candidate.linkedInUrl',r.linkedin_url,'candidate.githubUrl',r.github_url,'candidate.portfolioUrl',r.portfolio_url,
      'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),'')
    )),
    'applicationAnswers',coalesce((select jsonb_agg(jsonb_build_object(
      'answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,
      'answerValue',x.answer_value,'reviewedAt',x.reviewed_at
    ) order by x.answer_key) from public.resume_application_answers x
      where x.resume_id=r.id and x.active and x.review_status='VERIFIED'),'[]'::jsonb)
  ) into v_resume_updated_at,v_review_status,v_result
  from public.application_extension_sessions s
  join public.applications a on a.id=s.application_id
  join public.job_descriptions j on j.id=a.job_description_id
  join public.resumes r on r.id=a.resume_id
  where s.id=p_session_id and s.application_id=p_application_id and s.user_id=auth.uid() and s.action='AUTOFILL'
    and s.status in('CREATED','RECEIVED','TARGET_READY') and s.expires_at>now()
    and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE' and j.source_url~*'^https?://';
  if v_result is null then raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001'; end if;
  if v_review_status<>'VERIFIED' then raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001'; end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) to authenticated;
