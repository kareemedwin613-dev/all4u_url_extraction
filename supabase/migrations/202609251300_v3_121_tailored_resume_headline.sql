-- Tailored Resume layout: a headline under the candidate's name. The renderer derives it from
-- the target job title, capped at the original Resume's seniority, and falls back to this
-- manager-set headline when the job title cannot be used. Employment titles never change.
alter table public.resumes add column resume_headline text
  check (resume_headline is null or char_length(resume_headline) between 1 and 80);
comment on column public.resumes.resume_headline is
  'ORIGINAL only: fallback headline under the name on tailored PDFs, e.g. "Senior Data Engineer".';

create function public.set_resume_headline_v121(p_resume_id uuid,p_headline text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_resume public.resumes;v_headline text:=nullif(regexp_replace(btrim(coalesce(p_headline,'')),'\s+',' ','g'),'');
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can edit Resume headlines.' using errcode='42501';
  end if;
  select * into v_resume from public.resumes where id=p_resume_id for update;
  if not found then raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001';end if;
  if v_resume.resume_type<>'ORIGINAL' then
    raise exception 'RESUME_TYPE_INVALID: Only original Resumes have an editable headline.' using errcode='22023';
  end if;
  if char_length(v_headline)>80 then raise exception 'VALIDATION_ERROR: The headline must be at most 80 characters.' using errcode='22023';end if;
  update public.resumes set resume_headline=v_headline,updated_at=clock_timestamp() where id=p_resume_id returning * into v_resume;
  return jsonb_build_object('id',v_resume.id,'resumeHeadline',v_resume.resume_headline,'updatedAt',v_resume.updated_at);
end$$;
revoke all on function public.set_resume_headline_v121(uuid,text) from public,anon,authenticated;
grant execute on function public.set_resume_headline_v121(uuid,text) to authenticated;

-- Same as v3.35, plus the target job and source Resume fields the headline needs.
-- Every materialization path (authenticated, runner ticket, batch) goes through this function.
create or replace function public.begin_tailoring_materialization_v19(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_job public.tailoring_jobs;v_filename text;v_path text;v_layout jsonb;
begin
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id;
  if not found or (v_job.render_format<>'PDF' and not(v_job.status='COMPLETED' and v_job.tailored_resume_id is not null)) then raise exception 'TAILORING_FORMAT_INVALID: Tailored Resumes are PDF-only.' using errcode='22023';end if;
  v_result:=public.begin_tailoring_materialization_v16(p_tailoring_job_id);
  if coalesce((v_result->>'alreadyMaterialized')::boolean,false)=false then
    v_filename:=regexp_replace(v_result->>'filename','\.docx$','.pdf');
    v_path:=regexp_replace(v_result->>'targetPath','\.docx$','.pdf');
    update public.tailoring_jobs set format_selected_by=coalesce(format_selected_by,auth.uid()),format_selected_at=coalesce(format_selected_at,now()) where id=p_tailoring_job_id;
    select jsonb_build_object('targetJob',jsonb_build_object('title',jd.job_title,'company',jd.company),
        'resumeSeniority',r.seniority,'resumeHeadline',r.resume_headline)
      into v_layout from public.job_descriptions jd,public.resumes r where jd.id=v_job.job_description_id and r.id=v_job.resume_id;
    v_result:=v_result||jsonb_build_object('filename',v_filename,'targetPath',v_path,'mimeType','application/pdf')||coalesce(v_layout,'{}'::jsonb);
  end if;
  return v_result||jsonb_build_object('renderFormat',v_job.render_format,'renderTemplateKey',v_job.render_template_key);
end$$;
revoke all on function public.begin_tailoring_materialization_v19(uuid) from public,anon;
grant execute on function public.begin_tailoring_materialization_v19(uuid) to authenticated;
notify pgrst,'reload schema';
