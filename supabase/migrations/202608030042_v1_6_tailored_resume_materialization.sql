-- v1.6: materialize an approved preview as one private DOCX Resume variant
-- and atomically make that child the Application's sole Resume.

alter table public.tailoring_jobs drop constraint if exists tailoring_jobs_status_check;
alter table public.tailoring_jobs add constraint tailoring_jobs_status_check check(status in(
  'PENDING','PROCESSING','NEEDS_REVIEW','APPROVED','MATERIALIZING','REJECTED','COMPLETED','FAILED','CANCELLED'
));
alter table public.tailoring_jobs
  add column tailored_resume_id uuid references public.resumes(id) on delete restrict,
  add column materializing_by uuid references auth.users(id) on delete set null,
  add column materialization_token uuid,
  add column materialization_started_at timestamptz,
  add column materialized_by uuid references auth.users(id) on delete set null,
  add column materialized_at timestamptz;
alter table public.tailoring_jobs add constraint tailoring_jobs_materialization_shape_check check(
  (status='COMPLETED' and tailored_resume_id is not null and tailored_resume_path is not null and materialized_by is not null and materialized_at is not null)
  or(tailored_resume_id is null and materialized_by is null and materialized_at is null)
);
alter table public.tailoring_jobs add constraint tailoring_jobs_active_materialization_check check(
  (status='MATERIALIZING' and materializing_by is not null and materialization_token is not null and materialization_started_at is not null)
  or(status<>'MATERIALIZING' and materializing_by is null and materialization_token is null and materialization_started_at is null)
);
create unique index tailoring_jobs_tailored_resume_key on public.tailoring_jobs(tailored_resume_id) where tailored_resume_id is not null;
create index tailoring_jobs_materializing_started_idx on public.tailoring_jobs(materialization_started_at,id) where status='MATERIALIZING';

create or replace function public.prevent_application_resume_family_duplicate_v16()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_family uuid;
begin
  select coalesce(parent_resume_id,id) into v_family from public.resumes where id=new.resume_id;
  perform pg_advisory_xact_lock(hashtextextended(new.job_description_id::text||':'||coalesce(v_family::text,''),0));
  if exists(
    select 1 from public.applications a join public.resumes r on r.id=a.resume_id
    where a.id is distinct from new.id and a.job_description_id=new.job_description_id and coalesce(r.parent_resume_id,r.id)=v_family
  )then raise exception 'APPLICATION_ALREADY_EXISTS: This Job Description and Resume family already have an Application.' using errcode='23505';end if;
  return new;
end$$;
create trigger applications_resume_family_unique_v16 before insert or update of job_description_id,resume_id on public.applications
for each row execute function public.prevent_application_resume_family_duplicate_v16();
revoke all on function public.prevent_application_resume_family_duplicate_v16() from public,anon,authenticated;

create or replace function public.begin_tailoring_materialization_v16(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_path text;v_filename text;v_updated timestamptz;v_token uuid:=gen_random_uuid();v_resume_number bigint;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status='COMPLETED' and v_job.tailored_resume_id is not null then
    select resume_number into v_resume_number from public.resumes where id=v_job.tailored_resume_id;
    return jsonb_build_object('alreadyMaterialized',true,'jobId',v_job.id,'applicationId',v_job.application_id,'status','COMPLETED','tailoredResumeId',v_job.tailored_resume_id,'tailoredResumeNumber',v_resume_number);
  end if;
  if v_job.status='MATERIALIZING' and v_job.materialization_started_at>now()-interval '15 minutes' then raise exception 'TAILORING_MATERIALIZATION_CONFLICT: This approved preview is already being materialized.' using errcode='P0001';end if;
  if v_job.status not in('APPROVED','MATERIALIZING') or v_job.output_preview is null then raise exception 'TAILORING_MATERIALIZATION_UNAVAILABLE: Approve the tailored content before creating its Resume.' using errcode='P0001';end if;
  select * into v_application from public.applications where id=v_job.application_id for update;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  if v_application.resume_id is distinct from v_resume.id or v_application.job_description_id is distinct from v_jd.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_resume.id,v_job.output_preview);
  v_filename:='resume-'||v_resume.resume_number||'-application-'||v_application.application_number||'-tailored.docx';
  v_path:=v_resume.user_id::text||'/'||v_job.id::text||'/'||v_filename;
  update public.tailoring_jobs set status='MATERIALIZING',materializing_by=auth.uid(),materialization_token=v_token,materialization_started_at=now(),failure_code=null,failure_message=null where id=v_job.id returning updated_at into v_updated;
  return jsonb_build_object(
    'alreadyMaterialized',false,'jobId',v_job.id,'applicationId',v_application.id,'applicationNumber',v_application.application_number,
    'sourceResumeId',v_resume.id,'sourceResumeNumber',v_resume.resume_number,'targetBucket','tailored-resumes','targetPath',v_path,'filename',v_filename,'materializationToken',v_token,'jobUpdatedAt',v_updated,
    'candidate',jsonb_build_object('name',v_resume.candidate_name,'firstName',v_resume.candidate_first_name,'middleName',v_resume.candidate_middle_name,'lastName',v_resume.candidate_last_name,'email',v_resume.candidate_email,'phone',v_resume.candidate_phone,'city',v_resume.address_city,'stateRegion',v_resume.address_state_region,'country',v_resume.address_country,'linkedinUrl',v_resume.linkedin_url,'githubUrl',v_resume.github_url,'portfolioUrl',v_resume.portfolio_url),
    'sourceStructuredContent',v_resume.structured_content,'approvedPreview',v_job.output_preview,
    'jobDescription',jsonb_build_object('company',v_jd.company,'jobTitle',v_jd.job_title)
  );
