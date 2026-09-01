-- v3.33: expand the code-owned tailored Resume template catalog.
-- Every layout remains one-column and ATS-safe; only allowlisted versioned keys
-- may be selected or persisted.

alter table public.tailoring_jobs
  drop constraint if exists tailoring_jobs_render_template_check;
alter table public.tailoring_jobs
  add constraint tailoring_jobs_render_template_check check(render_template_key in(
    'CLASSIC_V1','MODERN_V1','COMPACT_V1','EXECUTIVE_V1','TECHNICAL_V1','MINIMAL_V1',
    'CORPORATE_V1','ELEGANT_V1','SLATE_V1','EMERALD_V1','ACADEMIC_V1','IMPACT_V1'
  ));

alter table public.resumes
  drop constraint if exists resumes_render_template_check;
alter table public.resumes
  add constraint resumes_render_template_check check(
    (resume_type='ORIGINAL' and render_template_key is null)
    or(resume_type='TAILORED' and render_template_key in(
      'CLASSIC_V1','MODERN_V1','COMPACT_V1','EXECUTIVE_V1','TECHNICAL_V1','MINIMAL_V1',
      'CORPORATE_V1','ELEGANT_V1','SLATE_V1','EMERALD_V1','ACADEMIC_V1','IMPACT_V1'
    ))
  );

create or replace function public.select_tailoring_template_v18(
  p_tailoring_job_id uuid,p_render_template_key text,p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_key text:=upper(btrim(coalesce(p_render_template_key,'')));
begin
  perform public.assert_application_manager();
  if v_key not in(
    'CLASSIC_V1','MODERN_V1','COMPACT_V1','EXECUTIVE_V1','TECHNICAL_V1','MINIMAL_V1',
    'CORPORATE_V1','ELEGANT_V1','SLATE_V1','EMERALD_V1','ACADEMIC_V1','IMPACT_V1'
  ) then
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

revoke all on function public.select_tailoring_template_v18(uuid,text,timestamptz) from public,anon;
grant execute on function public.select_tailoring_template_v18(uuid,text,timestamptz) to authenticated;

comment on function public.select_tailoring_template_v18(uuid,text,timestamptz) is
  'Selects one of the allowlisted ATS-safe tailored Resume templates for an approved job.';
