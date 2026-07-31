-- v0.9.1: derived current location/employer plus explicitly reviewed,
-- voluntary self-identification answers. Sensitive answers remain Resume-owned,
-- RLS-protected, Application-scoped, and explicitly configured by a manager.

create or replace function public.resume_answer_prohibited_v090(p_key text,p_patterns text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select case when lower(coalesce(p_key,'')) in ('gender_identity','race_ethnicity','veteran_status') then false else
    lower(coalesce(p_key,'')||' '||array_to_string(coalesce(p_patterns,'{}'::text[]),' '))
      ~ '\m(race|racial|ethnicity|ethnic|gender|sex|sexual|orientation|religion|religious|disability|disabled|medical|veteran|military status|criminal|conviction|arrest|marital|pregnan|genetic)\M'
  end;
$$;

create or replace function public.resume_answer_sensitive_patterns_valid_v091(p_key text,p_patterns text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select case lower(coalesce(p_key,''))
    when 'gender_identity' then not exists(select 1 from unnest(coalesce(p_patterns,'{}'::text[])) p where lower(p) !~ '\m(gender|sex)\M|self.identif')
    when 'race_ethnicity' then not exists(select 1 from unnest(coalesce(p_patterns,'{}'::text[])) p where lower(p) !~ '\m(race|racial|ethnicity|ethnic)\M')
    when 'veteran_status' then not exists(select 1 from unnest(coalesce(p_patterns,'{}'::text[])) p where lower(p) !~ '\m(veteran)\M|military (status|service)')
    else true end;
$$;

do $$ declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid='public.resume_application_answers'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%answer_key%' or pg_get_constraintdef(oid) ilike '%resume_answer_prohibited_v090%')
  loop execute format('alter table public.resume_application_answers drop constraint %I',c.conname); end loop;
end $$;

alter table public.resume_application_answers
  add constraint resume_application_answers_key_v091_check check(answer_key in(
    'authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date','desired_salary',
    'years_of_experience','remote_work_preference','gender_identity','race_ethnicity','veteran_status')),
  add constraint resume_application_answers_prohibited_v091_check check(not public.resume_answer_prohibited_v090(answer_key,question_patterns)),
  add constraint resume_application_answers_sensitive_patterns_v091_check check(public.resume_answer_sensitive_patterns_valid_v091(answer_key,question_patterns)),
  add constraint resume_application_answers_key_type_v091_check check(
    (answer_key in('authorized_to_work','requires_sponsorship','willing_to_relocate') and answer_type='BOOLEAN') or
    (answer_key='available_start_date' and answer_type='DATE') or
    (answer_key in('desired_salary','gender_identity','race_ethnicity','veteran_status') and answer_type='TEXT') or
    (answer_key='years_of_experience' and answer_type='NUMBER') or
    (answer_key='remote_work_preference' and answer_type='SINGLE_SELECT'));

create or replace function public.save_resume_application_answer_v090(
  p_resume_id uuid,p_answer_id uuid,p_answer_key text,p_question_patterns text[],p_answer_type text,
  p_answer_value jsonb,p_review_status text default 'NEEDS_REVIEW',p_active boolean default true
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid();v_key text:=lower(btrim(coalesce(p_answer_key,'')));
  v_type text:=upper(btrim(coalesce(p_answer_type,'')));v_review text:=upper(btrim(coalesce(p_review_status,'')));
  v_patterns text[];v_id uuid;
begin
  perform public.assert_application_manager();
  if not exists(select 1 from public.resumes where id=p_resume_id and status='ACTIVE') then raise exception 'RESUME_ANSWER_RESUME_UNAVAILABLE: The active Resume was not found.' using errcode='P0001'; end if;
  select coalesce(array_agg(distinct btrim(p) order by btrim(p)) filter(where btrim(p)<>''),'{}'::text[]) into v_patterns from unnest(coalesce(p_question_patterns,'{}'::text[])) p;
  if v_key not in('authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date','desired_salary','years_of_experience','remote_work_preference','gender_identity','race_ethnicity','veteran_status')
     or v_review not in('NEEDS_REVIEW','VERIFIED') or not public.resume_answer_patterns_valid_v090(v_patterns)
     or public.resume_answer_prohibited_v090(v_key,v_patterns) or not public.resume_answer_sensitive_patterns_valid_v091(v_key,v_patterns)
     or not public.resume_answer_value_valid_v090(v_type,p_answer_value)
     or (v_key in('authorized_to_work','requires_sponsorship','willing_to_relocate') and v_type<>'BOOLEAN')
     or (v_key='available_start_date' and v_type<>'DATE')
     or (v_key in('desired_salary','gender_identity','race_ethnicity','veteran_status') and v_type<>'TEXT')
     or (v_key='years_of_experience' and v_type<>'NUMBER') or (v_key='remote_work_preference' and v_type<>'SINGLE_SELECT') then
    raise exception 'RESUME_ANSWER_INVALID: Review the answer key, type, value, patterns, and approved categories.' using errcode='P0001';
  end if;
  if v_type='DATE' then perform (p_answer_value#>>'{}')::date; end if;
  if p_answer_id is null then
    insert into public.resume_application_answers(resume_id,answer_key,question_patterns,answer_type,answer_value,review_status,reviewed_by,reviewed_at,active,created_by)
    values(p_resume_id,v_key,v_patterns,v_type,p_answer_value,v_review,case when v_review='VERIFIED' then v_actor end,case when v_review='VERIFIED' then now() end,coalesce(p_active,true),v_actor) returning id into v_id;
  else
    update public.resume_application_answers set answer_key=v_key,question_patterns=v_patterns,answer_type=v_type,answer_value=p_answer_value,review_status=v_review,
      reviewed_by=case when v_review='VERIFIED' then v_actor end,reviewed_at=case when v_review='VERIFIED' then now() end,active=coalesce(p_active,true)
    where id=p_answer_id and resume_id=p_resume_id returning id into v_id;
    if v_id is null then raise exception 'RESUME_ANSWER_NOT_FOUND: The Resume answer was not found.' using errcode='P0001'; end if;
  end if;
  return jsonb_build_object('id',v_id,'answers',public.list_resume_application_answers_v090(p_resume_id));
exception
  when unique_violation then raise exception 'RESUME_ANSWER_DUPLICATE: This Resume already has an answer for that key.' using errcode='P0001';
  when check_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'RESUME_ANSWER_INVALID: The answer value is invalid for its type.' using errcode='P0001';
end;
$$;

create or replace function public.save_resume_application_answers_v091(p_resume_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb;v_key text;v_id uuid;v_patterns text[];
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers) not between 1 and 10 then raise exception 'RESUME_ANSWERS_INVALID: Configure between one and ten answers.' using errcode='P0001'; end if;
  if (select count(*) from jsonb_array_elements(p_answers))<>(select count(distinct lower(btrim(value->>'answerKey'))) from jsonb_array_elements(p_answers)) then raise exception 'RESUME_ANSWERS_DUPLICATE: Each answer key may appear only once.' using errcode='P0001'; end if;
  for v_item in select value from jsonb_array_elements(p_answers) loop
    v_key:=lower(btrim(coalesce(v_item->>'answerKey','')));
    select id into v_id from public.resume_application_answers where resume_id=p_resume_id and answer_key=v_key;
    select coalesce(array_agg(value),'{}'::text[]) into v_patterns from jsonb_array_elements_text(coalesce(v_item->'questionPatterns','[]'::jsonb));
    perform public.save_resume_application_answer_v090(p_resume_id,v_id,v_key,v_patterns,v_item->>'answerType',v_item->'answerValue',coalesce(v_item->>'reviewStatus','NEEDS_REVIEW'),coalesce((v_item->>'active')::boolean,true));
  end loop;
  return public.list_resume_application_answers_v090(p_resume_id);
exception when invalid_text_representation then raise exception 'RESUME_ANSWERS_INVALID: Review the configured answer values.' using errcode='P0001';
end;
$$;

create or replace function public.get_application_autofill_context_v089(p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,'job',jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,'salaryPeriod',j.salary_period,'salaryText',j.salary_text),
    'resumeId',r.id,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'values',jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),'candidate.middleName',r.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',r.candidate_name,'candidate.email',r.candidate_email,'candidate.phone',r.candidate_phone,'candidate.addressLine1',r.address_line_1,'candidate.addressLine2',r.address_line_2,
      'candidate.city',r.address_city,'candidate.state',r.address_state_region,'candidate.postalCode',r.address_postal_code,'candidate.country',r.address_country,
      'candidate.currentLocation',nullif(concat_ws(', ',nullif(btrim(r.address_city),''),nullif(btrim(r.address_state_region),''),nullif(btrim(r.address_country),'')),''),
      'candidate.currentCompany',(select nullif(btrim(x.value->>'company'),'') from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') order by x.ordinality limit 1),
      'candidate.linkedInUrl',r.linkedin_url,'candidate.githubUrl',r.github_url,'candidate.portfolioUrl',r.portfolio_url,'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),''))),
    'applicationAnswers',coalesce((select jsonb_agg(jsonb_build_object('answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,'answerValue',x.answer_value,'reviewedAt',x.reviewed_at) order by x.answer_key) from public.resume_application_answers x where x.resume_id=r.id and x.active and x.review_status='VERIFIED'),'[]'::jsonb)
  ) into v_resume_updated_at,v_review_status,v_result
  from public.application_extension_sessions s join public.applications a on a.id=s.application_id join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id
  where s.id=p_session_id and s.application_id=p_application_id and s.user_id=auth.uid() and s.action='AUTOFILL' and s.status in('CREATED','RECEIVED','TARGET_READY') and s.expires_at>now() and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE' and j.source_url~*'^https?://';
  if v_result is null then raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001'; end if;
  if v_review_status<>'VERIFIED' then raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001'; end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.resume_answer_sensitive_patterns_valid_v091(text,text[]) from public,anon,authenticated;
revoke all on function public.save_resume_application_answer_v090(uuid,uuid,text,text[],text,jsonb,text,boolean) from public,anon;
revoke all on function public.save_resume_application_answers_v091(uuid,jsonb) from public,anon;
revoke all on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.save_resume_application_answer_v090(uuid,uuid,text,text[],text,jsonb,text,boolean) to authenticated;
grant execute on function public.save_resume_application_answers_v091(uuid,jsonb) to authenticated;
grant execute on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) to authenticated;
