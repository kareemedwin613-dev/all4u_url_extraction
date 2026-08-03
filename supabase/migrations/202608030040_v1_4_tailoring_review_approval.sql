-- v1.4: human review, controlled edits, approval/rejection, and immutable
-- audit history for v1.3 previews. Approval is content approval only: this
-- migration never creates a Resume artifact or changes an Application.

alter table public.tailoring_jobs
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz;

create table public.tailoring_job_reviews(
  id uuid primary key default gen_random_uuid(),
  tailoring_job_id uuid not null references public.tailoring_jobs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  action text not null check(action in('SAVE_DRAFT','APPROVE','REJECT')),
  previous_status text not null,
  new_status text not null,
  previous_preview jsonb not null check(jsonb_typeof(previous_preview)='object'),
  resulting_preview jsonb not null check(jsonb_typeof(resulting_preview)='object'),
  notes text not null default '' check(char_length(notes)<=1000),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index tailoring_job_reviews_job_created_idx on public.tailoring_job_reviews(tailoring_job_id,created_at desc,id desc);
create index tailoring_job_reviews_application_created_idx on public.tailoring_job_reviews(application_id,created_at desc);
create index tailoring_jobs_review_status_updated_idx on public.tailoring_jobs(status,updated_at desc,id)
where application_id is not null and status in('NEEDS_REVIEW','APPROVED','REJECTED');

-- A rejected job may be requested again by the v1.3 idempotent request RPC.
-- Clear the prior final decision as that row starts a new preview lifecycle;
-- the immutable review event remains available below.
create or replace function public.reset_tailoring_review_decision_v14()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.status='PENDING' and old.status is distinct from new.status then
    new.reviewed_by:=null;
    new.reviewed_at:=null;
  end if;
  return new;
end$$;
create trigger tailoring_review_decision_reset_v14 before update on public.tailoring_jobs
for each row execute function public.reset_tailoring_review_decision_v14();
revoke all on function public.reset_tailoring_review_decision_v14() from public,anon,authenticated;

create or replace function public.assert_tailoring_preview_v14(p_resume_id uuid,p_preview jsonb)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_resume public.resumes;v_source_ids text[];v_result_ids text[];v_keys text[]:=array['summary','professionalExperience','skills','changeSummary','unsupportedRequirements','warnings'];
begin
  select * into v_resume from public.resumes where id=p_resume_id;
  if not found or v_resume.resume_type<>'ORIGINAL' then raise exception 'TAILORING_PREVIEW_INVALID: The original source Resume was not found.' using errcode='P0001';end if;
  if p_preview is null or jsonb_typeof(p_preview)<>'object' then raise exception 'TAILORING_PREVIEW_INVALID: Preview fields do not match schema v1.' using errcode='P0001';end if;
  if exists(select 1 from jsonb_object_keys(p_preview) k where not(k=any(v_keys))) or (select count(*) from jsonb_object_keys(p_preview))<>array_length(v_keys,1) then raise exception 'TAILORING_PREVIEW_INVALID: Preview fields do not match schema v1.' using errcode='P0001';end if;
  if jsonb_typeof(p_preview->'summary')<>'string' or btrim(coalesce(p_preview->>'summary',''))='' or char_length(p_preview->>'summary')>4000 then raise exception 'TAILORING_PREVIEW_INVALID: The tailored summary is invalid.' using errcode='P0001';end if;
  if jsonb_typeof(p_preview->'professionalExperience')<>'array' or jsonb_typeof(p_preview->'skills')<>'array' or jsonb_typeof(p_preview->'changeSummary')<>'array' or jsonb_typeof(p_preview->'unsupportedRequirements')<>'array' or jsonb_typeof(p_preview->'warnings')<>'array' then raise exception 'TAILORING_PREVIEW_INVALID: Preview collections must be arrays.' using errcode='P0001';end if;
  if jsonb_array_length(p_preview->'professionalExperience') not between 1 and 30 or jsonb_array_length(p_preview->'skills')>250 or jsonb_array_length(p_preview->'changeSummary')>100 or jsonb_array_length(p_preview->'unsupportedRequirements')>100 or jsonb_array_length(p_preview->'warnings')>100 then raise exception 'TAILORING_PREVIEW_INVALID: Preview collections are too large or incomplete.' using errcode='P0001';end if;
  if exists(select 1 from jsonb_array_elements(p_preview->'skills') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>120)
    or exists(select 1 from jsonb_array_elements(p_preview->'changeSummary') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500)
    or exists(select 1 from jsonb_array_elements(p_preview->'unsupportedRequirements') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500)
    or exists(select 1 from jsonb_array_elements(p_preview->'warnings') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or char_length(x#>>'{}')>500) then raise exception 'TAILORING_PREVIEW_INVALID: Preview collection values are invalid.' using errcode='P0001';end if;
  if (select count(*)<>count(distinct lower(value)) from jsonb_array_elements_text(p_preview->'skills')) then raise exception 'TAILORING_PREVIEW_INVALID: Tailored skills must be unique.' using errcode='P0001';end if;
  if jsonb_typeof(v_resume.structured_content->'professional_experience')<>'array' or exists(select 1 from jsonb_array_elements(v_resume.structured_content->'professional_experience') x where jsonb_typeof(x)<>'object' or btrim(coalesce(x->>'id',''))='') then raise exception 'TAILORING_PREVIEW_INVALID: The original Resume experience structure is invalid.' using errcode='P0001';end if;
  select array_agg(x->>'id' order by x->>'id') into v_source_ids from jsonb_array_elements(v_resume.structured_content->'professional_experience') x;
  select array_agg(x->>'sourceExperienceId' order by x->>'sourceExperienceId') into v_result_ids from jsonb_array_elements(p_preview->'professionalExperience') x;
  if v_result_ids is distinct from v_source_ids or exists(select 1 from jsonb_array_elements(p_preview->'professionalExperience') x where jsonb_typeof(x)<>'object' or btrim(coalesce(x->>'tailoredDetails',''))='' or char_length(x->>'tailoredDetails')>12000 or (select count(*) from jsonb_object_keys(x))<>2 or not(x?'sourceExperienceId' and x?'tailoredDetails')) then raise exception 'TAILORING_PREVIEW_INVALID: Tailored experience records must exactly match the source experiences.' using errcode='P0001';end if;
  if exists(select 1 from jsonb_array_elements_text(p_preview->'skills') s where not exists(select 1 from unnest(v_resume.skills) source_skill where lower(source_skill)=lower(s))) then raise exception 'TAILORING_PREVIEW_INVALID: Tailored skills must exist on the source Resume.' using errcode='P0001';end if;
end$$;

create or replace function public.review_tailoring_preview_v14(p_tailoring_job_id uuid,p_action text,p_preview jsonb,p_notes text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_action text:=upper(btrim(coalesce(p_action,'')));v_notes text:=btrim(coalesce(p_notes,''));v_new_status text;
begin
  perform public.assert_application_manager();
  if v_action not in('SAVE_DRAFT','APPROVE','REJECT') then raise exception 'TAILORING_REVIEW_INVALID: Select Save Draft, Approve, or Reject.' using errcode='P0001';end if;
  if char_length(v_notes)>1000 or (v_action='REJECT' and v_notes='') then raise exception 'TAILORING_REVIEW_INVALID: Rejection requires review notes of at most 1000 characters.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'NEEDS_REVIEW' or v_job.output_preview is null then raise exception 'TAILORING_REVIEW_UNAVAILABLE: Only a generated preview awaiting review can be changed.' using errcode='P0001';end if;
  if p_expected_updated_at is null or v_job.updated_at is distinct from p_expected_updated_at then raise exception 'TAILORING_REVIEW_CONFLICT: This preview changed after it was loaded. Refresh before reviewing.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  v_new_status:=case v_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'NEEDS_REVIEW' end;
  update public.tailoring_jobs set output_preview=p_preview,review_notes=v_notes,status=v_new_status,
    reviewed_by=case when v_action='SAVE_DRAFT' then null else auth.uid() end,
    reviewed_at=case when v_action='SAVE_DRAFT' then null else now() end,
    completed_at=case when v_action='SAVE_DRAFT' then completed_at else now() end
  where id=v_job.id;
  insert into public.tailoring_job_reviews(tailoring_job_id,application_id,action,previous_status,new_status,previous_preview,resulting_preview,notes,reviewed_by)
  values(v_job.id,v_job.application_id,v_action,v_job.status,v_new_status,v_job.output_preview,p_preview,v_notes,auth.uid());
  return jsonb_build_object('id',v_job.id,'applicationId',v_job.application_id,'status',v_new_status,'action',v_action,'reviewedBy',case when v_action='SAVE_DRAFT' then null else auth.uid() end,'reviewedAt',case when v_action='SAVE_DRAFT' then null else now() end,'updatedAt',(select updated_at from public.tailoring_jobs where id=v_job.id));
end$$;

create or replace function public.get_tailoring_job_reviews_v14(p_tailoring_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  if not exists(select 1 from public.tailoring_jobs where id=p_tailoring_job_id and application_id is not null) then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'tailoringJobId',r.tailoring_job_id,'applicationId',r.application_id,'action',r.action,'previousStatus',r.previous_status,'newStatus',r.new_status,'notes',r.notes,'reviewedBy',r.reviewed_by,'reviewerName',coalesce(nullif(btrim(p.full_name),''),p.email),'createdAt',r.created_at) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into v_result from public.tailoring_job_reviews r left join public.profiles p on p.id=r.reviewed_by where r.tailoring_job_id=p_tailoring_job_id;
  return v_result;
end$$;

alter table public.tailoring_job_reviews enable row level security;
create policy "managers read tailoring review history" on public.tailoring_job_reviews for select to authenticated using((select public.application_actor_can_manage()));
revoke all on public.tailoring_job_reviews from anon;
revoke insert,update,delete on public.tailoring_job_reviews from authenticated;
grant select on public.tailoring_job_reviews to authenticated;
revoke all on function public.assert_tailoring_preview_v14(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.review_tailoring_preview_v14(uuid,text,jsonb,text,timestamptz) from public,anon;
revoke all on function public.get_tailoring_job_reviews_v14(uuid) from public,anon;
grant execute on function public.review_tailoring_preview_v14(uuid,text,jsonb,text,timestamptz) to authenticated;
grant execute on function public.get_tailoring_job_reviews_v14(uuid) to authenticated;

comment on table public.tailoring_job_reviews is 'Immutable human review audit events; preview snapshots are retained for traceability.';
comment on column public.tailoring_jobs.reviewed_at is 'Final content-decision timestamp; null while the preview still needs review.';
