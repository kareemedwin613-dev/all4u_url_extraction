-- v3.157 Guide-driven Autofill.
-- The published Application Guide becomes the answer standard for Autofill:
--   * guide entries gain an Admin-managed autofill rule (fixed answer, derived value, or never fill);
--   * the parent Resume gains a gender used for gender and pronoun questions;
--   * the Autofill context returns guide rules, experience details, and parent-owned preferences;
--   * unanswered questions the extension meets are counted so Admins can add guide entries.
-- Autofill still fills immediately and a human reviews the page before submitting (no preview step).

-- 1. Parent Resume gender ------------------------------------------------------------------

alter table public.resumes add column if not exists gender text;
alter table public.resumes drop constraint if exists resumes_gender_check;
alter table public.resumes add constraint resumes_gender_check check (gender is null or gender in ('MALE','FEMALE','NON_BINARY'));
comment on column public.resumes.gender is 'Candidate gender for gender and pronoun questions. Set on ORIGINAL Resumes; TAILORED Resumes read it from the parent.';

create or replace function public.update_resume_gender_v3157(p_resume_id uuid,p_gender text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_gender text:=nullif(upper(btrim(coalesce(p_gender,''))),'');v_type text;
begin
  perform public.assert_application_manager();
  if v_gender is not null and v_gender not in ('MALE','FEMALE','NON_BINARY') then
    raise exception 'RESUME_GENDER_INVALID: Choose Male, Female, Non-binary, or leave it blank.' using errcode='P0001';
  end if;
  select resume_type into v_type from public.resumes where id=p_resume_id;
  if v_type is null then raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  if v_type<>'ORIGINAL' then raise exception 'RESUME_GENDER_PARENT_ONLY: Set gender on the original Resume.' using errcode='P0001'; end if;
  update public.resumes set gender=v_gender where id=p_resume_id;
  return public.get_resume_autofill_preferences_v095(p_resume_id);
end;
$$;

create or replace function public.get_resume_autofill_preferences_v095(p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select jsonb_build_object('resumeId',id,'status',status,'reviewStatus',profile_review_status,'preferences',autofill_preferences,'updatedAt',updated_at,'gender',gender,'resumeType',resume_type)
  into v_result from public.resumes where id=p_resume_id;
  if v_result is null then raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

-- 2. Guide autofill rules -------------------------------------------------------------------

alter table public.application_guide_entries
  add column if not exists autofill_mode text not null default 'NONE',
  add column if not exists autofill_value text not null default '',
  add column if not exists autofill_source text,
  add column if not exists autofill_patterns text[] not null default '{}',
  add column if not exists autofill_sensitive boolean not null default false;

alter table public.application_guide_entries drop constraint if exists application_guide_entries_autofill_check;
alter table public.application_guide_entries add constraint application_guide_entries_autofill_check check (
  autofill_mode in ('NONE','FIXED','DERIVED','NEVER')
  and char_length(autofill_value)<=500
  and cardinality(autofill_patterns)<=20
  and (autofill_mode<>'FIXED' or char_length(btrim(autofill_value))>0)
  and (autofill_mode<>'DERIVED' or autofill_source in (
    'candidate.currentLocation','candidate.postalCode','candidate.city','candidate.state','candidate.country',
    'candidate.email','candidate.phone','candidate.fullName','candidate.linkedInUrl','candidate.addressLine1',
    'gender','pronouns','salaryExpectation','startAvailability','gpa','totalYearsOfExperience'))
);

comment on column public.application_guide_entries.autofill_mode is 'NONE: guidance only. FIXED: fill autofill_value. DERIVED: compute from autofill_source (autofill_value is the fallback or seed). NEVER: a person must answer.';
comment on column public.application_guide_entries.autofill_patterns is 'Extra question wordings matched in addition to the question itself. [Company] matches any company name.';
comment on column public.application_guide_entries.autofill_sensitive is 'Voluntary self-identification. Not filled when the Resume prohibits sensitive questions.';

create or replace function public.application_guide_json(p_row public.application_guide_entries)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_name text;
begin
  select nullif(btrim(full_name),'') into v_name from public.profiles where id=p_row.approved_by;
  return jsonb_build_object(
    'id',p_row.id,'question',p_row.question,'meaning',p_row.meaning,'howToAnswer',p_row.how_to_answer,
    'exampleAnswer',p_row.example_answer,'status',p_row.status,'version',p_row.version,'sortOrder',p_row.sort_order,
    'approvedByName',v_name,'publishedAt',p_row.published_at,'createdAt',p_row.created_at,'updatedAt',p_row.updated_at,
    'autofillMode',p_row.autofill_mode,'autofillValue',p_row.autofill_value,'autofillSource',p_row.autofill_source,
    'autofillPatterns',to_jsonb(p_row.autofill_patterns),'autofillSensitive',p_row.autofill_sensitive
  );
end;
$$;

create or replace function public.save_application_guide_autofill_v3157(p_id uuid,p_mode text,p_value text,p_source text,p_patterns text[],p_sensitive boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_mode text:=upper(btrim(coalesce(p_mode,'NONE')));
  v_value text:=btrim(coalesce(p_value,''));
  v_source text:=nullif(btrim(coalesce(p_source,'')),'');
  v_patterns text[];
  v_saved public.application_guide_entries;
begin
  if not public.application_guide_admin() then
    raise exception 'FORBIDDEN: Only an Admin can change the Application Guide.' using errcode='42501';
  end if;
  select coalesce(array_agg(distinct p) filter (where p<>''),'{}') into v_patterns
  from (select btrim(regexp_replace(x,'\s+',' ','g')) p from unnest(coalesce(p_patterns,'{}')) x) s;
  if v_mode not in ('NONE','FIXED','DERIVED','NEVER') then raise exception 'VALIDATION_ERROR: Choose how Autofill should treat this question.' using errcode='22023'; end if;
  if v_mode='FIXED' and v_value='' then raise exception 'VALIDATION_ERROR: Enter the answer Autofill should fill.' using errcode='22023'; end if;
  if v_mode='DERIVED' and v_source is null then raise exception 'VALIDATION_ERROR: Choose where Autofill should take the answer from.' using errcode='22023'; end if;
  if char_length(v_value)>500 or cardinality(v_patterns)>20 or exists(select 1 from unnest(v_patterns) p where char_length(p)>300) then
    raise exception 'VALIDATION_ERROR: Keep the answer under 500 characters and use at most 20 extra wordings.' using errcode='22023';
  end if;
  update public.application_guide_entries
  set autofill_mode=v_mode,autofill_value=case when v_mode in ('FIXED','DERIVED') then v_value else '' end,
      autofill_source=case when v_mode='DERIVED' then v_source end,
      autofill_patterns=v_patterns,autofill_sensitive=coalesce(p_sensitive,false),updated_at=clock_timestamp()
  where id=p_id returning * into v_saved;
  if v_saved.id is null then raise exception 'GUIDE_ENTRY_NOT_FOUND: That guide entry was not found.' using errcode='P0002'; end if;
  return public.application_guide_json(v_saved);
end;
$$;

-- 3. Seed autofill rules for the published guide (matched by question prefix) ---------------

drop table if exists pg_temp.v3157_guide_rules;
create temporary table v3157_guide_rules(prefix text primary key,mode text,value text,source text,sensitive boolean,patterns text[]);
insert into v3157_guide_rules values
  ('Are you a current or previously serving member in the military','FIXED','No',null,true,array['military service','served in the military','serving member in the military']),
  ('Are you a protected Veteran','FIXED','No',null,true,array['protected veteran','veteran status','protected veteran status']),
  ('Are you a spouse or partner of someone serving','FIXED','No',null,true,array['military spouse','spouse or partner of someone serving']),
  ('Are you a veteran','FIXED','No',null,true,array['are you a veteran']),
  ('Are you currently serving, or have you served in the Armed Forces','FIXED','No',null,true,array['served in the armed forces','reserves or national guard']),
  ('Are you open and able to travel occasionally','FIXED','No',null,false,array['travel to client sites','travel occasionally']),
  ('Are you open to occasional travel, including international','FIXED','No',null,false,array['international travel','occasional travel']),
  ('Are you open to working in-person in one of our offices','FIXED','No',null,false,array['work in person in one of our offices','working in person','work in the office','days a week in the office','days per week in the office','work onsite','work on site']),
  ('Are you willing to travel domestically','FIXED','No',null,false,array['willing to travel','travel domestically','able to travel']),
  ('Available to Start','DERIVED','Two weeks after accepting an offer','startAvailability',false,array['available start date','earliest start date','when can you start','date available','notice period','availability to start']),
  ('Can you perform the essential functions','FIXED','Yes',null,false,array['essential functions','with or without reasonable accommodation','with or without a reasonable accommodation']),
  ('Do you consent to AI evaluating','FIXED','Yes',null,false,array['consent to ai','ai evaluating your candidacy','consent to the use of ai']),
  ('Do you have any close or intimate personal relationships','FIXED','No',null,false,array['close or intimate personal relationship','personal or business ties','shared financial interests']),
  ('Do you have any relatives employed','FIXED','No',null,false,array['relatives employed','family members employed','relatives currently employed','relatives who work','related to anyone employed']),
  ('Do you identify as a member of the LGBTQ2S','FIXED','No',null,true,array['lgbtq2s']),
  ('Do you identify as LGBTQ','FIXED','No',null,true,array['identify as lgbtq','member of the lgbtq community']),
  ('Do you identify as transgender','FIXED','No',null,true,array['identify as transgender','transgender']),
  ('Do you participate in outside employment','FIXED','No',null,false,array['outside employment','outside business activities','secondary employment']),
  ('Have you applied for a job with us before','FIXED','No',null,false,array['applied with us before','previously applied','applied before','applied to this company']),
  ('Have you ever applied with','FIXED','No',null,false,array['applied with [Company] or any affiliates','ever applied with [Company]']),
  ('Have you worked with us before','FIXED','No',null,false,array['worked for us before','previously worked for','previously employed by','former employee','ever been employed by','worked here before','worked for [Company]']),
  ('I hereby state that the information','NEVER','',null,false,array['i hereby certify','i certify that','i hereby declare','i attest','information provided is true','true and complete','true and correct','accurate and complete']),
  ('I understand that this position will require a final round interview','FIXED','No',null,false,array['final round interview']),
  ('If you are under 18 years of age','FIXED','Yes',null,false,array['under 18 years of age','proof of your eligibility to work']),
  ('Is your application being generated or submitted by AI','FIXED','No',null,false,array['generated by ai','submitted by ai','automated tool','ai generated application']),
  ('Languages','FIXED','English',null,false,array['languages spoken','what languages do you speak','languages you speak']),
  ('Overall Result (GPA)','DERIVED','3.8','gpa',false,array['gpa','grade point average','overall gpa','cumulative gpa']),
  ('Please let us know when you would be able to begin','DERIVED','Two weeks after accepting an offer','startAvailability',false,array['when would you be able to begin','when could you start','when are you able to start']),
  ('Please provide the zip code of your current, permanent address','DERIVED','','candidate.postalCode',false,array['zip code of your current permanent address']),
  ('Please provide your GitHub URL','FIXED','N/A',null,false,array['github','github url','github profile']),
  ('Preferred pronouns','DERIVED','','pronouns',true,array['pronouns','preferred pronouns','what are your pronouns']),
  ('This role requires travel for company events','FIXED','No',null,false,array['travel for company events','team off sites','new hire training']),
  ('We may use SMS during the hiring process','FIXED','Yes',null,false,array['permission to text you','sms','text messages','receive text messages']),
  ('Were you referred for this position by a Senior Government Official','FIXED','No',null,false,array['senior government official','referred by a government official']),
  ('What is your salary expectation','DERIVED','150000','salaryExpectation',false,array['desired salary','salary expectations','salary expectation','expected salary','compensation expectations','desired compensation','salary requirements','expected compensation']),
  ('What is your work authorization','FIXED','U.S. citizen',null,false,array['work authorization status','current work authorization','citizenship status']),
  ('What percentage of time are you willing to travel','FIXED','0%',null,false,array['percentage of travel','percent travel','how much travel']);

update public.application_guide_entries e
set autofill_mode=r.mode,autofill_value=coalesce(r.value,''),autofill_source=r.source,autofill_sensitive=r.sensitive,autofill_patterns=r.patterns
from v3157_guide_rules r
where e.question ilike r.prefix||'%' and e.autofill_mode='NONE';
drop table v3157_guide_rules;

-- Personal Details "Location" uses a curly-quoted question, so match on its distinctive tail.
update public.application_guide_entries
set autofill_mode='DERIVED',autofill_source='candidate.currentLocation',autofill_patterns=array['location','current location','where are you located','location city','current city and state']
where question ilike 'What does%mean in Personal Details%' and autofill_mode='NONE';

-- Decisions confirmed for every profile that the guide did not yet cover.
insert into public.application_guide_entries(question,meaning,how_to_answer,example_answer,status,version,sort_order,published_at,autofill_mode,autofill_value,autofill_source,autofill_sensitive,autofill_patterns)
select v.question,v.meaning,v.how,'', 'PUBLISHED',1,
  coalesce((select max(sort_order) from public.application_guide_entries),0)+v.ord*10,clock_timestamp(),v.mode,v.value,v.source,v.sensitive,v.patterns
from (values
  (1,'Will you now or in the future require sponsorship for employment visa status?','The employer is asking whether you will need them to sponsor a work visa now or later.','No. Every profile is a U.S. citizen, so no sponsorship is needed.','FIXED','No',null::text,false,array['require sponsorship','visa sponsorship','need sponsorship','sponsorship','require company assistance or sponsorship']),
  (2,'Are you legally authorized to work in the United States?','The employer is asking whether you can legally work in the United States without restrictions.','Yes. Every profile is a U.S. citizen.','FIXED','Yes',null,false,array['authorized to work','eligible to work','legally authorized','authorization to work','permitted to work','unrestricted authorization']),
  (3,'Are you willing to relocate?','The employer is asking whether you would move to a different city for this job.','No.','FIXED','No',null,false,array['willing to relocate','open to relocation','able to relocate','relocate for this']),
  (4,'What is your preferred work arrangement?','The employer is asking whether you prefer remote, hybrid, or onsite work.','Remote. Every profile prefers remote work.','FIXED','Remote',null,false,array['preferred work arrangement','remote work preference','work location preference','work arrangement','work model']),
  (5,'How did you hear about us?','The employer is asking where you found this job posting.','LinkedIn.','FIXED','LinkedIn',null,false,array['how did you hear','how did you find','where did you hear','how did you learn about','referral source']),
  (6,'What is your gender?','The employer is asking for your gender on a voluntary self-identification form.','Use the gender recorded on the candidate''s original Resume. If none is recorded, leave it for review.','DERIVED','','gender',true,array['gender','gender identity','i identify my gender as','sex']),
  (7,'How many years of professional experience do you have?','The employer is asking for your total years of work experience, not experience with one skill.','Use the total years calculated from the candidate''s work history. Questions about one skill are answered separately.','DERIVED','','totalYearsOfExperience',false,array['years of experience','total years of experience','years of professional experience','how many years of experience','years of relevant experience'])
) v(ord,question,meaning,how,mode,value,source,sensitive,patterns)
where not exists(select 1 from public.application_guide_entries e where e.question=v.question);

-- 4. Accept guide field keys in Autofill session feedback ------------------------------------

alter table public.application_extension_session_fields drop constraint if exists application_extension_session_fields_key_check;
alter table public.application_extension_session_fields add constraint application_extension_session_fields_key_check
  check (field_key ~ '^(candidate|screening|employment|education|guide)\.[A-Za-z0-9][A-Za-z0-9_.-]{0,96}$');

do $$
declare v_def text;v_new text;
begin
  v_def:=pg_get_functiondef('public.record_application_autofill_telemetry_v094(uuid,timestamptz,text,text,text,integer,integer,integer,integer,integer,jsonb)'::regprocedure);
  v_new:=replace(v_def,'^(candidate|screening|employment|education)\.','^(candidate|screening|employment|education|guide)\.');
  if v_new=v_def then raise exception 'v3.157: Autofill telemetry field-key pattern was not found.'; end if;
  execute v_new;
end
$$;

-- 5. Autofill context ------------------------------------------------------------------------

create or replace function public.get_application_autofill_context_v3157(p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;v_preferences jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,p.autofill_preferences,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,
    'job',jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,'salaryPeriod',j.salary_period,'salaryText',j.salary_text,'workArrangement',j.work_arrangement,'locationText',j.location_text),
    'resumeId',r.id,'resumeType',r.resume_type,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'preferences',p.autofill_preferences,
    'gender',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then p.gender end,
    'values',case when coalesce((p.autofill_preferences->>'allowProfileFields')::boolean,false) then jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),'candidate.middleName',r.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',r.candidate_name,'candidate.email',r.candidate_email,'candidate.phone',r.candidate_phone,'candidate.addressLine1',r.address_line_1,'candidate.addressLine2',r.address_line_2,
      'candidate.city',r.address_city,'candidate.state',r.address_state_region,'candidate.postalCode',r.address_postal_code,'candidate.country',r.address_country,
      'candidate.currentLocation',nullif(concat_ws(', ',nullif(btrim(r.address_city),''),nullif(btrim(r.address_state_region),''),nullif(btrim(r.address_country),'')),''),
      'candidate.currentCompany',(select nullif(btrim(x.value->>'company'),'') from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality) where lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') order by x.ordinality limit 1),
      'candidate.linkedInUrl',r.linkedin_url,'candidate.githubUrl',r.github_url,'candidate.portfolioUrl',r.portfolio_url,'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),''))) else '{}'::jsonb end,
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

-- 6. Unanswered questions -------------------------------------------------------------------

create table if not exists public.autofill_unresolved_questions (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique check (char_length(normalized_question) between 2 and 300),
  question text not null check (char_length(question) between 2 and 300),
  control_type text not null check (control_type in ('input','select','textarea','radio','checkbox','combobox')),
  reason text not null check (reason in ('NO_MATCHING_ANSWER','REVIEW_REQUIRED')),
  occurrences integer not null default 0 check (occurrences>=0),
  last_target_domain text check (last_target_domain is null or char_length(last_target_domain)<=253),
  last_adapter_id text check (last_adapter_id is null or last_adapter_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null
);
create index if not exists autofill_unresolved_questions_open_idx on public.autofill_unresolved_questions(last_seen_at desc) where dismissed_at is null;

-- One sighting per Autofill session, so re-scanning a page does not inflate counts.
create table if not exists public.autofill_unresolved_question_sightings (
  question_id uuid not null references public.autofill_unresolved_questions(id) on delete cascade,
  session_id uuid not null references public.application_extension_sessions(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (question_id,session_id)
);
create index if not exists autofill_unresolved_question_sightings_session_idx on public.autofill_unresolved_question_sightings(session_id);

alter table public.autofill_unresolved_questions enable row level security;
alter table public.autofill_unresolved_question_sightings enable row level security;
revoke all on table public.autofill_unresolved_questions from public,anon,authenticated;
revoke all on table public.autofill_unresolved_question_sightings from public,anon,authenticated;
comment on table public.autofill_unresolved_questions is 'Employer question wording Autofill could not answer. Never stores answers or candidate values; emails, URLs, and long digit runs are removed.';

create or replace function public.autofill_question_scrub_v3157(p_text text)
returns text language sql immutable security invoker set search_path='' as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_text,''),
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[email]','g'),
    'https?://[^[:space:]]+','[link]','g'),
    '[0-9][0-9 ().-]{5,}[0-9]','[number]','g'),
    '[[:space:]]+',' ','g')),300);