end$$;

create or replace function public.finalize_tailoring_materialization_v16(
  p_tailoring_job_id uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text
)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_expected_path text;v_expected_filename text;v_experience jsonb;v_structured jsonb;v_text text;v_tailored_id uuid;v_resume_number bigint;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status='COMPLETED' and v_job.tailored_resume_id is not null then
    select resume_number into v_resume_number from public.resumes where id=v_job.tailored_resume_id;
    return jsonb_build_object('jobId',v_job.id,'applicationId',v_job.application_id,'status','COMPLETED','tailoredResumeId',v_job.tailored_resume_id,'tailoredResumeNumber',v_resume_number,'alreadyMaterialized',true);
  end if;
  if v_job.status<>'MATERIALIZING' or v_job.materializing_by is distinct from auth.uid() or v_job.materialization_token is distinct from p_materialization_token then raise exception 'TAILORING_MATERIALIZATION_CONFLICT: This materialization attempt is no longer active.' using errcode='P0001';end if;
  select * into v_application from public.applications where id=v_job.application_id for update;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  v_expected_filename:='resume-'||v_resume.resume_number||'-application-'||v_application.application_number||'-tailored.docx';
  v_expected_path:=v_resume.user_id::text||'/'||v_job.id::text||'/'||v_expected_filename;
  if v_application.resume_id is distinct from v_resume.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';end if;
  if p_storage_path is distinct from v_expected_path or p_original_filename is distinct from v_expected_filename or p_mime_type<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or p_file_size_bytes not between 1 and 5242880 or coalesce(p_file_sha256,'')!~'^[0-9a-f]{64}$' then raise exception 'TAILORING_ARTIFACT_INVALID: The rendered Resume metadata is invalid.' using errcode='P0001';end if;
  if not exists(select 1 from storage.objects where bucket_id='tailored-resumes' and name=v_expected_path) then raise exception 'TAILORING_ARTIFACT_MISSING: The private rendered Resume was not found.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_resume.id,v_job.output_preview);
  select jsonb_agg(e.value||jsonb_build_object('experience_details',p.value->>'tailoredDetails') order by e.ordinality) into v_experience
  from jsonb_array_elements(v_resume.structured_content->'professional_experience') with ordinality e(value,ordinality)
  join jsonb_array_elements(v_job.output_preview->'professionalExperience') p(value) on p.value->>'sourceExperienceId'=e.value->>'id';
  v_structured:=v_resume.structured_content||jsonb_build_object('summary',v_job.output_preview->>'summary','professional_experience',v_experience,'skills',array_to_string(array(select jsonb_array_elements_text(v_job.output_preview->'skills')),', '));
  select concat_ws(E'\n\n',v_resume.candidate_name,v_job.output_preview->>'summary',
    (select string_agg(concat_ws(E'\n',x->>'company',x->>'job_title',x->>'experience_details'),E'\n\n') from jsonb_array_elements(v_experience)x),
    nullif(v_resume.structured_content->>'education_legacy_text',''),array_to_string(array(select jsonb_array_elements_text(v_job.output_preview->'skills')),', ')) into v_text;
  if char_length(v_text)<100 then raise exception 'TAILORING_ARTIFACT_INVALID: The tailored Resume content is too short.' using errcode='P0001';end if;
  insert into public.resumes(
    user_id,candidate_name,candidate_email,candidate_phone,candidate_first_name,candidate_middle_name,candidate_last_name,
    address_line_1,address_line_2,address_city,address_state_region,address_postal_code,address_country,linkedin_url,github_url,portfolio_url,
    resume_name,primary_category_id,subcategory_id,seniority,skills,industries,resume_text,structured_content,structured_schema_version,
    storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,file_sha256,status,profile_review_status,profile_reviewed_by,profile_reviewed_at,profile_schema_version,autofill_preferences,resume_type,parent_resume_id
  )values(
    v_resume.user_id,v_resume.candidate_name,v_resume.candidate_email,v_resume.candidate_phone,v_resume.candidate_first_name,v_resume.candidate_middle_name,v_resume.candidate_last_name,
    v_resume.address_line_1,v_resume.address_line_2,v_resume.address_city,v_resume.address_state_region,v_resume.address_postal_code,v_resume.address_country,v_resume.linkedin_url,v_resume.github_url,v_resume.portfolio_url,
    left(v_resume.resume_name||' - Application #'||v_application.application_number,200),v_resume.primary_category_id,v_resume.subcategory_id,v_resume.seniority,array(select jsonb_array_elements_text(v_job.output_preview->'skills')),v_resume.industries,v_text,v_structured,v_resume.structured_schema_version,
    'tailored-resumes',v_expected_path,v_expected_filename,p_mime_type,p_file_size_bytes,p_file_sha256,'ACTIVE',v_resume.profile_review_status,v_resume.profile_reviewed_by,v_resume.profile_reviewed_at,v_resume.profile_schema_version,v_resume.autofill_preferences,'TAILORED',v_resume.id
  )returning id,resume_number into v_tailored_id,v_resume_number;
  update public.tailoring_jobs set status='COMPLETED',tailored_resume_id=v_tailored_id,tailored_resume_path=v_expected_path,materialized_by=auth.uid(),materialized_at=now(),materializing_by=null,materialization_token=null,materialization_started_at=null,failure_code=null,failure_message=null where id=v_job.id;
  update public.applications set resume_id=v_tailored_id where id=v_application.id;
  return jsonb_build_object('jobId',v_job.id,'applicationId',v_application.id,'status','COMPLETED','sourceResumeId',v_resume.id,'sourceResumeNumber',v_resume.resume_number,'tailoredResumeId',v_tailored_id,'tailoredResumeNumber',v_resume_number,'filename',v_expected_filename,'alreadyMaterialized',false);
