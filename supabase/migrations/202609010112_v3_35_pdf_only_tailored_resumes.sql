-- v3.35: every newly materialized tailored Resume is a clean PDF.
-- Historical completed DOCX artifacts remain readable and unchanged.

alter table public.tailoring_jobs alter column render_format set default 'PDF';

update public.tailoring_jobs
set render_format='PDF',format_selected_at=coalesce(format_selected_at,now())
where tailored_resume_id is null and status<>'MATERIALIZING';

create or replace function public.select_tailoring_format_v19(
  p_tailoring_job_id uuid,p_render_format text,p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_format text:=upper(btrim(coalesce(p_render_format,'')));
begin
  perform public.assert_application_manager();
  if v_format<>'PDF' then raise exception 'TAILORING_FORMAT_INVALID: Tailored Resumes are PDF-only.' using errcode='22023';end if;
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'APPROVED' then raise exception 'TAILORING_FORMAT_LOCKED: The artifact format can be confirmed only after approval and before rendering.' using errcode='P0001';end if;
  if p_expected_updated_at is null or v_job.updated_at is distinct from p_expected_updated_at then raise exception 'TAILORING_FORMAT_CONFLICT: This tailoring job changed. Refresh before confirming PDF output.' using errcode='P0001';end if;
  update public.tailoring_jobs set render_format='PDF',format_selected_by=auth.uid(),format_selected_at=now(),updated_at=now()
  where id=v_job.id returning * into v_job;
  return jsonb_build_object('jobId',v_job.id,'renderFormat','PDF','selectedBy',v_job.format_selected_by,'selectedAt',v_job.format_selected_at,'updatedAt',v_job.updated_at);
end$$;

create or replace function public.begin_tailoring_materialization_v19(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_job public.tailoring_jobs;v_filename text;v_path text;
begin
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id;
  if not found or (v_job.render_format<>'PDF' and not(v_job.status='COMPLETED' and v_job.tailored_resume_id is not null)) then raise exception 'TAILORING_FORMAT_INVALID: Tailored Resumes are PDF-only.' using errcode='22023';end if;
  v_result:=public.begin_tailoring_materialization_v16(p_tailoring_job_id);
  if coalesce((v_result->>'alreadyMaterialized')::boolean,false)=false then
    v_filename:=regexp_replace(v_result->>'filename','\.docx$','.pdf');
    v_path:=regexp_replace(v_result->>'targetPath','\.docx$','.pdf');
    update public.tailoring_jobs set format_selected_by=coalesce(format_selected_by,auth.uid()),format_selected_at=coalesce(format_selected_at,now()) where id=p_tailoring_job_id;
    v_result:=v_result||jsonb_build_object('filename',v_filename,'targetPath',v_path,'mimeType','application/pdf');
  end if;
  return v_result||jsonb_build_object('renderFormat',v_job.render_format,'renderTemplateKey',v_job.render_template_key);
end$$;

revoke all on function public.select_tailoring_format_v19(uuid,text,timestamptz) from public,anon;
revoke all on function public.begin_tailoring_materialization_v19(uuid) from public,anon;
grant execute on function public.select_tailoring_format_v19(uuid,text,timestamptz) to authenticated;
grant execute on function public.begin_tailoring_materialization_v19(uuid) to authenticated;

comment on column public.tailoring_jobs.render_format is 'PDF for every new tailored Resume; completed historical DOCX artifacts remain unchanged.';