$$;

create or replace function public.record_autofill_unresolved_questions_v3157(p_session_id uuid,p_target_domain text,p_adapter_id text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb;v_question text;v_normalized text;v_control text;v_reason text;v_id uuid;v_new integer;v_recorded integer:=0;
  v_domain text:=nullif(lower(btrim(coalesce(p_target_domain,''))),'');v_adapter text:=nullif(lower(btrim(coalesce(p_adapter_id,''))),'');
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  if not exists(select 1 from public.application_extension_sessions s where s.id=p_session_id and s.user_id=auth.uid() and s.action='AUTOFILL') then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode='P0001';
  end if;
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)>50 then raise exception 'VALIDATION_ERROR: Send at most 50 questions.' using errcode='22023'; end if;
  if v_domain is not null and v_domain !~ '^[a-z0-9.-]{1,253}$' then v_domain:=null; end if;
  if v_adapter is not null and v_adapter !~ '^[a-z0-9][a-z0-9-]{0,79}$' then v_adapter:=null; end if;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_question:=public.autofill_question_scrub_v3157(v_item->>'question');
    v_normalized:=left(btrim(regexp_replace(lower(v_question),'[^[:alnum:]]+',' ','g')),300);
    v_control:=lower(coalesce(v_item->>'controlType',''));
    v_reason:=upper(coalesce(v_item->>'reason',''));
    continue when char_length(v_normalized)<2 or v_control not in ('input','select','textarea','radio','checkbox','combobox') or v_reason not in ('NO_MATCHING_ANSWER','REVIEW_REQUIRED');
    insert into public.autofill_unresolved_questions(normalized_question,question,control_type,reason,last_target_domain,last_adapter_id)
    values (v_normalized,v_question,v_control,v_reason,v_domain,v_adapter)
    on conflict (normalized_question) do update set question=excluded.question,control_type=excluded.control_type,reason=excluded.reason,
      last_target_domain=coalesce(excluded.last_target_domain,autofill_unresolved_questions.last_target_domain),
      last_adapter_id=coalesce(excluded.last_adapter_id,autofill_unresolved_questions.last_adapter_id)
    returning id into v_id;
    insert into public.autofill_unresolved_question_sightings(question_id,session_id) values (v_id,p_session_id) on conflict do nothing;
    get diagnostics v_new=row_count;
    if v_new>0 then
      update public.autofill_unresolved_questions set occurrences=occurrences+1,last_seen_at=now() where id=v_id;
      v_recorded:=v_recorded+1;
    end if;
  end loop;
  return jsonb_build_object('recorded',v_recorded);
