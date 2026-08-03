-- v1.3: Application-scoped tailoring request, sanitized worker input, and
-- validated preview persistence. This milestone does not create a TAILORED
-- Resume row, write a Resume file, or change applications.resume_id.

alter table public.tailoring_jobs
  add column application_id uuid references public.applications(id) on delete cascade,
  add column input_schema_version integer not null default 1 check(input_schema_version=1),
  add column output_schema_version integer check(output_schema_version=1),
  add column output_preview jsonb check(output_preview is null or jsonb_typeof(output_preview)='object'),
  add column preview_generated_at timestamptz,
  add column processed_by uuid references auth.users(id) on delete set null,
  add column failure_code text check(failure_code is null or char_length(failure_code)<=100),
  add column failure_message text check(failure_message is null or char_length(failure_message)<=1000);

create unique index tailoring_jobs_application_key on public.tailoring_jobs(application_id)
where application_id is not null;
create index tailoring_jobs_application_status_updated_idx
  on public.tailoring_jobs(application_id,status,updated_at desc)
  where application_id is not null;
create index tailoring_jobs_pending_created_idx on public.tailoring_jobs(created_at,id)
  where application_id is not null and status in('PENDING','PROCESSING');

create or replace function public.validate_tailoring_job()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_resume public.resumes;v_application public.applications;v_jd_owner uuid;
begin
  select * into v_resume from public.resumes where id=new.resume_id;
  if not found then raise exception 'TAILORING_RESUME_NOT_FOUND: The source Resume was not found.' using errcode='P0001';end if;
  if v_resume.storage_path is distinct from new.source_resume_path or v_resume.status<>'ACTIVE' then
    raise exception 'TAILORING_RESUME_INVALID: The source Resume must be active and its Storage path must match.' using errcode='23514';
  end if;
  if new.application_id is not null then
    select * into v_application from public.applications where id=new.application_id;
    if not found then raise exception 'TAILORING_APPLICATION_NOT_FOUND: The Application was not found.' using errcode='P0001';end if;
    if v_application.job_description_id is distinct from new.job_description_id or v_application.resume_id is distinct from new.resume_id then
      raise exception 'TAILORING_APPLICATION_MISMATCH: The JD and Resume must match the Application.' using errcode='23514';
    end if;
    if v_resume.resume_type<>'ORIGINAL' then raise exception 'TAILORING_REQUIRES_ORIGINAL: The source Resume must be ORIGINAL.' using errcode='23514';end if;
  else
    select user_id into v_jd_owner from public.job_descriptions where id=new.job_description_id;
    if v_jd_owner is distinct from new.user_id or v_resume.user_id is distinct from new.user_id then
      raise exception 'Referenced records must belong to user' using errcode='42501';
    end if;
  end if;
  return new;
end$$;