end$$;

create or replace function public.fail_tailoring_materialization_v16(p_tailoring_job_id uuid,p_materialization_token uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_code text:=upper(btrim(coalesce(p_failure_code,'')));
begin
  perform public.assert_application_manager();
  if v_code not in('RENDER_FAILED','UPLOAD_FAILED','FINALIZE_FAILED') then raise exception 'TAILORING_MATERIALIZATION_INVALID: The materialization failure code is invalid.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.status<>'MATERIALIZING' or v_job.materializing_by is distinct from auth.uid() or v_job.materialization_token is distinct from p_materialization_token then raise exception 'TAILORING_MATERIALIZATION_CONFLICT: This materialization attempt is no longer active.' using errcode='P0001';end if;
  update public.tailoring_jobs set status='APPROVED',materializing_by=null,materialization_token=null,materialization_started_at=null,failure_code=v_code,failure_message='The approved content remains available. Retry Resume creation from the dashboard.' where id=v_job.id;
  return jsonb_build_object('jobId',v_job.id,'status','APPROVED','failureCode',v_code);
end$$;

drop policy if exists "managers own or admins read tailored resumes" on storage.objects;
drop policy if exists "managers own or admins insert tailored resumes" on storage.objects;
drop policy if exists "managers own or admins update tailored resumes" on storage.objects;
drop policy if exists "managers own or admins delete tailored resumes" on storage.objects;
create policy "application scoped or manager read tailored resumes" on storage.objects for select to authenticated using(
  bucket_id='tailored-resumes' and (select public.is_active_user(auth.uid())) and(
    (select public.application_actor_can_manage()) or((select public.has_role('APPLIER',auth.uid())) and exists(
      select 1 from public.resumes r join public.applications a on a.resume_id=r.id where r.storage_bucket=bucket_id and r.storage_path=name and a.assigned_to=auth.uid()
    ))
  )
);
create policy "manager materializes tailored resumes" on storage.objects for insert to authenticated with check(
  bucket_id='tailored-resumes' and (select public.application_actor_can_manage()) and exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.materializing_by=auth.uid() and name=r.user_id::text||'/'||t.id::text||'/resume-'||r.resume_number||'-application-'||(select application_number from public.applications where id=t.application_id)||'-tailored.docx'
  )
);
create policy "manager cleans failed tailored materialization" on storage.objects for delete to authenticated using(
  bucket_id='tailored-resumes' and (select public.application_actor_can_manage()) and exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.materializing_by=auth.uid() and name like r.user_id::text||'/'||t.id::text||'/%'
  )
);

