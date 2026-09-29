-- v3.133: each materialization attempt writes a new private object, preserving archived PDFs.
-- Null paths support materializations already in flight during deployment.
alter table public.tailoring_jobs add column materialization_storage_path text;
comment on column public.tailoring_jobs.materialization_storage_path is 'Exact attempt-scoped upload path. Set by begin; retained for diagnostics. Historical completed artifacts are not moved.';
create or replace function public.begin_tailoring_materialization_v19(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_job public.tailoring_jobs;v_filename text;v_path text;v_layout jsonb;
begin
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id;
  if not found or (v_job.render_format<>'PDF' and not(v_job.status='COMPLETED' and v_job.tailored_resume_id is not null)) then raise exception 'TAILORING_FORMAT_INVALID: Tailored Resumes are PDF-only.' using errcode='22023';end if;
  v_result:=public.begin_tailoring_materialization_v16(p_tailoring_job_id);
  if coalesce((v_result->>'alreadyMaterialized')::boolean,false)=false then
    v_filename:=regexp_replace(v_result->>'filename','\.docx$','.pdf');
    v_path:=regexp_replace(v_result->>'targetPath','[^/]+$','')||(v_result->>'materializationToken')||'/'||v_filename;
    update public.tailoring_jobs set materialization_storage_path=v_path where id=p_tailoring_job_id;
    update public.tailoring_jobs set format_selected_by=coalesce(format_selected_by,auth.uid()),format_selected_at=coalesce(format_selected_at,now()) where id=p_tailoring_job_id;
    select jsonb_build_object('targetJob',jsonb_build_object('title',jd.job_title,'company',jd.company),
        'resumeSeniority',r.seniority,'resumeHeadline',r.resume_headline)
      into v_layout from public.job_descriptions jd,public.resumes r where jd.id=v_job.job_description_id and r.id=v_job.resume_id;
    v_result:=v_result||jsonb_build_object('filename',v_filename,'targetPath',v_path,'mimeType','application/pdf')||coalesce(v_layout,'{}'::jsonb);
  end if;
  return v_result||jsonb_build_object('renderFormat',v_job.render_format,'renderTemplateKey',v_job.render_template_key);
end$$;

create or replace function public.finalize_tailoring_materialization_v19(
  p_tailoring_job_id uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text
)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_expected_path text;v_expected_filename text;v_expected_mime text;v_extension text;v_experience jsonb;v_structured jsonb;v_text text;v_tailored_id uuid;v_resume_number bigint;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status='COMPLETED' and v_job.tailored_resume_id is not null then
    select resume_number into v_resume_number from public.resumes where id=v_job.tailored_resume_id;
    return jsonb_build_object('jobId',v_job.id,'applicationId',v_job.application_id,'status','COMPLETED','tailoredResumeId',v_job.tailored_resume_id,'tailoredResumeNumber',v_resume_number,'renderFormat',v_job.render_format,'renderTemplateKey',v_job.render_template_key,'alreadyMaterialized',true);
  end if;
  if v_job.status<>'MATERIALIZING' or v_job.materializing_by is distinct from auth.uid() or v_job.materialization_token is distinct from p_materialization_token then raise exception 'TAILORING_MATERIALIZATION_CONFLICT: This materialization attempt is no longer active.' using errcode='P0001';end if;
  select * into v_application from public.applications where id=v_job.application_id for update;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  v_extension:=case when v_job.render_format='PDF' then 'pdf' else 'docx' end;
  v_expected_mime:=case when v_job.render_format='PDF' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end;
  v_expected_filename:='resume-'||v_resume.resume_number||'-application-'||v_application.application_number||'-tailored.'||v_extension;
  v_expected_path:=coalesce(v_job.materialization_storage_path,v_resume.user_id::text||'/'||v_job.id::text||'/'||v_expected_filename);
  if v_application.resume_id is distinct from v_resume.id or v_application.job_description_id is distinct from v_jd.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';end if;
  if p_storage_path is distinct from v_expected_path or p_original_filename is distinct from v_expected_filename or p_mime_type is distinct from v_expected_mime or p_file_size_bytes not between 1 and 5242880 or coalesce(p_file_sha256,'')!~'^[0-9a-f]{64}$' then raise exception 'TAILORING_ARTIFACT_INVALID: The rendered Resume metadata is invalid.' using errcode='P0001';end if;
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
    storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,file_sha256,status,profile_review_status,profile_reviewed_by,profile_reviewed_at,profile_schema_version,autofill_preferences,resume_type,parent_resume_id,render_template_key,render_format
  )values(
    v_resume.user_id,v_resume.candidate_name,v_resume.candidate_email,v_resume.candidate_phone,v_resume.candidate_first_name,v_resume.candidate_middle_name,v_resume.candidate_last_name,
    v_resume.address_line_1,v_resume.address_line_2,v_resume.address_city,v_resume.address_state_region,v_resume.address_postal_code,v_resume.address_country,v_resume.linkedin_url,v_resume.github_url,v_resume.portfolio_url,
    left(v_resume.resume_name||' - Application #'||v_application.application_number,200),v_resume.primary_category_id,v_resume.subcategory_id,v_resume.seniority,array(select jsonb_array_elements_text(v_job.output_preview->'skills')),v_resume.industries,v_text,v_structured,v_resume.structured_schema_version,
    'tailored-resumes',v_expected_path,v_expected_filename,p_mime_type,p_file_size_bytes,p_file_sha256,'ACTIVE',v_resume.profile_review_status,v_resume.profile_reviewed_by,v_resume.profile_reviewed_at,v_resume.profile_schema_version,v_resume.autofill_preferences,'TAILORED',v_resume.id,v_job.render_template_key,v_job.render_format
  )returning id,resume_number into v_tailored_id,v_resume_number;
  update public.tailoring_jobs set status='COMPLETED',tailored_resume_id=v_tailored_id,tailored_resume_path=v_expected_path,materialized_by=auth.uid(),materialized_at=now(),materializing_by=null,materialization_token=null,materialization_started_at=null,failure_code=null,failure_message=null where id=v_job.id;
  update public.applications set resume_id=v_tailored_id where id=v_application.id;
  return jsonb_build_object('jobId',v_job.id,'applicationId',v_application.id,'status','COMPLETED','sourceResumeId',v_resume.id,'sourceResumeNumber',v_resume.resume_number,'tailoredResumeId',v_tailored_id,'tailoredResumeNumber',v_resume_number,'filename',v_expected_filename,'renderFormat',v_job.render_format,'renderTemplateKey',v_job.render_template_key,'alreadyMaterialized',false);