create or replace function public.request_application_tailoring_v13(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_application public.applications;v_resume public.resumes;v_job public.job_descriptions;v_job_id uuid;v_status text;
begin
  perform public.assert_application_manager();
  select * into v_application from public.applications where id=p_application_id;
  if not found then raise exception 'TAILORING_APPLICATION_NOT_FOUND: The Application was not found.' using errcode='P0001';end if;
  select * into v_resume from public.resumes where id=v_application.resume_id;
  select * into v_job from public.job_descriptions where id=v_application.job_description_id;
  if v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then raise exception 'TAILORING_REQUIRES_ORIGINAL: Tailoring requires an active ORIGINAL Resume.' using errcode='P0001';end if;
  if v_job.status<>'ACTIVE' then raise exception 'TAILORING_JD_INACTIVE: Tailoring requires an active Job Description.' using errcode='P0001';end if;
  if btrim(coalesce(v_resume.structured_content->>'summary',''))='' then raise exception 'TAILORING_RESUME_INCOMPLETE: Add a structured Resume summary before tailoring.' using errcode='P0001';end if;
  if jsonb_typeof(v_resume.structured_content->'professional_experience')<>'array' or jsonb_array_length(v_resume.structured_content->'professional_experience') not between 1 and 30 then
    raise exception 'TAILORING_RESUME_INCOMPLETE: Add between 1 and 30 structured employment records before tailoring.' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(v_resume.structured_content->'professional_experience') x where btrim(coalesce(x->>'id',''))='' or btrim(coalesce(x->>'company',''))='' or btrim(coalesce(x->>'job_title',''))='' or btrim(coalesce(x->>'experience_details',''))='') then
    raise exception 'TAILORING_RESUME_INCOMPLETE: Every employment record needs an ID, company, job title, and details.' using errcode='P0001';
  end if;
  if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(v_resume.structured_content->'professional_experience') x) then
    raise exception 'TAILORING_RESUME_INCOMPLETE: Employment record IDs must be unique.' using errcode='P0001';
  end if;

  select id,status into v_job_id,v_status from public.tailoring_jobs where application_id=p_application_id for update;
  if found then
    if v_status in('FAILED','CANCELLED','REJECTED') then
      update public.tailoring_jobs set status='PENDING',output_preview=null,output_schema_version=null,preview_generated_at=null,processed_by=null,failure_code=null,failure_message=null,started_at=null,completed_at=null,review_notes='' where id=v_job_id;
      v_status:='PENDING';
    end if;
  else
    select id,status into v_job_id,v_status from public.tailoring_jobs where user_id=auth.uid() and job_description_id=v_application.job_description_id and resume_id=v_application.resume_id and application_id is null for update;
    if found then
      update public.tailoring_jobs set application_id=p_application_id,status='PENDING',match_details=jsonb_build_object('source','APPLICATION_V13'),output_preview=null,output_schema_version=null,preview_generated_at=null,processed_by=null,failure_code=null,failure_message=null,started_at=null,completed_at=null,review_notes='' where id=v_job_id;
      v_status:='PENDING';
    else
      insert into public.tailoring_jobs(user_id,application_id,job_description_id,resume_id,match_score,match_details,status,source_resume_path,input_schema_version)
      values(auth.uid(),p_application_id,v_application.job_description_id,v_application.resume_id,0,jsonb_build_object('source','APPLICATION_V13'),'PENDING',v_resume.storage_path,1)
      returning id,status into v_job_id,v_status;
    end if;
  end if;
  return jsonb_build_object('id',v_job_id,'applicationId',p_application_id,'applicationNumber',v_application.application_number,'sourceResumeId',v_resume.id,'sourceResumeNumber',v_resume.resume_number,'status',v_status,'inputSchemaVersion',1);
end$$;