end;
$$;

create or replace function public.list_autofill_unresolved_questions_v3157(p_days integer default 30,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can review unanswered Autofill questions.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'controlType',q.control_type,'reason',q.reason,'occurrences',q.occurrences,
      'lastTargetDomain',q.last_target_domain,'firstSeenAt',q.first_seen_at,'lastSeenAt',q.last_seen_at) order by q.occurrences desc,q.last_seen_at desc)
    from (select * from public.autofill_unresolved_questions where dismissed_at is null and last_seen_at>=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),365)))
          order by occurrences desc,last_seen_at desc limit greatest(1,least(coalesce(p_limit,100),500))) q),'[]'::jsonb);
end;
$$;

create or replace function public.dismiss_autofill_unresolved_question_v3157(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can review unanswered Autofill questions.' using errcode='42501'; end if;
  update public.autofill_unresolved_questions set dismissed_at=now(),dismissed_by=auth.uid() where id=p_id;
  if not found then raise exception 'UNRESOLVED_QUESTION_NOT_FOUND: That question was not found.' using errcode='P0002'; end if;
  return jsonb_build_object('id',p_id);
end;
$$;

-- 7. Grants ----------------------------------------------------------------------------------

revoke all on function public.update_resume_gender_v3157(uuid,text) from public,anon;
revoke all on function public.save_application_guide_autofill_v3157(uuid,text,text,text,text[],boolean) from public,anon;
revoke all on function public.get_application_autofill_context_v3157(uuid,uuid,timestamptz) from public,anon;
revoke all on function public.autofill_question_scrub_v3157(text) from public,anon,authenticated;
revoke all on function public.record_autofill_unresolved_questions_v3157(uuid,text,text,jsonb) from public,anon;
revoke all on function public.list_autofill_unresolved_questions_v3157(integer,integer) from public,anon;
revoke all on function public.dismiss_autofill_unresolved_question_v3157(uuid) from public,anon;
grant execute on function public.update_resume_gender_v3157(uuid,text) to authenticated;
grant execute on function public.save_application_guide_autofill_v3157(uuid,text,text,text,text[],boolean) to authenticated;
grant execute on function public.get_application_autofill_context_v3157(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.record_autofill_unresolved_questions_v3157(uuid,text,text,jsonb) to authenticated;
grant execute on function public.list_autofill_unresolved_questions_v3157(integer,integer) to authenticated;
grant execute on function public.dismiss_autofill_unresolved_question_v3157(uuid) to authenticated;

notify pgrst,'reload schema';