-- Preserve the existing extension contracts while exposing variant identity.
-- The answer library remains owned by the original Resume and is resolved
-- through parent_resume_id for an Application-specific tailored child.
alter function public.get_application_extension_context_v085(uuid) rename to get_application_extension_context_v085_pre_v16;
create or replace function public.get_application_extension_context_v085(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume public.resumes;
begin
  v_result:=public.get_application_extension_context_v085_pre_v16(p_application_id);
  select r.* into v_resume from public.applications a join public.resumes r on r.id=a.resume_id where a.id=p_application_id;
  return jsonb_set(v_result,'{resume}',(v_result->'resume')||jsonb_build_object('resumeNumber',v_resume.resume_number,'resumeType',v_resume.resume_type,'parentResumeId',v_resume.parent_resume_id));
end$$;

alter function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) rename to get_application_autofill_context_v089_pre_v16;
create or replace function public.get_application_autofill_context_v089(p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_answer_resume_id uuid;v_preferences jsonb;v_answers jsonb:='[]'::jsonb;
begin
  v_result:=public.get_application_autofill_context_v089_pre_v16(p_application_id,p_session_id,p_expected_resume_updated_at);
  select coalesce(r.parent_resume_id,r.id),r.autofill_preferences into v_answer_resume_id,v_preferences from public.applications a join public.resumes r on r.id=a.resume_id where a.id=p_application_id;
  if coalesce((v_preferences->>'allowReviewedAnswers')::boolean,false) then
    select coalesce(jsonb_agg(jsonb_build_object('answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,'answerValue',x.answer_value,'reviewedAt',x.reviewed_at) order by x.answer_key),'[]'::jsonb) into v_answers
    from public.resume_application_answers x where x.resume_id=v_answer_resume_id and x.active and x.review_status='VERIFIED'
      and(not coalesce((v_preferences->>'prohibitSensitiveQuestions')::boolean,true) or x.answer_key not in('gender_identity','race_ethnicity','veteran_status'));
  end if;
  return jsonb_set(v_result,'{applicationAnswers}',v_answers);
end$$;

revoke all on function public.get_application_extension_context_v085_pre_v16(uuid) from public,anon,authenticated;
revoke all on function public.get_application_autofill_context_v089_pre_v16(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.get_application_extension_context_v085(uuid) from public,anon;
revoke all on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_application_extension_context_v085(uuid) to authenticated;
grant execute on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) to authenticated;

revoke all on function public.begin_tailoring_materialization_v16(uuid) from public,anon;
revoke all on function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) from public,anon;
revoke all on function public.fail_tailoring_materialization_v16(uuid,uuid,text) from public,anon;
grant execute on function public.begin_tailoring_materialization_v16(uuid) to authenticated;
grant execute on function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) to authenticated;
grant execute on function public.fail_tailoring_materialization_v16(uuid,uuid,text) to authenticated;

comment on column public.tailoring_jobs.tailored_resume_id is 'The immutable TAILORED child created from the approved preview and assigned to this job Application.';
comment on column public.tailoring_jobs.materialized_at is 'Server timestamp when the private artifact, child Resume, and Application switch completed.';
