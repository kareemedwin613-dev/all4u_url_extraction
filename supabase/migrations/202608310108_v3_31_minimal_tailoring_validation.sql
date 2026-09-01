-- v3.31: only validate the source-role mapping. Tailored previews do not carry
-- dates; renderers reuse the original employer/title/location/date fields for
-- each sourceExperienceId.

create or replace function public.assert_tailoring_preview_v14(p_resume_id uuid,p_preview jsonb)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source_experience jsonb;
begin
  select structured_content->'professional_experience' into v_source_experience
  from public.resumes where id=p_resume_id and resume_type='ORIGINAL';

  if v_source_experience is null
    or p_preview is null
    or jsonb_typeof(v_source_experience)<>'array'
    or jsonb_typeof(p_preview)<>'object'
    or jsonb_typeof(p_preview->'professionalExperience')<>'array' then
    raise exception 'TAILORING_PREVIEW_INVALID: Tailored roles must match source roles so original dates can be reused.' using errcode='P0001';
  end if;

  if jsonb_array_length(v_source_experience)<>jsonb_array_length(p_preview->'professionalExperience')
    or exists(
      select 1
      from jsonb_array_elements(v_source_experience) with ordinality source_item(value,position)
      full join jsonb_array_elements(p_preview->'professionalExperience') with ordinality preview_item(value,position) using(position)
      where source_item.value is null
        or preview_item.value is null
        or jsonb_typeof(preview_item.value)<>'object'
        or btrim(coalesce(source_item.value->>'id',''))=''
        or preview_item.value->>'sourceExperienceId' is distinct from source_item.value->>'id'
    ) then
    raise exception 'TAILORING_PREVIEW_INVALID: Tailored roles must match source roles so original dates can be reused.' using errcode='P0001';
  end if;
end$$;

-- The legacy authenticated submission path previously duplicated the Skills
-- restriction. Route it through the same minimal role-mapping check.
create or replace function public.submit_tailoring_preview_v13(p_tailoring_job_id uuid,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then
    raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';
  end if;
  if v_job.status<>'PROCESSING' or v_job.processed_by is distinct from auth.uid() then
    raise exception 'TAILORING_JOB_NOT_PROCESSABLE: Load this job input before submitting its preview.' using errcode='P0001';
  end if;

  perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs
  set status='NEEDS_REVIEW',output_schema_version=1,output_preview=p_preview,
      preview_generated_at=now(),completed_at=now(),failure_code=null,failure_message=null
  where id=v_job.id;
  return jsonb_build_object('id',v_job.id,'applicationId',v_job.application_id,'status','NEEDS_REVIEW','outputSchemaVersion',1,'previewGeneratedAt',now());
end$$;

revoke all on function public.assert_tailoring_preview_v14(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.submit_tailoring_preview_v13(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.submit_tailoring_preview_v13(uuid,jsonb,timestamptz) to authenticated;

comment on function public.assert_tailoring_preview_v14(uuid,jsonb) is
  'Checks only source role identity/order so rendered employer and date fields remain source-derived.';