end$$;

create or replace function public.can_auto_materialize_tailored_resume_v34(p_object_name text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.automatic_materialization and t.materializing_by=t.processed_by
      and p_object_name=coalesce(t.materialization_storage_path,r.user_id::text||'/'||t.id::text||'/resume-'||r.resume_number||'-application-'||(select application_number from public.applications where id=t.application_id)||'-tailored.'||lower(t.render_format))
  )
$$;
-- Existing anon INSERT/DELETE policies call this function; no read access is added.
drop policy if exists "manager materializes tailored resumes" on storage.objects;
create policy "manager materializes tailored resumes" on storage.objects for insert to authenticated with check(
  bucket_id='tailored-resumes' and (select public.application_actor_can_manage()) and exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.materializing_by=auth.uid()
      and name=coalesce(t.materialization_storage_path,r.user_id::text||'/'||t.id::text||'/resume-'||r.resume_number||'-application-'||(select application_number from public.applications where id=t.application_id)||'-tailored.'||lower(t.render_format))
  )
);
revoke all on function public.begin_tailoring_materialization_v19(uuid) from public,anon;
revoke all on function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.begin_tailoring_materialization_v19(uuid) to authenticated;
grant execute on function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text) to authenticated;
revoke all on function public.can_auto_materialize_tailored_resume_v34(text) from public,authenticated;
grant execute on function public.can_auto_materialize_tailored_resume_v34(text) to anon;
notify pgrst,'reload schema';