create or replace function public.get_tailoring_job_input_v13(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_experience jsonb;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status not in('PENDING','PROCESSING') then raise exception 'TAILORING_JOB_NOT_PROCESSABLE: Only pending or processing jobs expose worker input.' using errcode='P0001';end if;
  select * into v_application from public.applications where id=v_job.application_id;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  if v_application.resume_id is distinct from v_resume.id or v_application.job_description_id is distinct from v_jd.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then
    raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';
  end if;
  select jsonb_agg(jsonb_build_object(
    'id',x.value->>'id','company',x.value->>'company','title',x.value->>'job_title','location',nullif(x.value->>'location',''),
    'startDate',case when jsonb_typeof(x.value->'start_date')='object' then concat(x.value->'start_date'->>'year',case when coalesce((x.value->'start_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'start_date'->>'month',2,'0') else '' end) else null end,
    'endDate',case when lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') then null when jsonb_typeof(x.value->'end_date')='object' then concat(x.value->'end_date'->>'year',case when coalesce((x.value->'end_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'end_date'->>'month',2,'0') else '' end) else null end,
    'details',x.value->>'experience_details') order by x.ordinality) into v_experience
  from jsonb_array_elements(v_resume.structured_content->'professional_experience') with ordinality x(value,ordinality);
  update public.tailoring_jobs set status='PROCESSING',started_at=coalesce(started_at,now()),processed_by=auth.uid(),failure_code=null,failure_message=null where id=v_job.id;
  return jsonb_build_object(
    'jobId',v_job.id,
    'input',jsonb_build_object(
      'contractVersion','1.2',
      'application',jsonb_build_object('id',v_application.id,'applicationNumber',v_application.application_number),
      'jobDescription',jsonb_build_object('id',v_jd.id,'company',v_jd.company,'jobTitle',v_jd.job_title,'descriptionText',v_jd.description_text,'skills',to_jsonb(v_jd.detected_skills)),
      'sourceResume',jsonb_build_object('id',v_resume.id,'resumeNumber',v_resume.resume_number,'resumeType','ORIGINAL','summary',v_resume.structured_content->>'summary','skills',to_jsonb(v_resume.skills),'professionalExperience',coalesce(v_experience,'[]'::jsonb))
    )
  );
end$$;

create or replace function public.submit_tailoring_preview_v13(p_tailoring_job_id uuid,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_resume public.resumes;v_source_ids text[];v_result_ids text[];v_keys text[]:=array['summary','professionalExperience','skills','changeSummary','unsupportedRequirements','warnings'];
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'PROCESSING' or v_job.processed_by is distinct from auth.uid() then raise exception 'TAILORING_JOB_NOT_PROCESSABLE: Load this job input before submitting its preview.' using errcode='P0001';end if;
  if jsonb_typeof(p_preview)<>'object' or exists(select 1 from jsonb_object_keys(p_preview) k where not(k=any(v_keys))) or (select count(*) from jsonb_object_keys(p_preview))<>array_length(v_keys,1) then
    raise exception 'TAILORING_PREVIEW_INVALID: Preview fields do not match schema v1.' using errcode='P0001';
  end if;
  if jsonb_typeof(p_preview->'summary')<>'string' or btrim(coalesce(p_preview->>'summary',''))='' or char_length(p_preview->>'summary')>4000 then raise exception 'TAILORING_PREVIEW_INVALID: The tailored summary is invalid.' using errcode='P0001';end if;
  if jsonb_typeof(p_preview->'professionalExperience')<>'array' or jsonb_typeof(p_preview->'skills')<>'array' or jsonb_typeof(p_preview->'changeSummary')<>'array' or jsonb_typeof(p_preview->'unsupportedRequirements')<>'array' or jsonb_typeof(p_preview->'warnings')<>'array' then
    raise exception 'TAILORING_PREVIEW_INVALID: Preview collections must be arrays.' using errcode='P0001';
  end if;
  if jsonb_array_length(p_preview->'skills')>250 or jsonb_array_length(p_preview->'changeSummary')>100 or jsonb_array_length(p_preview->'unsupportedRequirements')>100 or jsonb_array_length(p_preview->'warnings')>100 then raise exception 'TAILORING_PREVIEW_INVALID: Preview collections are too large.' using errcode='P0001';end if;
  if exists(select 1 from jsonb_array_elements(p_preview->'skills') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>120)
    or exists(select 1 from jsonb_array_elements(p_preview->'changeSummary') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500)
    or exists(select 1 from jsonb_array_elements(p_preview->'unsupportedRequirements') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500)
    or exists(select 1 from jsonb_array_elements(p_preview->'warnings') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500) then
    raise exception 'TAILORING_PREVIEW_INVALID: Preview collection values are invalid.' using errcode='P0001';
  end if;
  if (select count(*)<>count(distinct lower(value)) from jsonb_array_elements_text(p_preview->'skills')) then raise exception 'TAILORING_PREVIEW_INVALID: Tailored skills must be unique.' using errcode='P0001';end if;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select array_agg(x->>'id' order by x->>'id') into v_source_ids from jsonb_array_elements(v_resume.structured_content->'professional_experience') x;
  select array_agg(x->>'sourceExperienceId' order by x->>'sourceExperienceId') into v_result_ids from jsonb_array_elements(p_preview->'professionalExperience') x;
  if v_result_ids is distinct from v_source_ids or exists(select 1 from jsonb_array_elements(p_preview->'professionalExperience') x where btrim(coalesce(x->>'tailoredDetails',''))='' or char_length(x->>'tailoredDetails')>12000 or (select count(*) from jsonb_object_keys(x))<>2 or not(x?'sourceExperienceId' and x?'tailoredDetails')) then
    raise exception 'TAILORING_PREVIEW_INVALID: Tailored experience records must exactly match the source experiences.' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements_text(p_preview->'skills') s where not exists(select 1 from unnest(v_resume.skills) source_skill where lower(source_skill)=lower(s))) then
    raise exception 'TAILORING_PREVIEW_INVALID: Tailored skills must exist on the source Resume.' using errcode='P0001';
  end if;
  update public.tailoring_jobs set status='NEEDS_REVIEW',output_schema_version=1,output_preview=p_preview,preview_generated_at=now(),completed_at=now(),failure_code=null,failure_message=null where id=v_job.id;
  return jsonb_build_object('id',v_job.id,'applicationId',v_job.application_id,'status','NEEDS_REVIEW','outputSchemaVersion',1,'previewGeneratedAt',now());
end$$;

create or replace function public.cancel_tailoring_job_v13(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_application_manager();
  update public.tailoring_jobs set status='CANCELLED',completed_at=now() where id=p_tailoring_job_id and status='PENDING' returning id into v_id;
  if v_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The pending tailoring job was not found.' using errcode='P0001';end if;
  return jsonb_build_object('id',v_id,'status','CANCELLED');
end$$;

create or replace function public.create_tailoring_jobs_v13(p_job_description_id uuid,p_matches jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches) not between 1 and 100 then raise exception 'TAILORING_REQUEST_INVALID: Provide between 1 and 100 Resume matches.' using errcode='P0001';end if;
  if not exists(select 1 from public.job_descriptions where id=p_job_description_id and user_id=auth.uid()) then raise exception 'TAILORING_JD_NOT_FOUND: The owned Job Description was not found.' using errcode='P0001';end if;
  if exists(select 1 from jsonb_array_elements(p_matches) x where jsonb_typeof(x)<>'object' or coalesce(x->>'resumeId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce((x->>'matchScore')::numeric,-1) not between 0 and 100 or jsonb_typeof(coalesce(x->'matchDetails','{}'::jsonb))<>'object') then raise exception 'TAILORING_REQUEST_INVALID: A Resume match is invalid.' using errcode='P0001';end if;
  with requested as(
    select distinct on(x.value->>'resumeId') x.value->>'resumeId' resume_id,(x.value->>'matchScore')::numeric match_score,coalesce(x.value->'matchDetails','{}'::jsonb) match_details,x.ordinality
    from jsonb_array_elements(p_matches) with ordinality x(value,ordinality) order by x.value->>'resumeId',x.ordinality
  ),eligible as(
    select q.*,r.storage_path from requested q join public.resumes r on r.id=q.resume_id::uuid where r.user_id=auth.uid() and r.status='ACTIVE' and r.resume_type='ORIGINAL'
  ),inserted as(
    insert into public.tailoring_jobs(user_id,job_description_id,resume_id,match_score,match_details,status,source_resume_path)
    select auth.uid(),p_job_description_id,e.resume_id::uuid,e.match_score,e.match_details,'PENDING',e.storage_path from eligible e
    on conflict(user_id,job_description_id,resume_id) do nothing returning resume_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('resumeId',q.resume_id,'status',case when e.resume_id is null then 'failed' when i.resume_id is not null then 'created' else 'alreadyQueued' end) order by q.ordinality),'[]'::jsonb)
  into v_result from requested q left join eligible e on e.resume_id=q.resume_id left join inserted i on i.resume_id=q.resume_id::uuid;
  return v_result;
exception when invalid_text_representation or invalid_parameter_value then raise exception 'TAILORING_REQUEST_INVALID: A Resume match is invalid.' using errcode='P0001';
end$$;

drop policy if exists "business roles read shared queue" on public.tailoring_jobs;
create policy "application scoped tailoring queue read" on public.tailoring_jobs for select to authenticated using(
  (select public.application_actor_can_manage()) or(
    application_id is not null and (select public.has_role('APPLIER')) and exists(select 1 from public.applications a where a.id=application_id and a.assigned_to=(select auth.uid()))
  )
);

revoke insert,update,delete on public.tailoring_jobs from authenticated;
revoke all on function public.request_application_tailoring_v13(uuid) from public,anon;
revoke all on function public.get_tailoring_job_input_v13(uuid) from public,anon;
revoke all on function public.submit_tailoring_preview_v13(uuid,jsonb,timestamptz) from public,anon;
revoke all on function public.cancel_tailoring_job_v13(uuid) from public,anon;
revoke all on function public.create_tailoring_jobs_v13(uuid,jsonb) from public,anon;
grant execute on function public.request_application_tailoring_v13(uuid) to authenticated;
grant execute on function public.get_tailoring_job_input_v13(uuid) to authenticated;
grant execute on function public.submit_tailoring_preview_v13(uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.cancel_tailoring_job_v13(uuid) to authenticated;
grant execute on function public.create_tailoring_jobs_v13(uuid,jsonb) to authenticated;

comment on column public.tailoring_jobs.application_id is 'Application whose current ORIGINAL Resume and JD produced this v1.3 preview.';
comment on column public.tailoring_jobs.output_preview is 'Validated structured preview only; not an approved Resume and not a generated file.';
