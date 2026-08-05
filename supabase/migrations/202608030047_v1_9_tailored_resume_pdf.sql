-- v1.9: audited DOCX/PDF artifact selection and generic tailored Resume finalization.

alter table public.tailoring_jobs
  add column render_format text not null default 'DOCX',
  add column format_selected_by uuid references auth.users(id) on delete set null,
  add column format_selected_at timestamptz;
alter table public.tailoring_jobs add constraint tailoring_jobs_render_format_check
  check(render_format in('DOCX','PDF'));

alter table public.resumes add column render_format text;
update public.resumes set render_format=case when mime_type='application/pdf' then 'PDF' else 'DOCX' end where resume_type='TAILORED';
alter table public.resumes add constraint resumes_render_format_check check(
  (resume_type='ORIGINAL' and render_format is null)
  or(resume_type='TAILORED' and render_format in('DOCX','PDF'))
);

create or replace function public.assign_tailored_resume_format_v19()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.resume_type='TAILORED' and new.render_format is null then
    new.render_format:=case when new.mime_type='application/pdf' then 'PDF' else 'DOCX' end;
  end if;
  if new.resume_type='ORIGINAL' then new.render_format:=null;end if;
  return new;
end$$;
create trigger resumes_assign_format_v19 before insert or update of resume_type,render_format,mime_type on public.resumes
for each row execute function public.assign_tailored_resume_format_v19();
revoke all on function public.assign_tailored_resume_format_v19() from public,anon,authenticated;

create or replace function public.select_tailoring_format_v19(
  p_tailoring_job_id uuid,p_render_format text,p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_format text:=upper(btrim(coalesce(p_render_format,'')));
begin
  perform public.assert_application_manager();
  if v_format not in('DOCX','PDF') then raise exception 'TAILORING_FORMAT_INVALID: Select DOCX or PDF.' using errcode='22023';end if;
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'APPROVED' then raise exception 'TAILORING_FORMAT_LOCKED: The artifact format can be selected only after approval and before rendering.' using errcode='P0001';end if;
  if p_expected_updated_at is null or v_job.updated_at is distinct from p_expected_updated_at then raise exception 'TAILORING_FORMAT_CONFLICT: This tailoring job changed. Refresh before selecting an artifact format.' using errcode='P0001';end if;
  update public.tailoring_jobs set render_format=v_format,format_selected_by=auth.uid(),format_selected_at=now(),updated_at=now()
  where id=v_job.id returning * into v_job;
  return jsonb_build_object('jobId',v_job.id,'renderFormat',v_job.render_format,'selectedBy',v_job.format_selected_by,'selectedAt',v_job.format_selected_at,'updatedAt',v_job.updated_at);
end$$;

create or replace function public.begin_tailoring_materialization_v19(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_job public.tailoring_jobs;v_extension text;v_mime text;v_filename text;v_path text;
begin
  v_result:=public.begin_tailoring_materialization_v16(p_tailoring_job_id);
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id;
  v_extension:=case when v_job.render_format='PDF' then 'pdf' else 'docx' end;
  v_mime:=case when v_job.render_format='PDF' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end;
  if coalesce((v_result->>'alreadyMaterialized')::boolean,false)=false then
    v_filename:=regexp_replace(v_result->>'filename','\.docx$','.'||v_extension);
    v_path:=regexp_replace(v_result->>'targetPath','\.docx$','.'||v_extension);
    update public.tailoring_jobs set format_selected_by=coalesce(format_selected_by,auth.uid()),format_selected_at=coalesce(format_selected_at,now()) where id=p_tailoring_job_id;
    v_result:=v_result||jsonb_build_object('filename',v_filename,'targetPath',v_path,'mimeType',v_mime);
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
  v_expected_path:=v_resume.user_id::text||'/'||v_job.id::text||'/'||v_expected_filename;
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

drop policy if exists "manager materializes tailored resumes" on storage.objects;
create policy "manager materializes tailored resumes" on storage.objects for insert to authenticated with check(
  bucket_id='tailored-resumes' and (select public.application_actor_can_manage()) and exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.materializing_by=auth.uid()
      and name=r.user_id::text||'/'||t.id::text||'/resume-'||r.resume_number||'-application-'||(select application_number from public.applications where id=t.application_id)||'-tailored.'||lower(t.render_format)
  )
);

revoke all on function public.select_tailoring_format_v19(uuid,text,timestamptz) from public,anon;
revoke all on function public.begin_tailoring_materialization_v19(uuid) from public,anon;
revoke all on function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text) from public,anon;
revoke execute on function public.begin_tailoring_materialization_v16(uuid) from authenticated;
revoke execute on function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) from authenticated;
grant execute on function public.select_tailoring_format_v19(uuid,text,timestamptz) to authenticated;
grant execute on function public.begin_tailoring_materialization_v19(uuid) to authenticated;
grant execute on function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text) to authenticated;

comment on column public.tailoring_jobs.render_format is 'Immutable allowlisted artifact format used after materialization begins.';
comment on column public.resumes.render_format is 'DOCX or PDF for a rendered TAILORED child; null for an ORIGINAL Resume.';
