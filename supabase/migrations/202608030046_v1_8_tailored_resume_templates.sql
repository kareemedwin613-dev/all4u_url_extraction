-- v1.8: fixed, versioned DOCX rendering templates with an audited selection.
-- Templates are code-owned allowlisted layouts, never executable user content.

alter table public.tailoring_jobs
  add column render_template_key text not null default 'CLASSIC_V1',
  add column template_selected_by uuid references auth.users(id) on delete set null,
  add column template_selected_at timestamptz;
alter table public.tailoring_jobs add constraint tailoring_jobs_render_template_check
  check(render_template_key in('CLASSIC_V1','MODERN_V1','COMPACT_V1'));

alter table public.resumes add column render_template_key text;
update public.resumes set render_template_key='CLASSIC_V1' where resume_type='TAILORED';
alter table public.resumes add constraint resumes_render_template_check check(
  (resume_type='ORIGINAL' and render_template_key is null)
  or(resume_type='TAILORED' and render_template_key in('CLASSIC_V1','MODERN_V1','COMPACT_V1'))
);

create or replace function public.assign_tailored_resume_template_v18()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.resume_type='TAILORED' and new.render_template_key is null then new.render_template_key:='CLASSIC_V1';end if;
  if new.resume_type='ORIGINAL' then new.render_template_key:=null;end if;
  return new;
end$$;
create trigger resumes_assign_template_v18 before insert or update of resume_type,render_template_key on public.resumes
for each row execute function public.assign_tailored_resume_template_v18();
revoke all on function public.assign_tailored_resume_template_v18() from public,anon,authenticated;

create or replace function public.select_tailoring_template_v18(
  p_tailoring_job_id uuid,p_render_template_key text,p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_key text:=upper(btrim(coalesce(p_render_template_key,'')));
begin
  perform public.assert_application_manager();
  if v_key not in('CLASSIC_V1','MODERN_V1','COMPACT_V1') then
    raise exception 'TAILORING_TEMPLATE_INVALID: Select a supported Resume template.' using errcode='22023';
  end if;
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'APPROVED' then raise exception 'TAILORING_TEMPLATE_LOCKED: A template can be selected only after approval and before rendering.' using errcode='P0001';end if;
  if p_expected_updated_at is null or v_job.updated_at is distinct from p_expected_updated_at then raise exception 'TAILORING_TEMPLATE_CONFLICT: This tailoring job changed. Refresh before selecting a template.' using errcode='P0001';end if;
  update public.tailoring_jobs set render_template_key=v_key,template_selected_by=auth.uid(),template_selected_at=now(),updated_at=now()
  where id=v_job.id returning * into v_job;
  return jsonb_build_object('jobId',v_job.id,'renderTemplateKey',v_job.render_template_key,'selectedBy',v_job.template_selected_by,'selectedAt',v_job.template_selected_at,'updatedAt',v_job.updated_at);
end$$;

-- Keep the v1.6 public contracts stable while augmenting their input/output.
alter function public.begin_tailoring_materialization_v16(uuid) rename to begin_tailoring_materialization_v16_pre_v18;
create or replace function public.begin_tailoring_materialization_v16(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_key text;
begin
  v_result:=public.begin_tailoring_materialization_v16_pre_v18(p_tailoring_job_id);
  select render_template_key into v_key from public.tailoring_jobs where id=p_tailoring_job_id;
  if coalesce((v_result->>'alreadyMaterialized')::boolean,false)=false then
    update public.tailoring_jobs set template_selected_by=coalesce(template_selected_by,auth.uid()),template_selected_at=coalesce(template_selected_at,now()) where id=p_tailoring_job_id;
  end if;
  return v_result||jsonb_build_object('renderTemplateKey',coalesce(v_key,'CLASSIC_V1'));
end$$;

alter function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) rename to finalize_tailoring_materialization_v16_pre_v18;
create or replace function public.finalize_tailoring_materialization_v16(
  p_tailoring_job_id uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text
)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_result jsonb;v_key text;v_tailored_id uuid;
begin
  v_result:=public.finalize_tailoring_materialization_v16_pre_v18(p_tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  select render_template_key,tailored_resume_id into v_key,v_tailored_id from public.tailoring_jobs where id=p_tailoring_job_id;
  if v_tailored_id is not null then update public.resumes set render_template_key=coalesce(v_key,'CLASSIC_V1') where id=v_tailored_id and resume_type='TAILORED';end if;
  return v_result||jsonb_build_object('renderTemplateKey',coalesce(v_key,'CLASSIC_V1'));
end$$;

revoke all on function public.begin_tailoring_materialization_v16_pre_v18(uuid) from public,anon,authenticated;
revoke all on function public.finalize_tailoring_materialization_v16_pre_v18(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.select_tailoring_template_v18(uuid,text,timestamptz) from public,anon;
revoke all on function public.begin_tailoring_materialization_v16(uuid) from public,anon;
revoke all on function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.select_tailoring_template_v18(uuid,text,timestamptz) to authenticated;
grant execute on function public.begin_tailoring_materialization_v16(uuid) to authenticated;
grant execute on function public.finalize_tailoring_materialization_v16(uuid,uuid,text,text,text,bigint,text) to authenticated;
